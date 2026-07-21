import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, UserPlus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface ContactForm {
  full_name: string;
  phone: string;
  cpf: string;
  rg: string;
  birth_date: string;
  email: string;
  profession: string;
  cep: string;
  street: string;
  street_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  notes: string;
}

const EMPTY_FORM: ContactForm = {
  full_name: '', phone: '', cpf: '', rg: '', birth_date: '', email: '', profession: '',
  cep: '', street: '', street_number: '', complement: '', neighborhood: '', city: '', state: '', notes: '',
};

const FIELD_LABELS: Record<keyof ContactForm, string> = {
  full_name: 'Nome completo', phone: 'Telefone', cpf: 'CPF', rg: 'RG', birth_date: 'Data de nascimento',
  email: 'E-mail', profession: 'Profissão', cep: 'CEP', street: 'Rua', street_number: 'Número',
  complement: 'Complemento', neighborhood: 'Bairro', city: 'Cidade', state: 'UF', notes: 'Observações',
};

// Campos obrigatórios pra confirmar o cadastro do contato do cliente.
const REQUIRED_FIELDS: Array<keyof ContactForm> = ['full_name', 'phone', 'cpf'];

interface Props {
  open: boolean;
  leadId: string;
  groupJid?: string | null;
  groupName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

// Cadastro do contato do cliente ao confirmar caso fechado: extrai da conversa do
// grupo (via extract-conversation-data) o máximo de dados, mostra o que a IA
// preencheu e o que falta preencher pra confirmar.
export function ClosedCaseContactDialog({ open, leadId, groupJid, groupName, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [aiFilled, setAiFilled] = useState<Set<keyof ContactForm>>(new Set());
  const [existingContactId, setExistingContactId] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const bareJid = (groupJid || '').replace(/@g\.us$/i, '').trim();

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;

    (async () => {
      setForm(EMPTY_FORM);
      setAiFilled(new Set());
      setExistingContactId(null);
      setExtractError(null);
      setExtracting(true);
      try {
        try { await ensureExternalSession(); } catch { /* segue como anon */ }

        // Contato já vinculado ao lead? Completa em vez de duplicar.
        let base: ContactForm = { ...EMPTY_FORM };
        try {
          const { data: links } = await (externalSupabase as any)
            .from('contact_leads')
            .select('contact_id')
            .eq('lead_id', leadId)
            .limit(1);
          const cid = links?.[0]?.contact_id;
          if (cid) {
            const { data: c } = await externalSupabase
              .from('contacts')
              .select('id, full_name, phone, cpf, rg, birth_date, email, profession, cep, street, street_number, complement, neighborhood, city, state, notes')
              .eq('id', cid)
              .maybeSingle();
            if (c) {
              if (!cancelled) setExistingContactId((c as any).id);
              (Object.keys(EMPTY_FORM) as Array<keyof ContactForm>).forEach((k) => {
                const v = (c as any)[k];
                if (v !== null && v !== undefined && String(v).trim()) base[k] = String(v);
              });
            }
          }
        } catch (e) {
          console.warn('Falha ao buscar contato vinculado:', e);
        }
        if (!cancelled) setForm(base);

        // Extração IA a partir da conversa do grupo
        if (!bareJid) {
          if (!cancelled) setExtractError('Grupo sem JID identificado — preencha os campos manualmente.');
          return;
        }
        const { data: msgs, error: msgErr } = await externalSupabase
          .from('whatsapp_messages')
          .select('created_at, direction, contact_name, message_text')
          .in('phone', [bareJid, `${bareJid}@g.us`])
          .order('created_at', { ascending: false })
          .limit(500);
        if (msgErr) throw msgErr;
        const conversation = (msgs || []).slice().reverse()
          .map(r => `[${r.created_at}] ${r.contact_name || (r.direction === 'outbound' ? 'Equipe' : 'Cliente')}: ${r.message_text || ''}`)
          .join('\n');
        if (!conversation.trim()) {
          if (!cancelled) setExtractError('Nenhuma mensagem encontrada no grupo — preencha manualmente.');
          return;
        }

        const prompt = `Analise a conversa de WhatsApp abaixo entre a equipe do escritório e o CLIENTE (e familiares). Extraia o máximo de dados cadastrais DO CLIENTE (a pessoa atendida, não os membros da equipe).

Retorne APENAS um JSON válido com os campos (deixe "" o que não souber, NUNCA invente):
{
  "full_name": "nome completo do cliente",
  "phone": "telefone pessoal do cliente com DDD, só dígitos",
  "cpf": "CPF só dígitos",
  "rg": "RG",
  "birth_date": "YYYY-MM-DD",
  "email": "e-mail",
  "profession": "profissão",
  "cep": "CEP só dígitos",
  "street": "rua/logradouro",
  "street_number": "número",
  "complement": "complemento",
  "neighborhood": "bairro",
  "city": "cidade",
  "state": "UF (2 letras)",
  "notes": "observações relevantes sobre o cliente em 1-2 frases"
}

CONVERSA:
${conversation}`;

        const { data, error } = await cloudFunctions.invoke<any>('extract-conversation-data', {
          body: { targetType: 'contact_data', customPrompt: prompt },
        });
        if (error) throw error;
        const extracted = data?.data || data;
        if (cancelled) return;
        if (!extracted || typeof extracted !== 'object') {
          setExtractError('IA não retornou dados estruturados — preencha manualmente.');
          return;
        }

        const filled = new Set<keyof ContactForm>();
        const next: ContactForm = { ...base };
        (Object.keys(EMPTY_FORM) as Array<keyof ContactForm>).forEach((k) => {
          const v = extracted[k];
          // Dado já existente no contato vinculado vence o da IA.
          if (!next[k] && v !== null && v !== undefined && String(v).trim()) {
            next[k] = String(v).trim();
            filled.add(k);
          }
        });
        setForm(next);
        setAiFilled(filled);
        if (filled.size > 0) {
          toast.success(`IA preencheu ${filled.size} campo(s) a partir da conversa do grupo.`);
        } else {
          toast.info('IA não encontrou dados novos na conversa — confira e complete manualmente.');
        }
      } catch (err: any) {
        console.error('ClosedCaseContactDialog extract error:', err);
        if (!cancelled) setExtractError(`Falha na extração IA: ${err?.message || 'erro'} — preencha manualmente.`);
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  const missingRequired = useMemo(
    () => REQUIRED_FIELDS.filter((k) => !form[k].trim()),
    [form],
  );

  const setField = (k: keyof ContactForm, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (missingRequired.length > 0) {
      toast.error(`Preencha para confirmar: ${missingRequired.map(k => FIELD_LABELS[k]).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      await ensureExternalSession().catch(() => {});
      const payload: Record<string, any> = {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        cpf: form.cpf.trim() || null,
        rg: form.rg.trim() || null,
        birth_date: form.birth_date || null,
        email: form.email.trim() || null,
        profession: form.profession.trim() || null,
        cep: form.cep.trim() || null,
        street: form.street.trim() || null,
        street_number: form.street_number.trim() || null,
        complement: form.complement.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        notes: form.notes.trim() || null,
        classification: 'client',
      };

      if (existingContactId) {
        const { error } = await externalSupabase
          .from('contacts')
          .update(payload)
          .eq('id', existingContactId);
        if (error) throw error;
        toast.success('Contato do cliente atualizado e marcado como cliente!');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const externalUserId = await remapToExternal(user?.id).catch(() => null);
        const { data: newContact, error } = await externalSupabase
          .from('contacts')
          .insert({ ...payload, created_by: externalUserId })
          .select('id')
          .single();
        if (error) throw error;
        const { error: linkErr } = await (externalSupabase as any)
          .from('contact_leads')
          .insert({ contact_id: (newContact as any).id, lead_id: leadId });
        if (linkErr) throw linkErr;
        toast.success('Contato do cliente cadastrado e vinculado ao lead!');
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error('ClosedCaseContactDialog save error:', err);
      toast.error(`Erro ao salvar contato: ${err?.message || 'erro'}`);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (k: keyof ContactForm, props?: { type?: string; className?: string }) => (
    <div className={props?.className}>
      <Label className="text-xs flex items-center gap-1">
        {FIELD_LABELS[k]}
        {REQUIRED_FIELDS.includes(k) && <span className="text-destructive">*</span>}
        {aiFilled.has(k) && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px] gap-0.5">
            <Sparkles className="h-2.5 w-2.5" /> IA
          </Badge>
        )}
      </Label>
      {k === 'notes' ? (
        <Textarea value={form[k]} onChange={(e) => setField(k, e.target.value)} rows={2} className="mt-1" />
      ) : (
        <Input
          type={props?.type || 'text'}
          value={form[k]}
          onChange={(e) => setField(k, e.target.value)}
          className={`mt-1 ${REQUIRED_FIELDS.includes(k) && !form[k].trim() ? 'border-destructive' : ''}`}
        />
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Cadastrar contato do cliente
          </DialogTitle>
          <DialogDescription>
            Caso fechado{groupName ? <> — grupo <strong>{groupName}</strong></> : null}. A IA lê a conversa do
            grupo e preenche o que encontrar; confira, complete o que falta e confirme.
          </DialogDescription>
        </DialogHeader>

        {extracting ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Lendo a conversa do grupo e extraindo dados do cliente...</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <div className="space-y-3">
              {extractError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {extractError}
                </div>
              )}
              {missingRequired.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Para confirmar, preencha: <strong>{missingRequired.map(k => FIELD_LABELS[k]).join(', ')}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {renderField('full_name', { className: 'col-span-2' })}
                {renderField('phone')}
                {renderField('cpf')}
                {renderField('rg')}
                {renderField('birth_date', { type: 'date' })}
                {renderField('email')}
                {renderField('profession')}
                {renderField('cep')}
                {renderField('street')}
                {renderField('street_number')}
                {renderField('complement')}
                {renderField('neighborhood')}
                {renderField('city')}
                {renderField('state')}
                {renderField('notes', { className: 'col-span-2' })}
              </div>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Preencher depois
          </Button>
          <Button onClick={handleSave} disabled={saving || extracting || missingRequired.length > 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
            {existingContactId ? 'Confirmar e atualizar contato' : 'Confirmar e cadastrar contato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

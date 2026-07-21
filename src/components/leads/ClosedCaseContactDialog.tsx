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
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';

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
// CPF ficou de fora: em grupo onde o cliente nunca digitou o CPF (só mandou a
// procuração em PDF), exigir aqui travava o cadastro do contato — e sem contato
// o lead fechado não salva. Fica como campo destacado, para completar depois.
const REQUIRED_FIELDS: Array<keyof ContactForm> = ['full_name', 'phone'];
const RECOMMENDED_FIELDS: Array<keyof ContactForm> = ['cpf'];

// Muitos "contatos" na base são, na verdade, o registro do GRUPO: o phone guarda
// o JID (120363…, 18 dígitos; ou o formato antigo, 22 dígitos) e o nome costuma
// ser o nome do lead. Boa parte tem whatsapp_group_id NULL, então checar só esse
// campo não basta — daí o isWhatsAppGroupId, que corta em 17 dígitos.
// Não usar um corte menor: a base tem telefone internacional legítimo com 15
// dígitos (ex.: China, DDI 86), que seria classificado como grupo por engano.
function isGroupLikeContact(c: any): boolean {
  if (!c) return false;
  if (c.whatsapp_group_id) return true;
  return isWhatsAppGroupId(c.phone);
}

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
        // Pega TODOS os vínculos e descarta os que são registro de grupo — senão o
        // formulário abre com o nome do lead e o JID do grupo no campo Telefone, e
        // o "Confirmar e atualizar" sobrescreveria o registro do grupo.
        let base: ContactForm = { ...EMPTY_FORM };
        try {
          const { data: links } = await (externalSupabase as any)
            .from('contact_leads')
            .select('contact_id')
            .eq('lead_id', leadId);
          const cids = (links || []).map((l: any) => l.contact_id).filter(Boolean);
          if (cids.length > 0) {
            const { data: rows } = await externalSupabase
              .from('contacts')
              .select('id, full_name, phone, whatsapp_group_id, cpf, rg, birth_date, email, profession, cep, street, street_number, complement, neighborhood, city, state, notes')
              .in('id', cids);
            const c = (rows || []).find((row: any) => !isGroupLikeContact(row));
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

        // Extração IA a partir da conversa do grupo.
        // Contrato da edge extract-conversation-data (Externo v18): exige phone +
        // instance_name; ela mesma busca as mensagens e extrai os dados cadastrais.
        // NÃO passar lead_id/contact_id — a função gravaria direto sem confirmação.
        if (!bareJid) {
          if (!cancelled) setExtractError('Grupo sem JID identificado — preencha os campos manualmente.');
          return;
        }
        // Toda instância do escritório que está no grupo grava sua PRÓPRIA cópia das
        // mensagens. A instância da mensagem mais recente costuma ser a que entrou
        // por último no grupo — ela não tem o histórico antigo (onde o cliente mandou
        // CPF/endereço). Por isso ranqueamos por cobertura: mais mensagens primeiro,
        // empate decidido pela que começou antes.
        const { data: instRows, error: instErr } = await externalSupabase
          .from('whatsapp_messages')
          .select('instance_name, created_at')
          .in('phone', [bareJid, `${bareJid}@g.us`])
          .not('instance_name', 'is', null)
          .order('created_at', { ascending: true })
          .limit(2000);
        if (instErr) throw instErr;

        const byInstance = new Map<string, { count: number; first: string }>();
        for (const row of (instRows || []) as any[]) {
          const name = row.instance_name as string;
          const prev = byInstance.get(name);
          if (prev) prev.count += 1;
          else byInstance.set(name, { count: 1, first: row.created_at });
        }
        const rankedInstances = [...byInstance.entries()]
          .sort((a, b) => b[1].count - a[1].count || String(a[1].first).localeCompare(String(b[1].first)))
          .map(([name]) => name);

        if (rankedInstances.length === 0) {
          if (!cancelled) setExtractError('Nenhuma mensagem encontrada no grupo — preencha manualmente.');
          return;
        }

        // Tenta as instâncias com maior cobertura até vir algo aproveitável.
        // Só cai para a próxima quando a anterior não trouxe nada — evita gastar
        // chamadas de IA à toa.
        let extracted: any = null;
        let lastReason: string | null = null;
        for (const instanceName of rankedInstances.slice(0, 3)) {
          const { data, error } = await cloudFunctions.invoke<any>('extract-conversation-data', {
            // include_documents: lê também as imagens/PDFs do grupo (RG, procuração,
            // comprovante) via OCR — é de onde saem profissão, cidade/UF e endereço
            // quando o cliente só mandou o documento sem digitar nada.
            body: {
              phone: bareJid,
              instance_name: instanceName,
              targetType: 'contact',
              limit_messages: 500,
              include_documents: true,
            },
          });
          if (cancelled) return;
          if (error) { lastReason = error.message || 'erro na extração'; continue; }
          const candidate = data?.data;
          if (candidate && typeof candidate === 'object'
            && Object.values(candidate).some((v) => v !== null && v !== undefined && String(v).trim())) {
            extracted = candidate;
            break;
          }
          lastReason = data?.reason === 'no_messages' ? 'no_messages' : lastReason;
        }

        if (!extracted) {
          setExtractError(lastReason === 'no_messages'
            ? 'Nenhuma mensagem encontrada no grupo — preencha manualmente.'
            : 'IA não encontrou dados na conversa — preencha manualmente.');
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
  const missingRecommended = useMemo(
    () => RECOMMENDED_FIELDS.filter((k) => !form[k].trim()),
    [form],
  );

  const setField = (k: keyof ContactForm, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (missingRequired.length > 0) {
      toast.error(`Preencha para confirmar: ${missingRequired.map(k => FIELD_LABELS[k]).join(', ')}`);
      return;
    }
    if (isGroupLikeContact({ phone: form.phone })) {
      toast.error('O campo Telefone está com o ID do grupo, não com o número do cliente.', {
        description: 'Informe o telefone de quem contratou — o número aparece na lista de membros do grupo.',
      });
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
              {missingRecommended.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Falta <strong>{missingRecommended.map(k => FIELD_LABELS[k]).join(', ')}</strong> — dá para
                  cadastrar assim mesmo e completar depois.
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

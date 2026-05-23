import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSignature, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ZapSignDocumentDialog } from '@/components/whatsapp/ZapSignDocumentDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db } from '@/integrations/supabase';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { getMyAllowedInstanceIds } from '@/integrations/supabase/permissions';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

function normalizePhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

function normalizeBrazilMobilePhone(raw: string): string {
  const digits = normalizePhone(raw);
  if (!digits) return '';
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 10) {
    const ddd = local.slice(0, 2);
    const number = local.slice(2);
    return `55${ddd}9${number}`;
  }
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function phoneCandidatesForConversation(raw: string): string[] {
  const digits = normalizePhone(raw);
  const normalized = normalizeBrazilMobilePhone(raw);
  const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  return Array.from(new Set([normalized, digits, local].filter(Boolean)));
}

function maskPhone(raw?: string | null): string | null {
  const digits = normalizePhone(raw || '');
  return digits ? `***${digits.slice(-4)}` : null;
}

/**
 * Página unificada de Gerar Procuração.
 *
 * Metáfora: é a "porta fixa" do gerador. Operador entra (já logado),
 * digita o telefone do cliente (ou abre via link com ?phone=...) e
 * o sistema abre o mesmo popup que existe no chat, já com a conversa
 * carregada e pronto pra extrair, editar e enviar.
 */
export default function GerarProcuracaoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuthContext();
  const initialPhone = normalizePhone(params.get('phone') || '');
  const urlInstance = params.get('instance')?.trim() || undefined;
  const templateHint = params.get('template') || undefined;

  const [phoneInput, setPhoneInput] = useState(initialPhone);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultInstance, setDefaultInstance] = useState<string | undefined>(undefined);
  const [selectedInstance, setSelectedInstance] = useState<string | undefined>(undefined);
  const [availableInstances, setAvailableInstances] = useState<Array<{ id: string; instance_name: string }>>([]);
  const [resolved, setResolved] = useState<{
    phone: string;
    contactId?: string;
    leadId?: string;
    contactName?: string;
  } | null>(null);

  // Instância efetiva: URL > seleção manual > perfil do usuário
  const instance = urlInstance || selectedInstance || defaultInstance;

  // Carrega instâncias acessíveis e default do perfil
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const allowedIds = await getMyAllowedInstanceIds(user.id);
        if (allowedIds.length === 0) return;
        const { data: instances } = await db
          .from('whatsapp_instances')
          .select('id, instance_name')
          .in('id', allowedIds)
          .eq('is_active', true)
          .order('instance_name');
        setAvailableInstances((instances as any) || []);

        const { data: profile } = await supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', user.id)
          .maybeSingle();
        const defaultId = (profile as any)?.default_instance_id;
        const defaultInst = (instances as any)?.find((i: any) => i.id === defaultId);
        if (defaultInst?.instance_name) {
          setDefaultInstance(defaultInst.instance_name);
          setSelectedInstance(defaultInst.instance_name);
        } else if ((instances as any)?.[0]?.instance_name) {
          // Sem default no perfil: usa a primeira acessível como pré-seleção
          setSelectedInstance((instances as any)[0].instance_name);
        }
      } catch (err) {
        console.error('[GerarProcuracao] erro ao carregar instâncias acessíveis:', err);
      }
    })();
  }, [user]);


  const openForPhone = async (rawPhone: string) => {
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.length < 10) {
      toast.error('Informe um telefone válido (com DDD)');
      return;
    }
    // Abre o popup imediatamente — a busca de contato/lead roda em paralelo
    // e atualiza o estado quando chega. Isso evita a sensação de "travado".
    setResolved({ phone });
    setDialogOpen(true);
    setLoading(true);

    try {
      const [contactRes, leadRes] = await Promise.all([
        db
          .from('contacts')
          .select('id, full_name, lead_id')
          .eq('phone', phone)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('leads')
          .select('id, lead_name')
          .eq('lead_phone', phone)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const contact: any = contactRes.data;
      const lead: any = leadRes.data;
      const leadId: string | undefined = contact?.lead_id || lead?.id || undefined;
      const contactName: string | undefined =
        contact?.full_name || lead?.lead_name || undefined;

      setResolved({
        phone,
        contactId: contact?.id,
        leadId,
        contactName,
      });
    } catch (err: any) {
      console.error('[GerarProcuracao] erro ao resolver telefone:', err);
    } finally {
      setLoading(false);
    }
  };

  // Auto-abre se vier com ?phone=
  useEffect(() => {
    if (initialPhone && initialPhone.length >= 10) {
      openForPhone(initialPhone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSignature className="h-6 w-6 text-primary" />
          Gerar Procuração
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Informe o telefone do cliente. O sistema busca a conversa, a IA preenche os campos
          e você revisa antes de enviar pra assinatura.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telefone do cliente</CardTitle>
          <CardDescription>Com DDD (ex: 5511999999999)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (WhatsApp)</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                inputMode="tel"
                placeholder="5511999999999"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openForPhone(phoneInput);
                }}
              />
              <Button
                onClick={() => openForPhone(phoneInput)}
                disabled={loading || !phoneInput.trim()}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Abrir <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {templateHint && (
            <p className="text-xs text-muted-foreground">
              Modelo sugerido: <span className="font-mono">{templateHint}</span> — será pré-selecionado no popup.
            </p>
          )}
          {!urlInstance && availableInstances.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="instance">Enviar pela instância</Label>
              <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                <SelectTrigger id="instance">
                  <SelectValue placeholder="Selecione a instância" />
                </SelectTrigger>
                <SelectContent>
                  {availableInstances.map((i) => (
                    <SelectItem key={i.id} value={i.instance_name}>
                      {i.instance_name}
                      {i.instance_name === defaultInstance ? ' (padrão)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {urlInstance && (
            <p className="text-xs text-muted-foreground">
              Instância (via link): <span className="font-mono">{urlInstance}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {resolved && (
        <ZapSignDocumentDialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) setResolved(null);
          }}
          phone={resolved.phone}
          contactName={resolved.contactName}
          contactId={resolved.contactId}
          leadId={resolved.leadId}
          instanceName={instance}
          onSendMessage={async (message: string, recipientPhone?: string) => {
            try {
              // whatsapp_instances vive no Externo (dado de negócio).
              // Nunca cair para "primeira instância ativa": isso envia por um
              // número aleatório quando a instância pedida não é encontrada.
              let inst: any = null;
              if (instance) {
                const { data } = await db
                  .from('whatsapp_instances')
                  .select('id, instance_name')
                  .ilike('instance_name', instance.trim())
                  .eq('is_active', true)
                  .limit(1)
                  .maybeSingle();
                inst = data;
                if (!inst?.id) {
                  console.error('[GerarProcuracao] instância informada não encontrada/sem acesso', { instance });
                  toast.error(`Instância "${instance}" não encontrada ou sem acesso. Nada foi enviado.`);
                  return false;
                }
              }
              if (!inst) {
                const candidates = phoneCandidatesForConversation(recipientPhone || resolved.phone);
                const { data: lastMessage } = await db
                  .from('whatsapp_messages')
                  .select('instance_name')
                  .in('phone', candidates)
                  .not('instance_name', 'is', null)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if ((lastMessage as any)?.instance_name) {
                  const { data } = await db
                    .from('whatsapp_instances')
                    .select('id, instance_name')
                    .ilike('instance_name', (lastMessage as any).instance_name)
                    .eq('is_active', true)
                    .limit(1)
                    .maybeSingle();
                  inst = data;
                }
              }
              if (!inst?.id) {
                toast.error('Não identifiquei a instância da conversa. Abra com ?instance=NomeDaInstancia para enviar.');
                return false;
              }
              const targetPhone = normalizeBrazilMobilePhone(recipientPhone || resolved.phone);
              const payload = {
                phone: targetPhone,
                message,
                instance_id: inst.id,
                contact_id: resolved.contactId,
                lead_id: resolved.leadId,
              };
              console.log('[GerarProcuracao] send-whatsapp payload', {
                phoneLast4: maskPhone(payload.phone),
                messageLength: message.length,
                instanceName: inst.instance_name,
                instanceId: inst.id,
                hasContactId: Boolean(resolved.contactId),
                hasLeadId: Boolean(resolved.leadId),
              });
              const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
                body: payload,
              });
              if (error) {
                console.error('[GerarProcuracao] send-whatsapp error', error);
                toast.error('Erro ao enviar: ' + (error.message || 'falha desconhecida'));
                return false;
              }
              if (data && (data as any).success === false) {
                console.error('[GerarProcuracao] send-whatsapp business error', data);
                toast.error('Erro ao enviar: ' + ((data as any).error || 'falha'));
                return false;
              }
              console.log('[GerarProcuracao] send-whatsapp ok', data);
              return true;
            } catch (err: any) {
              console.error('[GerarProcuracao] onSendMessage exception', err);
              toast.error('Erro ao enviar: ' + err.message);
              return false;
            }
          }}
        />
      )}
    </div>
  );
}

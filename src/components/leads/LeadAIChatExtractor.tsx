import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles, MessageSquare, User } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import type { ExtractedAccidentData } from '@/components/leads/AccidentDataExtractor';

type Source = 'group' | 'contact';
type LimitOpt = '50' | '200' | 'all';

interface LeadAIChatExtractorProps {
  leadId: string;
  leadPhone?: string | null;
  whatsappGroups?: Array<{ group_jid: string; group_name?: string | null }>;
  onDataExtracted: (data: ExtractedAccidentData) => void;
}

export function LeadAIChatExtractor({ leadId, leadPhone, whatsappGroups, onDataExtracted }: LeadAIChatExtractorProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>('group');
  const [limit, setLimit] = useState<LimitOpt>('200');
  const [loading, setLoading] = useState(false);

  // Grupos em whatsapp_messages.phone são gravados BARE (ex: 120363...), não com @g.us.
  // Normaliza tirando o sufixo para casar com a tabela.
  const normalizeJid = (v?: string | null) => (v || '').replace(/@g\.us$/i, '').trim();
  // Id de grupo tem ~17-18 dígitos; telefone pessoal tem <=13. >=15 distingue com folga.
  const looksLikeGroupId = (v: string) => /^\d{15,}$/.test(v);

  // Fonte do jid do grupo, em ordem: (1) entrada com group_jid preenchido (com ou sem
  // @g.us); (2) lead_phone quando ele é o próprio número do grupo (lead = grupo).
  const groupJid =
    normalizeJid(whatsappGroups?.find((g) => normalizeJid(g?.group_jid))?.group_jid) ||
    (looksLikeGroupId(normalizeJid(leadPhone)) ? normalizeJid(leadPhone) : '');
  const hasGroup = !!groupJid;
  const hasPhone = !!leadPhone?.trim();

  type FetchedConversation = {
    // Linhas no shape de visible_messages da extract-conversation-data (Railway).
    rows: Array<{ direction?: string | null; contact_name?: string | null; message_text?: string | null; created_at?: string | null }>;
    // phone/instance_name como estão gravados em whatsapp_messages — obrigatórios na edge.
    phone: string;
    instanceName: string;
  };

  const fetchMessages = async (): Promise<FetchedConversation> => {
    // A função corta visible_messages nas últimas 300; buscar além disso é desperdício.
    const max = limit === 'all' ? 300 : parseInt(limit, 10);
    // Sem sessão, o RLS do Externo limita anon às últimas 168h (policy de realtime).
    // A sessão anônima autenticada (auth.uid() não-nulo) libera o histórico completo.
    try { await ensureExternalSession(); } catch { /* segue como anon — pega ao menos 7 dias */ }

    let data: Array<Record<string, any>> | null = null;
    if (source === 'group') {
      const jid = groupJid;
      if (!jid) throw new Error('Lead não tem grupo de WhatsApp identificável (sem JID e sem número de grupo)');
      // Cobre os dois formatos em que o grupo pode estar gravado.
      const res = await externalSupabase
        .from('whatsapp_messages')
        .select('created_at, direction, contact_name, message_text, phone, instance_name')
        .in('phone', [jid, `${jid}@g.us`])
        .order('created_at', { ascending: false })
        .limit(max);
      if (res.error) throw res.error;
      data = res.data;
    } else {
      const phone = (leadPhone || '').replace(/\D/g, '');
      if (!phone) throw new Error('Lead não tem telefone do contato');
      const last8 = phone.slice(-8);
      const res = await externalSupabase
        .from('whatsapp_messages')
        .select('created_at, direction, contact_name, message_text, phone, instance_name')
        .ilike('phone', `%${last8}%`)
        .not('phone', 'like', '%@g.us')
        .order('created_at', { ascending: false })
        .limit(max);
      if (res.error) throw res.error;
      data = res.data;
    }

    const desc = data || [];
    // phone/instance_name reais, tirados da mensagem mais recente que tem instância —
    // é o par que a edge usa pra complementar a busca no banco.
    const newest = desc.find(r => r.instance_name);
    return {
      rows: desc.slice().reverse().map(r => ({
        direction: r.direction,
        contact_name: r.contact_name,
        message_text: r.message_text,
        created_at: r.created_at,
      })),
      phone: String(newest?.phone || desc[0]?.phone || '').replace(/@g\.us$/i, ''),
      instanceName: String(newest?.instance_name || ''),
    };
  };

  const handleExtract = async () => {
    if (source === 'group' && !hasGroup) {
      toast.error('Vincule um grupo de WhatsApp ao lead primeiro');
      return;
    }
    if (source === 'contact' && !hasPhone) {
      toast.error('Lead não tem telefone do contato');
      return;
    }
    setLoading(true);
    try {
      const { rows, phone, instanceName } = await fetchMessages();
      if (rows.length === 0) {
        toast.warning('Nenhuma mensagem encontrada para extrair');
        return;
      }
      if (!phone || !instanceName) {
        toast.warning('Mensagens sem instância de WhatsApp identificada — não dá para extrair');
        return;
      }

      // Contrato da extract-conversation-data (Railway; fallback Externo exige o
      // mesmo phone + instance_name): a função monta o prompt, não aceita customPrompt.
      // NÃO passar lead_id/contact_id — gravaria direto no banco sem confirmação.
      const { data, error } = await cloudFunctions.invoke<any>('extract-conversation-data', {
        body: {
          phone,
          instance_name: instanceName,
          targetType: 'lead',
          visible_messages: rows,
        },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || 'extração falhou');

      const extracted = data?.data;
      if (!extracted || typeof extracted !== 'object' || Object.keys(extracted).length === 0) {
        toast.warning('IA não retornou dados estruturados');
        return;
      }

      onDataExtracted(extracted as ExtractedAccidentData);
      toast.success(`Dados extraídos de ${source === 'group' ? 'grupo' : 'contato'} (${limit === 'all' ? 'todas' : limit} msgs)`);
      setOpen(false);
    } catch (err: any) {
      console.error('AI chat extract error:', err);
      toast.error(`Erro: ${err?.message || 'falha ao extrair'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 border-dashed border-primary/50 hover:border-primary"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Extrair com IA (conversa WhatsApp)
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Fonte da conversa</h4>
            <RadioGroup value={source} onValueChange={(v) => setSource(v as Source)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="group" id="src-group" disabled={!hasGroup} />
                <Label htmlFor="src-group" className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <MessageSquare className="h-3.5 w-3.5" /> Grupo do WhatsApp
                  {!hasGroup && <span className="text-[10px] text-muted-foreground">(sem grupo)</span>}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="contact" id="src-contact" disabled={!hasPhone} />
                <Label htmlFor="src-contact" className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <User className="h-3.5 w-3.5" /> Contato vinculado (privado)
                  {!hasPhone && <span className="text-[10px] text-muted-foreground">(sem telefone)</span>}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">Quantas mensagens?</h4>
            <Select value={limit} onValueChange={(v) => setLimit(v as LimitOpt)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">Últimas 50</SelectItem>
                <SelectItem value="200">Últimas 200</SelectItem>
                <SelectItem value="all">Todas (até 300 — limite da IA)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Mais mensagens = contexto melhor, mas mais demorado e mais custo.
            </p>
          </div>

          <Button onClick={handleExtract} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {loading ? 'Analisando...' : 'Extrair agora'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

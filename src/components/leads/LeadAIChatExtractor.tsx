import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles, MessageSquare, User } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase } from '@/integrations/supabase/external-client';
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

  const hasGroup = Array.isArray(whatsappGroups) && whatsappGroups.length > 0;
  const hasPhone = !!leadPhone?.trim();

  const buildPrompt = (messagesText: string) => `Analise a conversa de WhatsApp abaixo e extraia dados estruturados sobre um possível caso jurídico.

Retorne APENAS um JSON válido com os campos disponíveis (deixe vazio o que não souber):
{
  "victim_name": "nome completo da vítima",
  "victim_age": número,
  "accident_date": "YYYY-MM-DD",
  "case_type": "tipo do caso (ex: acidente de trabalho, BPC, maternidade, trânsito)",
  "accident_address": "endereço do fato",
  "damage_description": "descrição do dano/situação em 1-2 frases",
  "contractor_company": "empresa contratante",
  "main_company": "empresa principal",
  "sector": "setor",
  "liability_type": "tipo de responsabilidade",
  "legal_viability": "viabilidade jurídica (Alta/Média/Baixa)",
  "visit_city": "cidade",
  "visit_state": "UF (2 letras)"
}

CONVERSA:
${messagesText}`;

  const fetchMessages = async (): Promise<string> => {
    const max = limit === 'all' ? 5000 : parseInt(limit, 10);

    if (source === 'group') {
      const jid = whatsappGroups?.[0]?.group_jid;
      if (!jid) throw new Error('Lead não tem grupo de WhatsApp vinculado');
      const { data, error } = await externalSupabase
        .from('whatsapp_messages')
        .select('created_at, direction, contact_name, message_text')
        .eq('phone', jid)
        .order('created_at', { ascending: false })
        .limit(max);
      if (error) throw error;
      const rows = (data || []).slice().reverse();
      return rows
        .map(r => `[${r.created_at}] ${r.contact_name || (r.direction === 'outbound' ? 'Equipe' : 'Cliente')}: ${r.message_text || ''}`)
        .join('\n');
    } else {
      const phone = (leadPhone || '').replace(/\D/g, '');
      if (!phone) throw new Error('Lead não tem telefone do contato');
      const last8 = phone.slice(-8);
      const { data, error } = await externalSupabase
        .from('whatsapp_messages')
        .select('created_at, direction, contact_name, message_text, phone')
        .ilike('phone', `%${last8}%`)
        .not('phone', 'like', '%@g.us')
        .order('created_at', { ascending: false })
        .limit(max);
      if (error) throw error;
      const rows = (data || []).slice().reverse();
      return rows
        .map(r => `[${r.created_at}] ${r.direction === 'outbound' ? 'Equipe' : (r.contact_name || 'Cliente')}: ${r.message_text || ''}`)
        .join('\n');
    }
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
      const messagesText = await fetchMessages();
      if (!messagesText.trim()) {
        toast.warning('Nenhuma mensagem encontrada para extrair');
        return;
      }

      const { data, error } = await cloudFunctions.invoke<any>('extract-conversation-data', {
        body: {
          targetType: 'lead_data',
          customPrompt: buildPrompt(messagesText),
        },
      });
      if (error) throw error;

      // Função retorna { success, data: {...campos...} } ou direto o objeto
      const extracted = data?.data || data;
      if (!extracted || typeof extracted !== 'object') {
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
                <SelectItem value="all">Todas (até 5000)</SelectItem>
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

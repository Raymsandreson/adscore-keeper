import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Send, Play, RotateCcw, User, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { db } from '@/integrations/supabase';

interface Props {
  systemPrompt: string;
  model?: string;
  agentName?: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  actions?: DetectedAction[];
}

interface DetectedAction {
  tag: string;        // STATUS, TRANSFERIR, FOLLOWUP, ENCERRAR, ATIVIDADE, GRUPO
  value?: string;
  raw: string;
}

interface LeadOpt {
  id: string;
  name: string | null;
  phone?: string | null;
  email?: string | null;
}

const TEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-agent-chat`;

const ACTION_REGEX = /\[(STATUS|TRANSFERIR|FOLLOWUP|ENCERRAR|ATIVIDADE|GRUPO)(?::([^\]]+))?\]/gi;

const ACTION_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  STATUS: { label: '🏷️ Marcar status', variant: 'secondary' },
  TRANSFERIR: { label: '🙋 Transferir p/ humano', variant: 'default' },
  FOLLOWUP: { label: '⏱️ Agendar follow-up', variant: 'outline' },
  ENCERRAR: { label: '🔚 Encerrar conversa', variant: 'destructive' },
  ATIVIDADE: { label: '📝 Criar atividade', variant: 'secondary' },
  GRUPO: { label: '👥 Encaminhar p/ grupo', variant: 'outline' },
};

function detectActions(text: string): { cleanText: string; actions: DetectedAction[] } {
  const actions: DetectedAction[] = [];
  const cleanText = text.replace(ACTION_REGEX, (raw, tag, value) => {
    actions.push({ tag: tag.toUpperCase(), value: value?.trim(), raw });
    return '';
  }).trim();
  return { cleanText, actions };
}

function buildVariablesFromLead(lead: any, contact: any): Record<string, string> {
  const v: Record<string, string> = {};
  if (lead) {
    v['lead.nome'] = lead.name || lead.nome || '';
    v['lead.telefone'] = lead.phone || lead.telefone || '';
    v['lead.email'] = lead.email || '';
    v['lead.status'] = lead.status || '';
    v['lead.funil'] = lead.funnel_name || lead.funil || '';
    v['lead.etapa'] = lead.stage_name || lead.etapa || '';
    v['lead.acolhedor'] = lead.acolhedor_name || lead.acolhedor || '';
    v['lead.produto'] = lead.product_name || lead.produto || '';
    v['lead.data_criacao'] = lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '';
    v['lead.observacoes'] = lead.notes || lead.observacoes || '';
  }
  if (contact) {
    v['contato.nome'] = contact.name || '';
    v['contato.telefone'] = contact.phone || '';
    v['contato.email'] = contact.email || '';
    v['contato.cpf'] = contact.cpf || '';
    v['contato.cidade'] = contact.city || '';
    v['contato.estado'] = contact.state || '';
    v['contato.profissao'] = contact.profession || '';
    v['contato.classificacao'] = contact.classification || '';
    v['contato.data_nascimento'] = contact.birth_date || '';
  }
  return v;
}

export function AgentTestChat({ systemPrompt, model = 'google/gemini-2.5-flash', agentName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Lead picker
  const [leadSearch, setLeadSearch] = useState('');
  const [leadOptions, setLeadOptions] = useState<LeadOpt[]>([]);
  const [searchingLeads, setSearchingLeads] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

  const variables = buildVariablesFromLead(selectedLead, selectedContact);

  const searchLeads = async (term: string) => {
    if (!term.trim()) { setLeadOptions([]); return; }
    setSearchingLeads(true);
    try {
      const { data, error } = await db
        .from('leads')
        .select('id, lead_name, lead_phone, lead_email')
        .or(`lead_name.ilike.%${term}%,lead_phone.ilike.%${term}%`)
        .limit(8);
      if (error) throw error;
      setLeadOptions((data || []).map((l: any) => ({
        id: l.id,
        name: l.lead_name,
        phone: l.lead_phone,
        email: l.lead_email,
      })));
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao buscar leads');
    } finally {
      setSearchingLeads(false);
    }
  };

  const pickLead = async (opt: LeadOpt) => {
    try {
      const { data: lead } = await db.from('leads').select('*').eq('id', opt.id).maybeSingle();
      setSelectedLead(lead || opt);
      // try fetch primary contact pelo telefone do lead
      const phone = (lead as any)?.lead_phone || opt.phone;
      if (phone) {
        const { data: c } = await db
          .from('contacts')
          .select('*')
          .eq('phone', phone)
          .limit(1)
          .maybeSingle();
        setSelectedContact(c || null);
      }
      setLeadOptions([]);
      setLeadSearch('');
      toast.success(`Lead "${opt.name}" carregado`);
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao carregar lead');
    }
  };

  const clearLead = () => { setSelectedLead(null); setSelectedContact(null); };

  const reset = () => {
    setMessages([]);
    setInput('');
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    if (!systemPrompt.trim()) {
      toast.error('Configure o prompt do agente antes de testar');
      return;
    }
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setIsLoading(true);

    let assistantText = '';
    try {
      const resp = await fetch(TEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          messages: newMessages,
          model,
          variables,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `Erro ${resp.status}` }));
        throw new Error(err.error || `Erro ${resp.status}`);
      }
      if (!resp.body) throw new Error('Sem stream');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { done = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantText += content;
              const { cleanText, actions } = detectActions(assistantText);
              setMessages(prev => {
                const arr = [...prev];
                arr[arr.length - 1] = { role: 'assistant', content: cleanText, actions };
                return arr;
              });
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Erro no teste');
      setMessages(prev => prev.slice(0, -1)); // remove placeholder
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-xs gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Play className="h-3.5 w-3.5" />
        💬 Testar agente em chat
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b">
            <DialogTitle className="text-sm flex items-center gap-2">
              💬 Testar agente {agentName ? `· ${agentName}` : ''}
              <Badge variant="outline" className="text-[10px]">sandbox</Badge>
            </DialogTitle>
          </DialogHeader>

          {/* Lead selector */}
          <div className="px-4 py-2 border-b bg-muted/30 space-y-2">
            {selectedLead ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-medium truncate">{selectedLead.name || 'Sem nome'}</span>
                  <span className="text-muted-foreground truncate">{selectedLead.phone || ''}</span>
                  {selectedContact && <Badge variant="secondary" className="text-[9px]">+contato</Badge>}
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearLead}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead real p/ usar dados (nome ou telefone)..."
                      value={leadSearch}
                      onChange={e => { setLeadSearch(e.target.value); searchLeads(e.target.value); }}
                      className="h-8 text-xs pl-7"
                    />
                  </div>
                </div>
                {searchingLeads && <div className="text-[10px] text-muted-foreground">Buscando...</div>}
                {leadOptions.length > 0 && (
                  <div className="border rounded-md max-h-32 overflow-auto bg-background">
                    {leadOptions.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pickLead(o)}
                        className="w-full text-left px-2 py-1.5 hover:bg-muted text-xs border-b last:border-0"
                      >
                        <span className="font-medium">{o.name || 'Sem nome'}</span>
                        {o.phone && <span className="text-muted-foreground ml-2">{o.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Sem lead selecionado, as variáveis ficam vazias no prompt (você vê o que falta).
                </p>
              </div>
            )}
          </div>

          {/* Chat */}
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-8">
                  Mande uma mensagem como se fosse o cliente. A IA responde usando o prompt configurado.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] space-y-1`}>
                    <div className={`rounded-lg px-3 py-2 text-xs ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card border'
                    }`}>
                      {m.role === 'assistant' ? (
                        <div className="prose prose-xs dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                          <ReactMarkdown>{m.content || '…'}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                    </div>
                    {m.actions && m.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {m.actions.map((a, idx) => {
                          const meta = ACTION_LABELS[a.tag] || { label: a.tag, variant: 'outline' as const };
                          return (
                            <Badge key={idx} variant={meta.variant} className="text-[10px]">
                              {meta.label}{a.value ? `: ${a.value}` : ''}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
                <div className="flex justify-start">
                  <div className="bg-card border rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Pensando...
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t p-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Mensagem como cliente... (Enter envia)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                className="text-xs flex-1"
                disabled={isLoading}
              />
              <Button size="icon" onClick={sendMessage} disabled={!input.trim() || isLoading} className="h-9 w-9 shrink-0">
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
              <Button size="icon" variant="outline" onClick={reset} disabled={isLoading || messages.length === 0} className="h-9 w-9 shrink-0" title="Limpar conversa">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Sandbox — comandos como [STATUS:], [TRANSFERIR:], [FOLLOWUP:] aparecem como etiquetas e não executam nada.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

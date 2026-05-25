import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Loader2, Send, Play, RotateCcw, User, Search, X, Pencil, Save, Download, CheckCheck, Paperclip, Mic, Square } from 'lucide-react';
import { toast } from 'sonner';
import { renderWhatsAppText } from '@/lib/whatsappFormat';
import { db } from '@/integrations/supabase';

interface Props {
  systemPrompt: string;
  model?: string;
  agentName?: string;
  onPromptChange?: (prompt: string) => void;
}

interface Attachment {
  kind: 'image' | 'audio';
  dataUrl: string; // data:...;base64,...
  mime: string;
  name?: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
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
    v['lead.nome'] = lead.lead_name || lead.name || '';
    v['lead.telefone'] = lead.lead_phone || lead.phone || '';
    v['lead.email'] = lead.lead_email || lead.email || '';
    v['lead.status'] = lead.status || '';
    v['lead.funil'] = lead.funnel_name || '';
    v['lead.etapa'] = lead.stage_name || '';
    v['lead.acolhedor'] = lead.acolhedor || '';
    v['lead.produto'] = lead.product_name || lead.case_type || '';
    v['lead.data_criacao'] = lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '';
    v['lead.observacoes'] = lead.notes || '';
  }
  if (contact) {
    v['contato.nome'] = contact.full_name || contact.name || '';
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

export function AgentTestChat({ systemPrompt, model = 'google/gemini-2.5-flash', agentName, onPromptChange }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Prompt editor (sidesheet dentro do dialog)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(systemPrompt);
  useEffect(() => { setDraftPrompt(systemPrompt); }, [systemPrompt]);
  const promptDirty = draftPrompt !== systemPrompt;
  const savePrompt = () => {
    if (!onPromptChange) {
      toast.error('Edição não disponível neste contexto');
      return;
    }
    onPromptChange(draftPrompt);
    toast.success('Prompt atualizado (lembre de salvar o agente)');
    setPromptEditorOpen(false);
  };

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

  const loadRealConversation = async () => {
    const phone = selectedLead?.lead_phone || selectedLead?.phone;
    if (!phone) {
      toast.error('Lead sem telefone — não dá pra carregar conversa');
      return;
    }
    try {
      const digits = String(phone).replace(/\D/g, '');
      const tail = digits.slice(-8);
      const { data, error } = await db
        .from('whatsapp_messages')
        .select('direction, message_text, created_at')
        .ilike('phone', `%${tail}%`)
        .not('message_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const ordered = (data || []).reverse();
      if (ordered.length === 0) {
        toast.error('Nenhuma mensagem encontrada pra esse lead');
        return;
      }
      // inbound (cliente) → user no teste; outbound (nosso) → assistant
      const seeded: Msg[] = ordered
        .filter((m: any) => m.message_text && String(m.message_text).trim())
        .map((m: any) => {
          const text = String(m.message_text);
          if (m.direction === 'outbound') {
            const { cleanText, actions } = detectActions(text);
            return { role: 'assistant' as const, content: cleanText, actions };
          }
          return { role: 'user' as const, content: text };
        });
      setMessages(seeded);
      toast.success(`Carregadas ${seeded.length} mensagens reais`);
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao carregar conversa real');
    }
  };

  // ===== Anexos pendentes (mídia/voz) =====
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // permite re-selecionar mesmo arquivo
    for (const f of files) {
      try {
        if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: máx 8MB`); continue; }
        const dataUrl = await fileToDataUrl(f);
        const kind: 'image' | 'audio' = f.type.startsWith('audio/') ? 'audio' : 'image';
        setPendingAttachments(prev => [...prev, { kind, dataUrl, mime: f.type, name: f.name }]);
      } catch (err) {
        console.error(err);
        toast.error(`Erro ao ler ${f.name}`);
      }
    }
  };

  const removePending = (idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  // ===== Gravação de voz =====
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) recChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        setPendingAttachments(prev => [...prev, {
          kind: 'audio',
          dataUrl,
          mime: blob.type || 'audio/webm',
          name: `voz-${Date.now()}.webm`,
        }]);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (e: any) {
      console.error(e);
      toast.error('Permissão de microfone negada');
    }
  };

  const stopRecording = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    try { mediaRecorderRef.current?.stop(); } catch {}
  }, []);

  // Constrói o content multimodal pra Gemini (campo content como array de parts)
  const buildMessageContent = (text: string, atts: Attachment[]): any => {
    if (atts.length === 0) return text;
    const parts: any[] = [];
    if (text) parts.push({ type: 'text', text });
    for (const a of atts) {
      if (a.kind === 'image') {
        parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      } else if (a.kind === 'audio') {
        // base64 puro pra input_audio
        const base64 = a.dataUrl.split(',')[1] || '';
        const format = (a.mime.includes('webm') ? 'webm' : a.mime.includes('mp3') ? 'mp3' : a.mime.includes('ogg') ? 'ogg' : 'wav');
        parts.push({ type: 'input_audio', input_audio: { data: base64, format } });
      }
    }
    if (!text) parts.unshift({ type: 'text', text: '' });
    return parts;
  };

  const sendMessage = async () => {
    if ((!input.trim() && pendingAttachments.length === 0) || isLoading) return;
    if (!draftPrompt.trim()) {
      toast.error('Configure o prompt do agente antes de testar');
      return;
    }
    const text = input.trim();
    const atts = pendingAttachments;
    const userMsg: Msg = { role: 'user', content: text, attachments: atts.length ? atts : undefined };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setPendingAttachments([]);
    setIsLoading(true);

    // Mensagens enviadas ao backend usam content multimodal
    const wireMessages = newMessages.map(m => ({
      role: m.role,
      content: m.role === 'user'
        ? buildMessageContent(m.content, m.attachments || [])
        : m.content,
    }));

    let assistantText = '';
    try {
      const resp = await fetch(TEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          system_prompt: draftPrompt,
          messages: wireMessages,
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
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-sm flex items-center gap-2 min-w-0">
                <span className="truncate">💬 Testar agente {agentName ? `· ${agentName}` : ''}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">sandbox</Badge>
                {promptDirty && <Badge variant="secondary" className="text-[10px] shrink-0">prompt editado</Badge>}
              </DialogTitle>
              {onPromptChange && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 shrink-0 mr-6"
                  onClick={() => setPromptEditorOpen(true)}
                >
                  <Pencil className="h-3 w-3" />
                  Editar prompt
                </Button>
              )}
            </div>
          </DialogHeader>

          {/* Editor do prompt — sheet lateral dentro do dialog */}
          <Sheet open={promptEditorOpen} onOpenChange={setPromptEditorOpen}>
            <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
              <SheetHeader className="px-4 pt-4 pb-2 border-b">
                <SheetTitle className="text-sm flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5" /> Editar prompt do agente
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-hidden p-3">
                <Textarea
                  value={draftPrompt}
                  onChange={e => setDraftPrompt(e.target.value)}
                  className="h-full w-full text-xs font-mono resize-none"
                  placeholder="Prompt do agente..."
                />
              </div>
              <SheetFooter className="border-t p-3 flex-row gap-2 sm:justify-between">
                <p className="text-[10px] text-muted-foreground self-center">
                  Alterações entram em vigor no próximo teste. Salve o agente pra persistir.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setDraftPrompt(systemPrompt); setPromptEditorOpen(false); }}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={savePrompt} disabled={!promptDirty} className="gap-1">
                    <Save className="h-3 w-3" /> Aplicar
                  </Button>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>


          {/* Lead selector */}
          <div className="px-4 py-2 border-b bg-muted/30 space-y-2">
            {selectedLead ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-medium truncate">{selectedLead.lead_name || selectedLead.name || 'Sem nome'}</span>
                  <span className="text-muted-foreground truncate">{selectedLead.lead_phone || selectedLead.phone || ''}</span>
                  {selectedContact && <Badge variant="secondary" className="text-[9px]">+contato</Badge>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 px-2"
                    onClick={loadRealConversation}
                    title="Pré-carrega as últimas mensagens reais do WhatsApp como histórico"
                  >
                    <Download className="h-3 w-3" /> Carregar conversa
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearLead}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
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

          {/* Chat — visual WhatsApp */}
          <ScrollArea
            className="flex-1 px-3 py-3"
            style={{
              backgroundColor: '#ECE5DD',
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><circle cx='20' cy='20' r='1' fill='%23000' opacity='0.04'/></svg>\")",
            }}
          >
            <div className="space-y-1.5">
              {messages.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-8 bg-white/70 rounded-md mx-8 px-3 py-2">
                  Mande uma mensagem como se fosse o cliente. A IA (agente) responde no balão verde, como vai aparecer no WhatsApp.
                </div>
              )}
              {messages.map((m, i) => {
                // cliente (quem escreve no teste) = inbound, esquerda branca
                // agente IA = outbound, direita verde-claro (estilo WhatsApp)
                const isAgent = m.role === 'assistant';
                return (
                  <div key={i} className={`flex ${isAgent ? 'justify-end' : 'justify-start'} px-1`}>
                    <div className="max-w-[85%] space-y-1">
                      <div
                        className={`relative rounded-lg px-2.5 py-1.5 text-[13px] leading-snug shadow-sm ${
                          isAgent ? 'bg-[#DCF8C6] text-[#111B21]' : 'bg-white text-[#111B21]'
                        }`}
                        style={{ wordBreak: 'break-word' }}
                      >
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="space-y-1 mb-1">
                            {m.attachments.map((a, ai) => (
                              <div key={ai}>
                                {a.kind === 'image' ? (
                                  <img
                                    src={a.dataUrl}
                                    alt={a.name || 'imagem'}
                                    className="rounded max-w-full max-h-60 object-cover block"
                                  />
                                ) : (
                                  <audio src={a.dataUrl} controls className="w-full max-w-[260px] h-9" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(m.content || (!m.attachments?.length)) && (
                          <div className="whitespace-pre-wrap">
                            {renderWhatsAppText(m.content || (m.attachments?.length ? '' : '…'))}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5 text-[10px] text-[#667781]">
                          <span>
                            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isAgent && <CheckCheck className="h-3 w-3 text-[#53BDEB]" />}
                        </div>
                      </div>
                      {m.actions && m.actions.length > 0 && (
                        <div className={`flex flex-wrap gap-1 ${isAgent ? 'justify-end' : ''}`}>
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
                );
              })}
              {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
                <div className="flex justify-end px-1">
                  <div className="bg-[#DCF8C6] rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 text-[#667781] shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin" /> digitando...
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t p-3 space-y-2">
            {/* Preview de anexos pendentes */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((a, idx) => (
                  <div key={idx} className="relative border rounded-md p-1 bg-muted/40">
                    {a.kind === 'image' ? (
                      <img src={a.dataUrl} alt={a.name} className="h-14 w-14 object-cover rounded" />
                    ) : (
                      <div className="h-14 px-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Mic className="h-3.5 w-3.5" />
                        <audio src={a.dataUrl} controls className="h-8 max-w-[180px]" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePending(idx)}
                      className="absolute -top-1.5 -right-1.5 bg-background border rounded-full h-5 w-5 flex items-center justify-center hover:bg-muted"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {recording && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" />
                Gravando... {Math.floor(recSeconds / 60).toString().padStart(2, '0')}:{(recSeconds % 60).toString().padStart(2, '0')}
                <Button size="sm" variant="outline" className="h-7 ml-auto gap-1" onClick={stopRecording}>
                  <Square className="h-3 w-3" /> Parar
                </Button>
              </div>
            )}

            <div className="flex gap-2 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*"
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || recording}
                title="Anexar imagem ou áudio"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={recording ? 'destructive' : 'ghost'}
                className="h-9 w-9 shrink-0"
                onClick={recording ? stopRecording : startRecording}
                disabled={isLoading}
                title={recording ? 'Parar gravação' : 'Gravar mensagem de voz'}
              >
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Input
                placeholder={pendingAttachments.length ? 'Legenda (opcional)...' : 'Mensagem como cliente... (Enter envia)'}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                className="text-xs flex-1"
                disabled={isLoading || recording}
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={(!input.trim() && pendingAttachments.length === 0) || isLoading || recording}
                className="h-9 w-9 shrink-0"
              >
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
              <Button size="icon" variant="outline" onClick={reset} disabled={isLoading || messages.length === 0} className="h-9 w-9 shrink-0" title="Limpar conversa">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Sandbox — imagens e áudio são enviados pra IA testar OCR/transcrição. Comandos [STATUS:], [TRANSFERIR:], [FOLLOWUP:] aparecem como etiquetas e não executam nada.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Send, Mic, MicOff, Paperclip, Sparkles, Loader2, X, Check,
  FileText, User, Briefcase, Plus, Ban, CalendarCheck, ArrowRight, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ChatMessage {
  id: string;
  activity_id: string | null;
  lead_id: string | null;
  message_type: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  audio_duration: number | null;
  ai_suggestion: any;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by_name: string | null;
}

interface EntityAIChatProps {
  leadId: string | null;
  activityId?: string | null;
  contactId?: string | null;
  entityType: 'lead' | 'activity' | 'contact';
  onApplyLeadFields?: (fields: Record<string, string>) => void;
  onApplyContactFields?: (fields: Record<string, string>) => void;
  onApplyActivityFields?: (fields: Record<string, string>) => void;
  onCreateActivity?: (activity: any) => void;
  className?: string;
}

export function EntityAIChat({
  leadId,
  activityId,
  contactId,
  entityType,
  onApplyLeadFields,
  onApplyContactFields,
  onApplyActivityFields,
  onCreateActivity,
  className,
}: EntityAIChatProps) {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [aiResponding, setAiResponding] = useState(false);
  const [aiProgressSteps, setAiProgressSteps] = useState<{ label: string; status: 'pending' | 'active' | 'done' }[]>([]);
  const [userName, setUserName] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimeRef = useRef(0);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('full_name').eq('user_id', user.id).single()
      .then(({ data }) => setUserName(data?.full_name || user.email || 'Usuário'));
  }, [user]);

  // Determine the conversation key: prefer leadId, fallback to activityId
  const conversationKey = leadId || activityId;
  const conversationField = leadId ? 'lead_id' : 'activity_id';

  const fetchMessages = useCallback(async () => {
    if (!conversationKey || !user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('activity_chat_messages')
        .select('*')
        .eq(conversationField, conversationKey)
        .or(`sender_id.eq.${user.id},sender_id.is.null`)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages((data || []) as ChatMessage[]);
    } catch (e) {
      console.error('Error fetching chat:', e);
    } finally {
      setLoading(false);
    }
  }, [conversationKey, conversationField, user?.id]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (!conversationKey) return;
    const channel = supabase
      .channel(`entity_chat_${conversationKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_chat_messages', filter: `${conversationField}=eq.${conversationKey}` }, () => fetchMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationKey, conversationField, fetchMessages]);

  const sendMessage = async (type: string, content?: string, fileUrl?: string, fileName?: string, fileSize?: number, audioDuration?: number) => {
    if (!conversationKey) return;
    setSending(true);
    try {
      await supabase.from('activity_chat_messages').insert({
        activity_id: activityId || null,
        lead_id: leadId,
        message_type: type,
        content: content || null,
        file_url: fileUrl || null,
        file_name: fileName || null,
        file_size: fileSize || null,
        audio_duration: audioDuration || null,
        sender_id: user?.id || null,
        sender_name: userName || null,
      } as any);
      await fetchMessages();
      setInputText('');
    } catch (e) {
      console.error('Error sending message:', e);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    await sendMessage('text', text);
    await triggerAIAssistant(text);
  };

  const triggerAIAssistant = async (lastUserMessage?: string) => {
    if (!conversationKey) return;
    setAiResponding(true);
    const steps = [
      { label: 'Lendo contexto da conversa...', status: 'active' as const },
      { label: 'Analisando dados do caso...', status: 'pending' as const },
      { label: 'Gerando resposta inteligente...', status: 'pending' as const },
      { label: 'Preparando sugestões...', status: 'pending' as const },
    ];
    setAiProgressSteps([...steps]);
    try {
      const chatHistory = messages
        .filter(m => !m.deleted_at)
        .map(m => ({
          role: m.sender_name === 'IA WhatsJUD' ? 'ai' : 'user',
          content: m.content || '',
          type: m.message_type,
          file_url: m.file_url,
        }));
      if (lastUserMessage) {
        chatHistory.push({ role: 'user', content: lastUserMessage, type: 'text', file_url: null });
      }

      // Progress: step 1 done, step 2 active
      setAiProgressSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'done' } : i === 1 ? { ...s, status: 'active' } : s
      ));

      // Fetch context
      let leadData = null;
      let contactData = null;
      let activityData = null;
      let activityHistory: any[] = [];

      if (leadId) {
        const { data: ld } = await supabase.from('leads').select('*').eq('id', leadId).single();
        leadData = ld;

        const { data: histData } = await supabase
          .from('lead_activities')
          .select('title, status, activity_type, what_was_done, current_status_notes, next_steps, deadline')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false })
          .limit(10);
        activityHistory = histData || [];
      }

      if (contactId) {
        const { data: cd } = await supabase.from('contacts').select('*').eq('id', contactId).single();
        contactData = cd;
      }

      if (activityId) {
        const { data: ad } = await supabase.from('lead_activities').select('*').eq('id', activityId).single();
        activityData = ad;
        if (ad?.contact_id && !contactData) {
          const { data: cd } = await supabase.from('contacts').select('*').eq('id', (ad as any).contact_id).single();
          contactData = cd;
        }
        // If no lead but has activity, fetch sibling activities
        if (!leadId && activityHistory.length === 0) {
          activityHistory = [activityData].filter(Boolean);
        }
      }

      // Progress: step 2 done, step 3 active
      setAiProgressSteps(prev => prev.map((s, i) => 
        i <= 1 ? { ...s, status: 'done' } : i === 2 ? { ...s, status: 'active' } : s
      ));

      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
        body: {
          mode: 'assistant',
          context: {
            chat_history: chatHistory,
            activity_context: activityData,
            lead_context: leadData,
            contact_context: contactData,
            activity_history: activityHistory,
            entity_type: entityType,
          },
        },
      });

      if (error) throw error;

      // Progress: step 3 done, step 4 active
      setAiProgressSteps(prev => prev.map((s, i) => 
        i <= 2 ? { ...s, status: 'done' } : i === 3 ? { ...s, status: 'active' } : s
      ));

      await supabase.from('activity_chat_messages').insert({
        activity_id: activityId || null,
        lead_id: leadId || null,
        message_type: 'ai_suggestion',
        content: data.response_text,
        ai_suggestion: {
          ...(data.activity_fields ? { activity_fields: data.activity_fields } : {}),
          ...(data.lead_fields ? { lead_fields: data.lead_fields } : {}),
          ...(data.contact_fields ? { contact_fields: data.contact_fields } : {}),
          ...(data.new_activity ? { new_activity: data.new_activity } : {}),
          ...(data.follow_up_suggestions?.length ? { follow_up_suggestions: data.follow_up_suggestions } : {}),
        },
        sender_id: null,
        sender_name: 'IA WhatsJUD',
      } as any);

      await fetchMessages();
    } catch (e: any) {
      console.error('AI assistant error:', e);
      toast.error('Erro ao obter resposta da IA');
    } finally {
      setAiProgressSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
      setTimeout(() => {
        setAiResponding(false);
        setAiProgressSteps([]);
      }, 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      const filePath = `${conversationKey}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
      const isImage = file.type.startsWith('image/');
      await sendMessage(isImage ? 'image' : 'pdf', file.name, publicUrl, file.name, file.size);
    } catch (e) {
      console.error('Error uploading file:', e);
      toast.error('Erro ao enviar arquivo');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const recordedMime = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: recordedMime });
        const duration = recordingTimeRef.current;
        if (audioBlob.size === 0) { toast.error('Nenhum áudio capturado'); return; }
        setSending(true);
        try {
          const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
          const filePath = `${conversationKey}/${Date.now()}_audio.${ext}`;
          const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, audioBlob);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
          await sendMessage('audio', `Áudio (${duration}s)`, publicUrl, `audio.${ext}`, audioBlob.size, duration);
          // Auto-trigger AI for audio
          await triggerAIAssistant(`[Áudio enviado: ${duration}s]`);
        } catch (e) {
          console.error('Error uploading audio:', e);
          toast.error('Erro ao enviar áudio');
        } finally { setSending(false); }
      };

      mediaRecorder.start(1000);
      setRecording(true);
      timerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
      }, 1000);
    } catch (e) {
      console.error('Error starting recording:', e);
      toast.error('Erro ao acessar microfone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getEntityLink = (type: 'activity' | 'lead' | 'contact', id: string | null | undefined) => {
    if (!id) return null;
    const base = window.location.origin;
    switch (type) {
      case 'activity': return `${base}/?openActivity=${id}`;
      case 'lead': return `${base}/leads?openLead=${id}`;
      case 'contact': return `${base}/leads?tab=contacts&openContact=${id}`;
    }
  };

  const EntityLinkBtn = ({ type, id, label }: { type: 'activity' | 'lead' | 'contact'; id: string | null | undefined; label: string }) => {
    const link = getEntityLink(type, id);
    if (!link) return null;
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 hover:underline font-medium"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="h-2.5 w-2.5" />
        {label}
      </a>
    );
  };

  const renderMessage = (msg: ChatMessage) => {
    const isOwn = msg.sender_id === user?.id;
    const isAI = msg.message_type === 'ai_suggestion';
    const isDeleted = !!msg.deleted_at;

    if (isDeleted) {
      return (
        <div key={msg.id} className={cn("flex mb-2", isOwn ? "justify-end" : "justify-start")}>
          <div className="max-w-[75%] rounded-2xl px-3 py-2 text-sm opacity-60 italic bg-muted/50 text-muted-foreground rounded-bl-md">
            <div className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 shrink-0" />
              <span className="text-xs">Apagada por {msg.deleted_by_name || 'usuário'}</span>
            </div>
          </div>
        </div>
      );
    }

    if (isAI) {
      const rawSuggestion = msg.ai_suggestion as any;
      const hasActions = rawSuggestion && ('activity_fields' in rawSuggestion || 'lead_fields' in rawSuggestion || 'contact_fields' in rawSuggestion || 'new_activity' in rawSuggestion);

      return (
        <div key={msg.id} className="flex justify-start mb-2">
          <div className="max-w-[90%] space-y-1.5">
            <div className="bg-primary/10 border border-primary/20 rounded-2xl rounded-bl-md px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary mb-1">
                <Sparkles className="h-3 w-3" /> IA WhatsJUD
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <div className="text-[10px] text-muted-foreground mt-1">
                {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
              </div>
            </div>

            {hasActions && (
              <div className="space-y-1 pl-1">
                {rawSuggestion.activity_fields && Object.keys(rawSuggestion.activity_fields).length > 0 && (
                  <button
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/15 transition-colors text-left"
                    onClick={() => {
                      onApplyActivityFields?.(rawSuggestion.activity_fields);
                      toast.success('Campos da atividade atualizados!');
                    }}
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <FileText className="h-3 w-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium">Preencher campos da atividade</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{Object.keys(rawSuggestion.activity_fields).length} campo(s)</span>
                        <EntityLinkBtn type="activity" id={activityId} label="Abrir" />
                      </div>
                    </div>
                    <Check className="h-3 w-3 text-primary shrink-0" />
                  </button>
                )}

                {rawSuggestion.lead_fields && Object.keys(rawSuggestion.lead_fields).length > 0 && (
                  <button
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 transition-colors text-left"
                    onClick={() => {
                      onApplyLeadFields?.(rawSuggestion.lead_fields);
                      toast.success('Campos do lead atualizados!');
                    }}
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Briefcase className="h-3 w-3 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium">Atualizar Lead</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{Object.entries(rawSuggestion.lead_fields).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                        <EntityLinkBtn type="lead" id={leadId} label="Abrir" />
                      </div>
                    </div>
                    <Check className="h-3 w-3 text-amber-600 shrink-0" />
                  </button>
                )}

                {rawSuggestion.contact_fields && Object.keys(rawSuggestion.contact_fields).length > 0 && (
                  <button
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors text-left"
                    onClick={() => {
                      onApplyContactFields?.(rawSuggestion.contact_fields);
                      toast.success('Campos do contato atualizados!');
                    }}
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <User className="h-3 w-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium">Atualizar Contato</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{Object.entries(rawSuggestion.contact_fields).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                        <EntityLinkBtn type="contact" id={contactId} label="Abrir" />
                      </div>
                    </div>
                    <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                  </button>
                )}

                {rawSuggestion.new_activity && (
                  <button
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 transition-colors text-left"
                    onClick={() => {
                      onCreateActivity?.(rawSuggestion.new_activity);
                      toast.success('Atividade criada!');
                    }}
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <Plus className="h-3 w-3 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium">Criar Atividade</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {rawSuggestion.new_activity.title}
                      </div>
                    </div>
                    <CalendarCheck className="h-3 w-3 text-blue-600 shrink-0" />
                  </button>
                )}
              </div>
            )}

            {/* Follow-up suggestion chips */}
            {rawSuggestion?.follow_up_suggestions?.length > 0 && msg.id === messages.filter(m => m.message_type === 'ai_suggestion' && !m.deleted_at).slice(-1)[0]?.id && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {rawSuggestion.follow_up_suggestions.map((s: any, i: number) => (
                  <button
                    key={i}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/15 transition-colors text-[11px] font-medium text-primary"
                    onClick={() => setInputText(s.message)}
                  >
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // User message
    if (msg.message_type === 'audio' && msg.file_url) {
      return (
        <div key={msg.id} className={cn("flex mb-2", isOwn ? "justify-end" : "justify-start")}>
          <div className={cn("max-w-[75%] rounded-2xl px-3 py-2", isOwn ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md")}>
            <audio controls className="max-w-full" preload="none">
              <source src={msg.file_url} />
            </audio>
            <div className={cn("text-[10px] mt-1", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
              {msg.sender_name} • {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
            </div>
          </div>
        </div>
      );
    }

    if (msg.message_type === 'image' && msg.file_url) {
      return (
        <div key={msg.id} className={cn("flex mb-2", isOwn ? "justify-end" : "justify-start")}>
          <div className={cn("max-w-[75%] rounded-2xl px-3 py-2", isOwn ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md")}>
            <img src={msg.file_url} alt="" className="max-w-full rounded-lg max-h-[200px] object-cover" loading="lazy" />
            <div className={cn("text-[10px] mt-1", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
              {msg.sender_name} • {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className={cn("flex mb-2", isOwn ? "justify-end" : "justify-start")}>
        <div className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          isOwn ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
        )}>
          {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
          {msg.file_url && !msg.content && (
            <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className="text-xs underline">
              📎 {msg.file_name || 'Arquivo'}
            </a>
          )}
          <div className={cn("text-[10px] mt-1", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
            {msg.sender_name} • {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    );
  };

  if (!conversationKey) {
    return (
      <div className={cn("flex items-center justify-center h-full text-sm text-muted-foreground", className)}>
        Vincule um lead ou salve a atividade para usar o Chat IA
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium">Chat IA</span>
        <span className="text-[10px] text-muted-foreground">
          {leadId ? '• Histórico compartilhado do lead' : '• Histórico da atividade'}
        </span>
        {aiResponding && <Loader2 className="h-3 w-3 animate-spin text-primary ml-auto" />}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary/30" />
            <p>Envie uma mensagem ou áudio para começar.</p>
            <p className="mt-1">A IA vai orientar e sugerir atualizações.</p>
          </div>
        ) : (
          messages.map(renderMessage)
        )}
        {aiResponding && aiProgressSteps.length > 0 && (
          <div className="flex justify-start mb-2">
            <div className="max-w-[85%] bg-primary/10 border border-primary/20 rounded-2xl rounded-bl-md px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary mb-1">
                <Sparkles className="h-3 w-3 animate-pulse" /> IA trabalhando...
              </div>
              {aiProgressSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  {step.status === 'done' ? (
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                  ) : step.status === 'active' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />
                  )}
                  <span className={cn(
                    step.status === 'done' && "text-muted-foreground line-through",
                    step.status === 'active' && "text-primary font-medium",
                    step.status === 'pending' && "text-muted-foreground/50"
                  )}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t shrink-0">
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf,.doc,.docx" onChange={handleFileUpload} />
        
        {recording ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full bg-destructive/10 border border-destructive/30">
              <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-xs font-medium text-destructive">{formatTime(recordingTime)}</span>
            </div>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => { mediaRecorderRef.current?.ondataavailable && (mediaRecorderRef.current.ondataavailable = null); mediaRecorderRef.current?.stop(); mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop()); setRecording(false); if (timerRef.current) clearInterval(timerRef.current); }}>
              <X className="h-4 w-4" />
            </Button>
            <Button size="icon" className="h-9 w-9 bg-primary" onClick={stopRecording}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={sending}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite ou grave áudio..."
              className="h-9 text-sm"
              disabled={sending || aiResponding}
            />
            {inputText.trim() ? (
              <Button size="icon" className="h-9 w-9 shrink-0 bg-primary" onClick={handleSendText} disabled={sending || aiResponding}>
                <Send className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={startRecording} disabled={sending || aiResponding}>
                <Mic className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

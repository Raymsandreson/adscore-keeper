import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Send, Mic, MicOff, Paperclip, Image, FileText, Sparkles, Loader2, Play, Pause, X, Check, Download, Phone, PhoneOff,
  Info, User, Briefcase, MapPin, Calendar, ArrowRight, PhoneCall, FileSearch, CalendarCheck, Mail, CheckCircle, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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
}

interface AISuggestion {
  what_was_done: string;
  current_status_notes: string;
  next_steps: string;
  notes: string;
}

interface ActivityChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string | null;
  leadId: string | null;
  activityTitle?: string;
  onApplySuggestion: (suggestion: AISuggestion) => void;
}

export function ActivityChatSheet({ open, onOpenChange, activityId, leadId, activityTitle, onApplySuggestion }: ActivityChatSheetProps) {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [callRecording, setCallRecording] = useState(false);
  const [callRecordingTime, setCallRecordingTime] = useState(0);
   const [pendingSuggestion, setPendingSuggestion] = useState<AISuggestion | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [contextData, setContextData] = useState<{
    activity: any | null;
    lead: any | null;
    contact: any | null;
  }>({ activity: null, lead: null, contact: null });
  const [contextLoading, setContextLoading] = useState(false);
  const [actionSuggestions, setActionSuggestions] = useState<{ label: string; detail: string; icon: string }[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const callMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const callAudioChunksRef = useRef<Blob[]>([]);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callStreamsRef = useRef<MediaStream[]>([]);

  // Fetch user name
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('full_name').eq('user_id', user.id).single()
      .then(({ data }) => setUserName(data?.full_name || user.email || 'Usuário'));
  }, [user]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!activityId && !leadId) return;
    setLoading(true);
    try {
      let query = supabase.from('activity_chat_messages').select('*').order('created_at', { ascending: true });
      if (activityId) query = query.eq('activity_id', activityId);
      else if (leadId) query = query.eq('lead_id', leadId);

      const { data, error } = await query;
      if (error) throw error;
      setMessages((data || []) as ChatMessage[]);
    } catch (e) {
      console.error('Error fetching chat messages:', e);
    } finally {
      setLoading(false);
    }
  }, [activityId, leadId]);

  // Fetch AI action suggestions
  const fetchActionSuggestions = useCallback(async (actData: any, leadData: any, contactData: any) => {
    setActionsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-activity-chat', {
        body: {
          mode: 'suggest_actions',
          context: {
            activity_title: actData?.title || '',
            activity_type: actData?.activity_type || '',
            what_was_done: actData?.what_was_done || '',
            current_status_notes: actData?.current_status_notes || '',
            next_steps: actData?.next_steps || '',
            notes: actData?.notes || '',
            lead_name: leadData?.lead_name || '',
            case_type: leadData?.case_type || '',
            lead_status: leadData?.status || '',
            contact_name: contactData?.full_name || '',
            contact_phone: contactData?.phone || '',
          },
        },
      });
      if (error) throw error;
      setActionSuggestions(data?.actions || []);
    } catch (e) {
      console.error('Error fetching action suggestions:', e);
    } finally {
      setActionsLoading(false);
    }
  }, []);

  // Fetch context data (activity, lead, contact)
  const fetchContext = useCallback(async () => {
    if (!activityId) return;
    setContextLoading(true);
    try {
      const { data: actData } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('id', activityId)
        .single();

      let leadData = null;
      let contactData = null;

      if (actData) {
        if (actData.lead_id) {
          const { data: ld } = await supabase.from('leads').select('*').eq('id', actData.lead_id).single();
          leadData = ld;
        }
        if (actData.contact_id) {
          const { data: cd } = await supabase.from('contacts').select('*').eq('id', actData.contact_id).single();
          contactData = cd;
        }
      }

      setContextData({ activity: actData, lead: leadData, contact: contactData });
      if (actData) {
        fetchActionSuggestions(actData, leadData, contactData);
      }
    } catch (e) {
      console.error('Error fetching context:', e);
    } finally {
      setContextLoading(false);
    }
  }, [activityId, fetchActionSuggestions]);

  useEffect(() => {
    if (open) {
      fetchMessages();
      fetchContext();
    }
  }, [open, fetchMessages, fetchContext]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (type: string, content?: string, fileUrl?: string, fileName?: string, fileSize?: number, audioDuration?: number) => {
    if (!activityId && !leadId) return;
    setSending(true);
    try {
      const { error } = await supabase.from('activity_chat_messages').insert({
        activity_id: activityId,
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
      if (error) throw error;
      await fetchMessages();
      setInputText('');
    } catch (e) {
      console.error('Error sending message:', e);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const handleSendText = () => {
    if (!inputText.trim()) return;
    sendMessage('text', inputText.trim());
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

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    const messageType = isImage ? 'image' : isPdf ? 'pdf' : 'pdf';

    setSending(true);
    try {
      const filePath = `${activityId || leadId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
      await sendMessage(messageType, file.name, publicUrl, file.name, file.size);
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
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const duration = recordingTime;

        setSending(true);
        try {
          const filePath = `${activityId || leadId}/${Date.now()}_audio.webm`;
          const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, audioBlob);
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
          await sendMessage('audio', `Áudio (${duration}s)`, publicUrl, 'audio.webm', audioBlob.size, duration);
        } catch (e) {
          console.error('Error uploading audio:', e);
          toast.error('Erro ao enviar áudio');
        } finally {
          setSending(false);
        }
      };

      mediaRecorder.start();
      setRecording(true);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
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

  const cancelRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      const stream = mediaRecorderRef.current.stream;
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingTime(0);
    }
  };

  // Call Recording (system audio + mic, fallback to mic-only on mobile)
  const startCallRecording = async () => {
    try {
      const supportsDisplayMedia = !!(navigator.mediaDevices as any)?.getDisplayMedia;

      let recordStream: MediaStream;
      let streams: MediaStream[] = [];
      let audioContext: AudioContext | null = null;
      let isMicOnly = false;

      if (supportsDisplayMedia) {
        try {
          const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
            video: false,
            audio: true,
          });

          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });

          streams = [displayStream, micStream];
          audioContext = new AudioContext();
          const destination = audioContext.createMediaStreamDestination();
          audioContext.createMediaStreamSource(displayStream).connect(destination);
          audioContext.createMediaStreamSource(micStream).connect(destination);
          recordStream = destination.stream;

          displayStream.getAudioTracks()[0].onended = () => {
            if (callRecording) stopCallRecording();
          };
        } catch (displayErr: any) {
          if (displayErr.name === 'NotAllowedError') {
            toast.error('Permissão negada. Selecione a aba e marque "Compartilhar áudio".');
            return;
          }
          // Fallback to mic only
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          streams = [micStream];
          recordStream = micStream;
          isMicOnly = true;
        }
      } else {
        // Mobile / unsupported: mic only
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streams = [micStream];
        recordStream = micStream;
        isMicOnly = true;
      }

      callStreamsRef.current = streams;

      const mediaRecorder = new MediaRecorder(recordStream, { mimeType: 'audio/webm' });
      callMediaRecorderRef.current = mediaRecorder;
      callAudioChunksRef.current = [];
      setCallRecordingTime(0);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) callAudioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        callStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
        callStreamsRef.current = [];
        if (audioContext) audioContext.close();
        const audioBlob = new Blob(callAudioChunksRef.current, { type: 'audio/webm' });
        const duration = callRecordingTime;

        setSending(true);
        try {
          const filePath = `${activityId || leadId}/${Date.now()}_call.webm`;
          const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, audioBlob);
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
          const label = isMicOnly ? '🎙️ Gravação (só microfone)' : '📞 Gravação de chamada';
          await sendMessage('audio', `${label} (${Math.floor(duration / 60)}min ${duration % 60}s)`, publicUrl, 'call_recording.webm', audioBlob.size, duration);
        } catch (e) {
          console.error('Error uploading call recording:', e);
          toast.error('Erro ao enviar gravação da chamada');
        } finally {
          setSending(false);
        }
      };

      mediaRecorder.start();
      setCallRecording(true);
      callTimerRef.current = setInterval(() => setCallRecordingTime(t => t + 1), 1000);

      if (isMicOnly) {
        toast.info('Gravando apenas seu microfone. No celular, use viva-voz para capturar a outra pessoa.');
      } else {
        toast.success('Gravação de chamada iniciada! Áudio do sistema + microfone.');
      }
    } catch (e: any) {
      console.error('Error starting call recording:', e);
      toast.error('Erro ao iniciar gravação de chamada');
    }
  };

  const stopCallRecording = () => {
    if (callMediaRecorderRef.current && callRecording) {
      callMediaRecorderRef.current.stop();
      setCallRecording(false);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    }
  };

  const cancelCallRecording = () => {
    if (callMediaRecorderRef.current && callRecording) {
      callMediaRecorderRef.current.ondataavailable = null;
      callMediaRecorderRef.current.onstop = null;
      callMediaRecorderRef.current.stop();
      callStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
      callStreamsRef.current = [];
      setCallRecording(false);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      setCallRecordingTime(0);
    }
  };

  // AI Analysis
  const handleAIAnalyze = async () => {
    if (messages.length === 0) {
      toast.error('Envie mensagens primeiro para a IA analisar');
      return;
    }
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-activity-chat', {
        body: { messages: messages.map(m => ({ content: m.content, message_type: m.message_type, sender_name: m.sender_name, file_name: m.file_name, file_url: m.file_url, audio_duration: m.audio_duration })) },
      });
      if (error) throw error;
      if (data?.suggestion) {
        setPendingSuggestion(data.suggestion);
        // Save AI suggestion as a message
        await supabase.from('activity_chat_messages').insert({
          activity_id: activityId,
          lead_id: leadId,
          message_type: 'ai_suggestion',
          content: JSON.stringify(data.suggestion),
          ai_suggestion: data.suggestion,
          sender_id: null,
          sender_name: 'IA Abraci',
        } as any);
        await fetchMessages();
        toast.success('IA analisou o chat! Revise a sugestão abaixo.');
      }
    } catch (e) {
      console.error('Error analyzing chat:', e);
      toast.error('Erro ao analisar com IA');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApplySuggestion = (suggestion: AISuggestion) => {
    onApplySuggestion(suggestion);
    setPendingSuggestion(null);
    toast.success('Sugestão aplicada nos campos!');
  };

  const getActionIcon = (icon: string) => {
    switch (icon) {
      case 'phone': return <PhoneCall className="h-3.5 w-3.5" />;
      case 'document': return <FileSearch className="h-3.5 w-3.5" />;
      case 'meeting': return <CalendarCheck className="h-3.5 w-3.5" />;
      case 'email': return <Mail className="h-3.5 w-3.5" />;
      case 'check': return <CheckCircle className="h-3.5 w-3.5" />;
      case 'search': return <Search className="h-3.5 w-3.5" />;
      default: return <ArrowRight className="h-3.5 w-3.5" />;
    }
  };

  const handleActionClick = async (action: { label: string; detail: string }) => {
    setExecutingAction(action.label);
    // Send the action as a user message
    await sendMessage('text', `📋 Ação selecionada: ${action.label}\n${action.detail}`);
    // Auto-trigger AI analysis after sending
    setTimeout(() => {
      handleAIAnalyze();
      setExecutingAction(null);
    }, 500);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const renderMessage = (msg: ChatMessage) => {
    const isOwn = msg.sender_id === user?.id;
    const isAI = msg.message_type === 'ai_suggestion';

    if (isAI) {
      const suggestion = msg.ai_suggestion as AISuggestion | null;
      if (!suggestion) return null;
      return (
        <div key={msg.id} className="flex justify-center my-3">
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 max-w-[90%] space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Sugestão da IA
            </div>
            <Separator />
            <div className="space-y-1.5 text-xs">
              {suggestion.what_was_done && (
                <div><span className="font-medium">O que foi feito:</span> {suggestion.what_was_done}</div>
              )}
              {suggestion.current_status_notes && (
                <div><span className="font-medium">Status atual:</span> {suggestion.current_status_notes}</div>
              )}
              {suggestion.next_steps && (
                <div><span className="font-medium">Próximos passos:</span> {suggestion.next_steps}</div>
              )}
              {suggestion.notes && (
                <div><span className="font-medium">Observações:</span> {suggestion.notes}</div>
              )}
            </div>
            <Button size="sm" className="w-full h-7 text-xs mt-1" onClick={() => handleApplySuggestion(suggestion)}>
              <Check className="h-3 w-3 mr-1" /> Aplicar nos campos
            </Button>
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
          {!isOwn && <div className="text-[10px] font-medium mb-0.5 opacity-70">{msg.sender_name}</div>}

          {msg.message_type === 'text' && <p className="whitespace-pre-wrap">{msg.content}</p>}

          {msg.message_type === 'audio' && (
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <audio src={msg.file_url || ''} controls className="h-8 w-full" style={{ maxWidth: 200 }} />
              </div>
            </div>
          )}

          {msg.message_type === 'image' && (
            <div>
              <img src={msg.file_url || ''} alt={msg.file_name || 'imagem'} className="rounded-lg max-w-full max-h-48 object-cover" />
              {msg.content && msg.content !== msg.file_name && <p className="text-xs mt-1 opacity-80">{msg.content}</p>}
            </div>
          )}

          {msg.message_type === 'pdf' && (
            <a href={msg.file_url || ''} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-80">
              <FileText className="h-4 w-4 shrink-0" />
              <div className="truncate text-xs">{msg.file_name || 'documento.pdf'}</div>
              <Download className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}

          <div className={cn("text-[10px] mt-1", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
            {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{activityTitle || 'Chat da Atividade'}</div>
                <div className="text-[10px] text-muted-foreground font-normal">{messages.length} mensagens</div>
              </div>
            </SheetTitle>
          </SheetHeader>
        </div>

        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 bg-background" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--muted)) 1px, transparent 0)', backgroundSize: '20px 20px' }}>
          {/* Context Card */}
          {contextData.activity && (
            <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Info className="h-3.5 w-3.5" /> Contexto da Atividade
              </div>
              <Separator className="bg-primary/10" />
              
              {/* Activity fields */}
              <div className="space-y-1 text-[11px]">
                {contextData.activity.what_was_done && (
                  <div><span className="font-medium text-muted-foreground">O que foi feito:</span> {contextData.activity.what_was_done}</div>
                )}
                {contextData.activity.current_status_notes && (
                  <div><span className="font-medium text-muted-foreground">Como está:</span> {contextData.activity.current_status_notes}</div>
                )}
                {contextData.activity.next_steps && (
                  <div className="flex items-start gap-1">
                    <ArrowRight className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                    <span><span className="font-medium text-primary">Próximo passo:</span> {contextData.activity.next_steps}</span>
                  </div>
                )}
                {contextData.activity.notes && (
                  <div><span className="font-medium text-muted-foreground">Observações:</span> {contextData.activity.notes}</div>
                )}
                {!contextData.activity.what_was_done && !contextData.activity.current_status_notes && !contextData.activity.next_steps && !contextData.activity.notes && (
                  <div className="text-muted-foreground italic">Nenhum campo preenchido ainda. Use a IA para preencher após enviar mensagens.</div>
                )}
              </div>

              {/* Lead info */}
              {contextData.lead && (
                <>
                  <Separator className="bg-primary/10" />
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1 font-medium text-muted-foreground">
                      <Briefcase className="h-3 w-3" /> Lead
                    </div>
                    <div className="font-medium">{contextData.lead.lead_name || 'Sem nome'}</div>
                    {contextData.lead.status && (
                      <Badge variant="outline" className="text-[10px] h-4">{contextData.lead.status}</Badge>
                    )}
                    {contextData.lead.victim_name && <div>Vítima: {contextData.lead.victim_name}</div>}
                    {contextData.lead.case_type && <div>Tipo: {contextData.lead.case_type}</div>}
                    {(contextData.lead.city || contextData.lead.state) && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[contextData.lead.city, contextData.lead.state].filter(Boolean).join('/')}
                      </div>
                    )}
                    {contextData.lead.main_company && <div>Empresa: {contextData.lead.main_company}</div>}
                    {contextData.lead.damage_description && <div>Dano: {contextData.lead.damage_description}</div>}
                    {contextData.lead.legal_viability && <div>Viabilidade: {contextData.lead.legal_viability}</div>}
                  </div>
                </>
              )}

              {/* Contact info */}
              {contextData.contact && (
                <>
                  <Separator className="bg-primary/10" />
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1 font-medium text-muted-foreground">
                      <User className="h-3 w-3" /> Contato Vinculado
                    </div>
                    <div className="font-medium">{contextData.contact.full_name}</div>
                    {contextData.contact.phone && <div>📞 {contextData.contact.phone}</div>}
                    {contextData.contact.email && <div>✉️ {contextData.contact.email}</div>}
                    {(contextData.contact.city || contextData.contact.state) && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[contextData.contact.city, contextData.contact.state].filter(Boolean).join('/')}
                      </div>
                    )}
                    {contextData.contact.profession && <div>Profissão: {contextData.contact.profession}</div>}
                  </div>
                </>
              )}

              {/* AI action suggestions */}
              <Separator className="bg-primary/10" />
              <div className="space-y-2">
                <div className="flex items-center gap-1 font-semibold text-primary text-[11px]">
                  <Sparkles className="h-3 w-3" /> O que deseja fazer?
                </div>
                {actionsLoading ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Gerando sugestões...
                  </div>
                ) : actionSuggestions.length > 0 ? (
                  <div className="space-y-1.5">
                    {actionSuggestions.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => handleActionClick(action)}
                        disabled={executingAction !== null}
                        className="w-full flex items-center gap-2 p-2 rounded-lg border border-primary/20 bg-background hover:bg-primary/10 transition-colors text-left group disabled:opacity-50"
                      >
                        <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          {executingAction === action.label ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : getActionIcon(action.icon)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium truncate">{action.label}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{action.detail}</div>
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                      </button>
                    ))}
                  </div>
                ) : contextData.activity.next_steps ? (
                  <div className="text-[11px] text-muted-foreground italic p-2 bg-primary/5 rounded-lg">
                    {contextData.activity.next_steps}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    Envie mensagens para gerar sugestões de ação.
                  </div>
                )}
              </div>
            </div>
          )}
          {contextLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 && !contextData.activity ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs text-center gap-2">
              <Send className="h-8 w-8 opacity-30" />
              <p>Nenhuma mensagem ainda.<br/>Envie texto, áudio, fotos ou PDFs.</p>
            </div>
          ) : (
            messages.map(renderMessage)
          )}
        </div>

        {/* AI button */}
        <div className="shrink-0 px-3 py-1.5 border-t bg-muted/30">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleAIAnalyze}
            disabled={analyzing || messages.length === 0}
          >
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {analyzing ? 'Analisando...' : 'IA Preencher Campos'}
          </Button>
        </div>

        {/* Input area */}
        <div className="shrink-0 px-3 py-2 border-t bg-muted/60">
          {callRecording ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={cancelCallRecording}>
                <X className="h-4 w-4" />
              </Button>
              <div className="flex-1 flex items-center gap-2">
                <Phone className="h-4 w-4 text-green-500 animate-pulse" />
                <span className="text-xs font-mono text-green-600">{formatTime(callRecordingTime)}</span>
                <span className="text-[10px] text-muted-foreground">Gravando chamada...</span>
                <div className="flex-1 h-1 bg-green-500/20 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 animate-pulse" style={{ width: `${Math.min(callRecordingTime, 100)}%` }} />
                </div>
              </div>
              <Button size="icon" className="h-8 w-8 rounded-full bg-green-600 hover:bg-green-700" onClick={stopCallRecording}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : recording ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={cancelRecording}>
                <X className="h-4 w-4" />
              </Button>
              <div className="flex-1 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <span className="text-xs font-mono text-destructive">{formatTime(recordingTime)}</span>
                <div className="flex-1 h-1 bg-destructive/20 rounded-full overflow-hidden">
                  <div className="h-full bg-destructive animate-pulse" style={{ width: `${Math.min(recordingTime * 2, 100)}%` }} />
                </div>
              </div>
              <Button size="icon" className="h-8 w-8 rounded-full bg-primary" onClick={stopRecording}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={startCallRecording}
                disabled={sending}
                title="Gravar chamada (sistema + mic)"
              >
                <Phone className="h-4 w-4" />
              </Button>
              <Input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem..."
                className="h-8 text-sm flex-1"
                disabled={sending}
              />
              {inputText.trim() ? (
                <Button size="icon" className="h-8 w-8 rounded-full shrink-0" onClick={handleSendText} disabled={sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              ) : (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={startRecording} disabled={sending}>
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

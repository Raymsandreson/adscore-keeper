import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  Send, Mic, MicOff, Paperclip, Image, FileText, Sparkles, Loader2, Play, Pause, X, Check, Download, Phone, PhoneOff,
  Info, User, Briefcase, MapPin, Calendar, ArrowRight, PhoneCall, FileSearch, CalendarCheck, Mail, CheckCircle, Search,
  RefreshCw, Settings2, Trash2, Ban, Plus, MessageCircle, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialogDateFields } from '@/components/activities/ConfirmDialogDateFields';
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

interface AISuggestion {
  what_was_done: string;
  current_status_notes: string;
  next_steps: string;
  notes: string;
}

interface FollowUpSuggestion {
  label: string;
  message: string;
}

interface AIAssistantResponse {
  response_text: string;
  activity_fields: Record<string, string> | null;
  lead_fields: Record<string, string> | null;
  contact_fields: Record<string, string> | null;
  new_activity: {
    title: string;
    activity_type?: string;
    priority?: string;
    what_was_done?: string;
    current_status_notes?: string;
    next_steps?: string;
    notes?: string;
    deadline?: string;
  } | null;
  follow_up_suggestions: FollowUpSuggestion[] | null;
}

interface ActivityChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string | null;
  leadId: string | null;
  activityTitle?: string;
  onApplySuggestion: (suggestion: AISuggestion) => void;
  onApplyLeadFields?: (fields: Record<string, string>) => void;
  onApplyContactFields?: (fields: Record<string, string>) => void;
  onCreateActivity?: (activity: any) => void;
}

export function ActivityChatSheet({ open, onOpenChange, activityId, leadId, activityTitle, onApplySuggestion, onApplyLeadFields, onApplyContactFields, onCreateActivity }: ActivityChatSheetProps) {
  const { user } = useAuthContext();
  
  // Get stable conversation scope IDs - general chat uses null IDs + sender_id filter
  const getConversationScope = useCallback(() => {
    const effActivityId = activityId || null;
    const effLeadId = leadId || null;
    if (effActivityId || effLeadId) return { activity_id: effActivityId, lead_id: effLeadId, isGeneralChat: false };
    // General chat: both IDs null, filter by sender_id
    if (user?.id) return { activity_id: null, lead_id: null, isGeneralChat: true };
    return { activity_id: null, lead_id: null, isGeneralChat: false };
  }, [activityId, leadId, user?.id]);

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
  const [regenerateConfig, setRegenerateConfig] = useState<{ msgId: string; fileUrl: string; fileType: string; fileName: string; audioDuration?: number } | null>(null);
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenMaxChars, setRegenMaxChars] = useState(600);
  const [regenerating, setRegenerating] = useState(false);
  const [aiAssistantMode, setAiAssistantMode] = useState(true);
  const [aiResponding, setAiResponding] = useState(false);
  const [aiProgressSteps, setAiProgressSteps] = useState<{ label: string; status: 'pending' | 'active' | 'done' }[]>([]);
  const [pendingAiActions, setPendingAiActions] = useState<AIAssistantResponse | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [confirmNewActivity, setConfirmNewActivity] = useState<any | null>(null);
  const [activityTypes, setActivityTypes] = useState<{ key: string; label: string }[]>([]);
  const [profilesList, setProfilesList] = useState<{ user_id: string; full_name: string }[]>([]);
  const [lastCreatedActivityId, setLastCreatedActivityId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const callAudioChunksRef = useRef<Blob[]>([]);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStreamsRef = useRef<MediaStream[]>([]);
  const recordingTimeRef = useRef(0);
  const callRecordingTimeRef = useRef(0);

  // Fetch user name
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('full_name').eq('user_id', user.id).single()
      .then(({ data }) => setUserName(data?.full_name || user.email || 'Usuário'));
  }, [user]);

  // Fetch activity types and profiles for the confirm dialog
  useEffect(() => {
    supabase.from('activity_types').select('key, label').eq('is_active', true).order('display_order')
      .then(({ data }) => setActivityTypes((data || []) as { key: string; label: string }[]));
    supabase.from('profiles').select('user_id, full_name').order('full_name')
      .then(({ data }) => setProfilesList((data || []).filter((p: any) => p.full_name) as { user_id: string; full_name: string }[]));
  }, []);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    const scope = getConversationScope();
    if (!scope.activity_id && !scope.lead_id && !scope.isGeneralChat) return;
    setLoading(true);
    try {
      let query = supabase.from('activity_chat_messages').select('*').order('created_at', { ascending: true });
      if (scope.isGeneralChat) {
        // General chat: messages with both IDs null, belonging to this user (or from AI)
        query = query.is('activity_id', null).is('lead_id', null)
          .or(`sender_id.eq.${user?.id},sender_id.is.null`);
      } else if (scope.activity_id) {
        query = query.eq('activity_id', scope.activity_id)
          .or(`sender_id.eq.${user?.id},sender_id.is.null`);
      } else if (scope.lead_id) {
        query = query.eq('lead_id', scope.lead_id)
          .or(`sender_id.eq.${user?.id},sender_id.is.null`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setMessages((data || []) as ChatMessage[]);
    } catch (e) {
      console.error('Error fetching chat messages:', e);
    } finally {
      setLoading(false);
    }
  }, [getConversationScope, user?.id]);

  // Fetch AI action suggestions
  const fetchActionSuggestions = useCallback(async (actData: any, leadData: any, contactData: any) => {
    setActionsLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
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
    if (!activityId && !leadId) return;
    setContextLoading(true);
    try {
      let actData = null;
      let leadData = null;
      let contactData = null;

      if (activityId) {
        const { data } = await supabase
          .from('lead_activities')
          .select('*')
          .eq('id', activityId)
          .single();
        actData = data;

        if (actData?.lead_id) {
          const { data: ld } = await supabase.from('leads').select('*').eq('id', actData.lead_id).single();
          leadData = ld;
        }
        if (actData?.contact_id) {
          const { data: cd } = await supabase.from('contacts').select('*').eq('id', actData.contact_id).single();
          contactData = cd;
        }
      } else if (leadId) {
        // Opened from lead tab without a specific activity
        const { data: ld } = await supabase.from('leads').select('*').eq('id', leadId).single();
        leadData = ld;
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
  }, [activityId, leadId, fetchActionSuggestions]);

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

  const autoAnalyzeFile = async (fileType: string, fileUrl: string, fileName: string, audioDuration?: number) => {
    try {
      setAnalyzing(true);
      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
        body: { mode: 'describe_file', context: { file_url: fileUrl, file_type: fileType, file_name: fileName, audio_duration: audioDuration } },
      });
      if (error) throw error;
      if (data?.description) {
        const scope = getConversationScope();
        await supabase.from('activity_chat_messages').insert({
          activity_id: scope.activity_id,
          lead_id: scope.lead_id,
          message_type: 'ai_suggestion',
          content: data.description,
          sender_id: null,
          sender_name: 'IA WhatsJUD',
        } as any);
        await fetchMessages();

        // After transcription/description, trigger AI assistant to process the command
        if (aiAssistantMode && fileType === 'audio' && data.description) {
          // Wrap transcription with an action command so the AI knows to ACT on it, not just acknowledge
          const actionPrompt = `[COMANDO DE VOZ DO ASSESSOR — transcrição do áudio acima. EXECUTE a ação solicitada imediatamente. Se for um pedido para criar atividade, use a ferramenta new_activity com TODOS os campos preenchidos. NÃO peça confirmação, apenas crie.]\n\n${data.description}`;
          await triggerAIAssistant(actionPrompt);
        }
      }
    } catch (e) {
      console.error('Error auto-analyzing file:', e);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRegenerateSummary = async () => {
    if (!regenerateConfig) return;
    setRegenerating(true);
    try {
      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
        body: {
          mode: 'describe_file',
          context: {
            file_url: regenerateConfig.fileUrl,
            file_type: regenerateConfig.fileType,
            file_name: regenerateConfig.fileName,
            audio_duration: regenerateConfig.audioDuration,
            custom_prompt: regenPrompt || undefined,
            max_chars: regenMaxChars,
          },
        },
      });
      if (error) throw error;
      if (data?.description) {
        // Update existing AI message
        await supabase.from('activity_chat_messages').update({ content: data.description } as any).eq('id', regenerateConfig.msgId);
        await fetchMessages();
        toast.success('Resumo regenerado!');
      }
    } catch (e) {
      console.error('Error regenerating summary:', e);
      toast.error('Erro ao regenerar resumo');
    } finally {
      setRegenerating(false);
      setRegenerateConfig(null);
      setRegenPrompt('');
      setRegenMaxChars(600);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await supabase.from('activity_chat_messages').update({
        deleted_at: new Date().toISOString(),
        deleted_by_name: userName || 'Usuário',
      } as any).eq('id', msgId);
      await fetchMessages();
      toast.success('Mensagem apagada');
    } catch (e) {
      console.error('Error deleting message:', e);
      toast.error('Erro ao apagar mensagem');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const sendMessage = async (type: string, content?: string, fileUrl?: string, fileName?: string, fileSize?: number, audioDuration?: number) => {
    const scope = getConversationScope();
    if (!scope.activity_id && !scope.lead_id && !scope.isGeneralChat) {
      toast.error('Erro: faça login para usar o chat.');
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from('activity_chat_messages').insert({
        activity_id: scope.activity_id,
        lead_id: scope.lead_id,
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

      // Auto-analyze files (image, pdf, audio) with AI
      if (['image', 'pdf', 'audio'].includes(type) && fileUrl) {
        autoAnalyzeFile(type, fileUrl, fileName || '', audioDuration);
      }
    } catch (e) {
      console.error('Error sending message:', e);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  // Detect call intent patterns
  const CALL_INTENT_PATTERNS = /\b(vou ligar|vou fazer uma liga|iniciar liga|fazendo uma liga|começ(ar|ando) a liga|vou telefonar|ligando agora|vou discar)\b/i;

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    await sendMessage('text', text);

    // Auto-start call recording if user mentions making a call
    if (CALL_INTENT_PATTERNS.test(text) && !callRecording && !recording) {
      setTimeout(() => {
        toast('Iniciando gravação da chamada automaticamente...', { icon: '📞' });
        startCallRecording();
      }, 800);
    }

    // If AI assistant mode is on, get AI response
    if (aiAssistantMode) {
      await triggerAIAssistant(text);
    }
  };

  const triggerAIAssistant = async (lastUserMessage?: string) => {
    const scope = getConversationScope();
    
    setAiResponding(true);
    // Initialize progress steps for real-time preview
    const steps = [
      { label: 'Lendo contexto da conversa...', status: 'active' as const },
      { label: 'Analisando dados do caso...', status: 'pending' as const },
      { label: 'Gerando resposta inteligente...', status: 'pending' as const },
      { label: 'Preparando sugestões de ação...', status: 'pending' as const },
    ];
    setAiProgressSteps([...steps]);
    try {
      // Build chat history from messages
      const chatHistory = messages
        .filter(m => !m.deleted_at)
        .map(m => ({
          role: m.sender_name === 'IA WhatsJUD' ? 'ai' : 'user',
          content: m.content || '',
          type: m.message_type,
          file_url: m.file_url,
        }));

      // Add the last user message if not yet in messages state
      if (lastUserMessage) {
        chatHistory.push({ role: 'user', content: lastUserMessage, type: 'text', file_url: null });
      }

      // Progress: step 1 done, step 2 active
      setAiProgressSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'done' } : i === 1 ? { ...s, status: 'active' } : s
      ));

      // Fetch activity history for context
      let activityHistory: any[] = [];
      const effectiveLeadId = contextData.lead?.id || leadId;
      if (effectiveLeadId) {
        const { data: histData } = await supabase
          .from('lead_activities')
          .select('title, status, activity_type, what_was_done, current_status_notes, next_steps, deadline')
          .eq('lead_id', effectiveLeadId)
          .order('created_at', { ascending: false })
          .limit(10);
        activityHistory = histData || [];
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
            activity_context: contextData.activity,
            lead_context: contextData.lead,
            contact_context: contextData.contact,
            activity_history: activityHistory,
          },
        },
      });

      if (error) throw error;

      const response = data as AIAssistantResponse;

      // Progress: step 3 done, step 4 active
      setAiProgressSteps(prev => prev.map((s, i) => 
        i <= 2 ? { ...s, status: 'done' } : i === 3 ? { ...s, status: 'active' } : s
      ));

      // Save AI response as chat message using stable IDs
      await supabase.from('activity_chat_messages').insert({
        activity_id: scope.activity_id,
        lead_id: scope.lead_id,
        message_type: 'ai_suggestion',
        content: response.response_text,
        ai_suggestion: {
          ...(response.activity_fields ? { activity_fields: response.activity_fields } : {}),
          ...(response.lead_fields ? { lead_fields: response.lead_fields } : {}),
          ...(response.contact_fields ? { contact_fields: response.contact_fields } : {}),
          ...(response.new_activity ? { new_activity: response.new_activity } : {}),
          ...(response.follow_up_suggestions?.length ? { follow_up_suggestions: response.follow_up_suggestions } : {}),
        },
        sender_id: null,
        sender_name: 'IA WhatsJUD',
      } as any);

      await fetchMessages();

      // Store pending actions if any
      if (response.activity_fields || response.lead_fields || response.contact_fields || response.new_activity) {
        setPendingAiActions(response);
      }
    } catch (e: any) {
      console.error('AI assistant error:', e);
      toast.error('Erro ao obter resposta da IA');
    } finally {
      // All steps done
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
      
      // Determine supported mimeType
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const recordedMime = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: recordedMime });
        const duration = recordingTimeRef.current;

        if (audioBlob.size === 0) {
          console.error('Audio blob is empty, no data recorded');
          toast.error('Nenhum áudio capturado');
          return;
        }

        setSending(true);
        try {
          const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
          const filePath = `${activityId || leadId}/${Date.now()}_audio.${ext}`;
          const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, audioBlob);
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
          await sendMessage('audio', `Áudio (${duration}s)`, publicUrl, `audio.${ext}`, audioBlob.size, duration);
        } catch (e) {
          console.error('Error uploading audio:', e);
          toast.error('Erro ao enviar áudio');
        } finally {
          setSending(false);
        }
      };

      mediaRecorder.start(1000); // Collect data every second for reliability
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
      callRecordingTimeRef.current = 0;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) callAudioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        callStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
        callStreamsRef.current = [];
        if (audioContext) audioContext.close();
        const audioBlob = new Blob(callAudioChunksRef.current, { type: 'audio/webm' });
        const duration = callRecordingTimeRef.current;

        setSending(true);
        try {
          const filePath = `${activityId || leadId}/${Date.now()}_call.webm`;
          const { error: uploadError } = await supabase.storage.from('activity-chat').upload(filePath, audioBlob);
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('activity-chat').getPublicUrl(filePath);
          const label = isMicOnly ? '🎙️ Gravação (só microfone)' : '📞 Gravação de chamada';
          await sendMessage('audio', `${label} (${Math.floor(duration / 60)}min ${duration % 60}s)`, publicUrl, 'call_recording.webm', audioBlob.size, duration);

          // Auto-register call record
          const leadData = contextData.lead;
          const contactData = contextData.contact;
          await supabase.from('call_records').insert({
            activity_id: activityId,
            lead_id: leadId || leadData?.id || null,
            contact_id: contextData.activity?.contact_id || null,
            user_id: user?.id,
            call_type: 'outbound',
            call_result: 'answered',
            duration_seconds: duration,
            audio_url: publicUrl,
            audio_file_name: 'call_recording.webm',
            lead_name: leadData?.lead_name || contextData.activity?.lead_name || null,
            contact_name: contactData?.full_name || contextData.activity?.contact_name || null,
            contact_phone: contactData?.phone || null,
          } as any);
          toast.success('Ligação registrada automaticamente!');
        } catch (e) {
          console.error('Error uploading call recording:', e);
          toast.error('Erro ao enviar gravação da chamada');
        } finally {
          setSending(false);
        }
      };

      mediaRecorder.start(10000); // Collect data every 10s to support long recordings
      setCallRecording(true);
      callTimerRef.current = setInterval(() => {
        callRecordingTimeRef.current += 1;
        setCallRecordingTime(callRecordingTimeRef.current);
      }, 1000);

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
      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
        body: { messages: messages.filter(m => !m.deleted_at).map(m => ({ content: m.content, message_type: m.message_type, sender_name: m.sender_name, file_name: m.file_name, file_url: m.file_url, audio_duration: m.audio_duration })) },
      });
      if (error) throw error;
      if (data?.suggestion) {
        setPendingSuggestion(data.suggestion);
        // Save AI suggestion as a message
        await supabase.from('activity_chat_messages').insert({
          activity_id: getConversationScope().activity_id,
          lead_id: getConversationScope().lead_id,
          message_type: 'ai_suggestion',
          content: JSON.stringify(data.suggestion),
          ai_suggestion: data.suggestion,
          sender_id: null,
          sender_name: 'IA WhatsJUD',
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

  const getEntityLink = (type: 'activity' | 'lead' | 'contact', id: string | null | undefined) => {
    if (!id) return null;
    const base = window.location.origin;
    switch (type) {
      case 'activity': return `${base}/?openActivity=${id}`;
      case 'lead': return `${base}/leads?openLead=${id}`;
      case 'contact': return `${base}/leads?tab=contacts&openContact=${id}`;
    }
  };

  const EntityLinkButton = ({ type, id, label }: { type: 'activity' | 'lead' | 'contact'; id: string | null | undefined; label: string }) => {
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

  const handleActionClick = (action: { label: string; detail: string }) => {
    // Fill input with suggestion so user can review/edit before sending
    setInputText(`${action.label}: ${action.detail}`);
    // Focus the input
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-chat-input]');
      input?.focus();
    }, 100);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const renderMessage = (msg: ChatMessage) => {
    const isOwn = msg.sender_id === user?.id;
    const isAI = msg.message_type === 'ai_suggestion';
    const isDeleted = !!msg.deleted_at;

    // Show deleted message placeholder
    if (isDeleted) {
      return (
        <div key={msg.id} className={cn("flex mb-2", isOwn ? "justify-end" : "justify-start")}>
          <div className={cn(
            "max-w-[75%] rounded-2xl px-3 py-2 text-sm opacity-60 italic",
            isOwn ? "bg-primary/30 text-primary-foreground/70 rounded-br-md" : "bg-muted/50 text-muted-foreground rounded-bl-md"
          )}>
            <div className="flex items-center gap-1.5">
              <Ban className="h-3 w-3 shrink-0" />
              <span className="text-xs">Mensagem apagada por {msg.deleted_by_name || 'usuário'}</span>
            </div>
            <div className={cn("text-[10px] mt-1", isOwn ? "text-primary-foreground/40" : "text-muted-foreground/60")}>
              {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
            </div>
          </div>
        </div>
      );
    }

    if (isAI) {
      const rawSuggestion = msg.ai_suggestion as any;
      
      // Special: activity created confirmation with open button
      if (rawSuggestion?.created_activity_id) {
        return (
          <div key={msg.id} className="flex justify-start mb-2">
            <div className="max-w-[85%]">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl rounded-bl-md px-3 py-2 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 mb-1">
                  <Sparkles className="h-3 w-3" /> Assistente IA
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {rawSuggestion.created_activity_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10"
                    onClick={() => {
                      window.location.href = `${window.location.origin}/?openActivity=${rawSuggestion.created_activity_id}`;
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Abrir atividade
                  </Button>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                </div>
              </div>
            </div>
          </div>
        );
      }
      
      // Detect new assistant format (has activity_fields/lead_fields/contact_fields/new_activity)
      const isAssistantResponse = rawSuggestion && ('activity_fields' in rawSuggestion || 'lead_fields' in rawSuggestion || 'contact_fields' in rawSuggestion || 'new_activity' in rawSuggestion);
      // Old format: direct AISuggestion with what_was_done etc
      const isOldSuggestion = rawSuggestion && !isAssistantResponse && ('what_was_done' in rawSuggestion || 'current_status_notes' in rawSuggestion);
      const isFileDescription = !rawSuggestion && msg.content;

      // Find the source file message (the message right before this AI message)
      const msgIndex = messages.findIndex(m => m.id === msg.id);
      const sourceMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
      const canRegenerate = sourceMsg && ['audio', 'image', 'pdf'].includes(sourceMsg.message_type) && sourceMsg.file_url;

      // Assistant conversational response
      if (isAssistantResponse || (!isOldSuggestion && !isFileDescription && msg.content)) {
        return (
          <div key={msg.id} className="flex justify-start mb-2">
            <div className="max-w-[85%] space-y-2">
              {/* AI text response */}
              <div className="bg-primary/10 border border-primary/20 rounded-2xl rounded-bl-md px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary mb-1">
                  <Sparkles className="h-3 w-3" /> IA WhatsJUD
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                </div>
              </div>

              {/* Action cards */}
              {isAssistantResponse && (
                <div className="space-y-1.5 pl-1">
                  {rawSuggestion.activity_fields && Object.keys(rawSuggestion.activity_fields).length > 0 && (
                    <button
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/15 transition-colors text-left"
                      onClick={() => {
                        const fields = rawSuggestion.activity_fields;
                        onApplySuggestion({
                          what_was_done: fields.what_was_done || '',
                          current_status_notes: fields.current_status_notes || '',
                          next_steps: fields.next_steps || '',
                          notes: fields.notes || '',
                        });
                        toast.success('Campos da atividade atualizados!');
                      }}
                    >
                      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                        <FileText className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium">Preencher campos da atividade</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate">{Object.keys(rawSuggestion.activity_fields).length} campo(s) sugerido(s)</span>
                          <EntityLinkButton type="activity" id={activityId} label="Abrir atividade" />
                        </div>
                      </div>
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    </button>
                  )}

                  {rawSuggestion.lead_fields && Object.keys(rawSuggestion.lead_fields).length > 0 && (
                    <button
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 transition-colors text-left"
                      onClick={() => {
                        if (onApplyLeadFields) {
                          onApplyLeadFields(rawSuggestion.lead_fields);
                          toast.success('Campos do lead atualizados!');
                        } else {
                          toast.info('Abra o lead para aplicar as atualizações');
                        }
                      }}
                    >
                      <div className="shrink-0 w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <Briefcase className="h-3.5 w-3.5 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium">Atualizar campos do Lead</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate">{Object.entries(rawSuggestion.lead_fields).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                          <EntityLinkButton type="lead" id={leadId || contextData.lead?.id} label="Abrir lead" />
                        </div>
                      </div>
                      <Check className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    </button>
                  )}

                  {rawSuggestion.contact_fields && Object.keys(rawSuggestion.contact_fields).length > 0 && (
                    <button
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors text-left"
                      onClick={() => {
                        if (onApplyContactFields) {
                          onApplyContactFields(rawSuggestion.contact_fields);
                          toast.success('Campos do contato atualizados!');
                        } else {
                          toast.info('Abra o contato para aplicar as atualizações');
                        }
                      }}
                    >
                      <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <User className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium">Atualizar campos do Contato</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate">{Object.entries(rawSuggestion.contact_fields).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>
                          <EntityLinkButton type="contact" id={contextData.contact?.id} label="Abrir contato" />
                        </div>
                      </div>
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    </button>
                  )}

                  {rawSuggestion.new_activity && (
                    <button
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 transition-colors text-left"
                      onClick={() => {
                        setConfirmNewActivity({
                          ...rawSuggestion.new_activity,
                          lead_id: contextData.lead?.id || leadId || null,
                          lead_name: contextData.lead?.lead_name || null,
                          contact_id: contextData.contact?.id || null,
                          contact_name: contextData.contact?.full_name || null,
                        });
                      }}
                    >
                      <div className="shrink-0 w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <Plus className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium">Criar nova atividade</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {rawSuggestion.new_activity.title} {rawSuggestion.new_activity.deadline ? `• 📅 ${rawSuggestion.new_activity.deadline}` : ''} {rawSuggestion.new_activity.notification_date ? `• 🔔 ${rawSuggestion.new_activity.notification_date}` : ''} {rawSuggestion.new_activity.matrix_quadrant ? `• ${{'do_now':'🔥','schedule':'📅','delegate':'🤝','eliminate':'🗑️'}[rawSuggestion.new_activity.matrix_quadrant as string] || ''}` : ''}
                        </div>
                      </div>
                      <Plus className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    </button>
                  )}
                </div>
              )}

              {/* Follow-up suggestion chips - only on last AI message */}
              {rawSuggestion?.follow_up_suggestions?.length > 0 && msg.id === messages.filter(m => m.message_type === 'ai_suggestion' && !m.deleted_at).slice(-1)[0]?.id && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {rawSuggestion.follow_up_suggestions.map((s: FollowUpSuggestion, i: number) => (
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

      // File description (old behavior)
      if (isFileDescription) {
        return (
          <div key={msg.id} className="flex justify-center my-3">
            <div className="bg-primary/90 border border-primary rounded-xl p-3 max-w-[90%] space-y-2 text-primary-foreground">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-primary-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Resumo da IA
                </div>
                {canRegenerate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                    onClick={() => {
                      setRegenerateConfig({
                        msgId: msg.id,
                        fileUrl: sourceMsg.file_url!,
                        fileType: sourceMsg.message_type,
                        fileName: sourceMsg.file_name || '',
                        audioDuration: sourceMsg.audio_duration || undefined,
                      });
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" /> Regenerar
                  </Button>
                )}
              </div>
              <Separator className="bg-primary-foreground/20" />
              <div className="text-xs whitespace-pre-wrap leading-relaxed text-primary-foreground">{msg.content}</div>
              <div className="text-[10px] text-primary-foreground/60">
                {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
              </div>
            </div>
          </div>
        );
      }

      // Old format suggestion
      if (isOldSuggestion) {
        const suggestion = rawSuggestion as AISuggestion;
        return (
          <div key={msg.id} className="flex justify-center my-3">
            <div className="bg-primary/90 border border-primary rounded-xl p-3 max-w-[90%] space-y-2 text-primary-foreground">
              <div className="flex items-center gap-2 text-xs font-medium text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Sugestão da IA
              </div>
              <Separator className="bg-primary-foreground/20" />
              <div className="space-y-1.5 text-xs text-primary-foreground">
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
              <Button size="sm" className="w-full h-7 text-xs mt-1 bg-primary-foreground text-primary hover:bg-primary-foreground/90" onClick={() => handleApplySuggestion(suggestion)}>
                <Check className="h-3 w-3 mr-1" /> Aplicar nos campos
              </Button>
            </div>
          </div>
        );
      }

      return null;
    }

    return (
      <div key={msg.id} className={cn("flex mb-2 group", isOwn ? "justify-end" : "justify-start")}>
        <div className="flex items-end gap-1">
          {isOwn && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteConfirmId(msg.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          <div className={cn(
            "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
            isOwn ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
          )}>
            {!isOwn && <div className="text-[10px] font-medium mb-0.5 opacity-70">{msg.sender_name}</div>}

            {msg.message_type === 'text' && <p className="whitespace-pre-wrap">{msg.content}</p>}

            {msg.message_type === 'audio' && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 shrink-0" />
                  <span className="text-xs opacity-80">{msg.content || 'Áudio'}</span>
                </div>
                <audio src={msg.file_url || ''} controls preload="metadata" className="w-full min-w-[220px]" style={{ height: 36 }} />
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
          {!isOwn && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteConfirmId(msg.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{activityTitle || 'Chat IA'}</div>
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
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-xs text-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <Sparkles className="h-8 w-8 text-primary/40" />
                <p className="text-sm font-medium text-foreground">Chat IA</p>
                <p className="text-[11px]">Seu assistente para leads, atividades, contatos e mais.</p>
              </div>
              <div className="w-full space-y-1.5 max-w-[280px]">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-primary/60 mb-2">Experimente comandos como:</p>
                {[
                  { icon: <Plus className="h-3 w-3" />, text: "Crie uma atividade de ligação para o lead João amanhã às 10h" },
                  { icon: <Search className="h-3 w-3" />, text: "Busque todos os leads de São Paulo com status novo" },
                  { icon: <CalendarCheck className="h-3 w-3" />, text: "Quais atividades estão atrasadas esta semana?" },
                  { icon: <User className="h-3 w-3" />, text: "Atualize o telefone do contato Maria para (11) 99999-0000" },
                  { icon: <ArrowRight className="h-3 w-3" />, text: "Mova o lead Carlos para a etapa Fechamento no funil" },
                  { icon: <FileSearch className="h-3 w-3" />, text: "Resuma as últimas atividades do lead Ana" },
                ].map((cmd, i) => (
                  <button
                    key={i}
                    onClick={() => setInputText(cmd.text)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-border/60 bg-card hover:bg-primary/10 hover:border-primary/30 transition-all text-left group"
                  >
                    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {cmd.icon}
                    </div>
                    <span className="text-[11px] text-foreground/80 group-hover:text-foreground leading-tight">{cmd.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(renderMessage)
          )}
          {/* AI responding - real-time progress preview */}
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

        {/* AI always active indicator */}

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
                data-chat-input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={aiAssistantMode ? "Pergunte à IA sobre o caso..." : "Digite uma mensagem..."}
                className={cn("h-8 text-sm flex-1", aiAssistantMode && "border-primary/40")}
                disabled={sending || aiResponding}
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

    {/* Regenerate Summary Dialog */}
    {regenerateConfig && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setRegenerateConfig(null)}>
        <div className="bg-background rounded-xl border shadow-lg p-4 w-[90%] max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="h-4 w-4 text-primary" />
            Regenerar Resumo
          </div>
          <Separator />

          <div className="space-y-1">
            <label className="text-xs font-medium">Instruções para o resumo</label>
            <textarea
              className="w-full rounded-lg border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              rows={3}
              placeholder="Ex: Foque nos próximos passos e decisões tomadas..."
              value={regenPrompt}
              onChange={e => setRegenPrompt(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Tamanho máximo do resumo</label>
            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={regenMaxChars}
                onChange={e => setRegenMaxChars(Number(e.target.value))}
              >
                <option value={300}>Curto (~4 linhas)</option>
                <option value={600}>Padrão (~9 linhas)</option>
                <option value={1200}>Médio (~18 linhas)</option>
                <option value={2000}>Longo (~30 linhas)</option>
                <option value={4000}>Muito longo (~60 linhas)</option>
              </select>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{regenMaxChars} chars</span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setRegenerateConfig(null)}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleRegenerateSummary} disabled={regenerating}>
              {regenerating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Regenerar
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Delete confirmation dialog */}
    <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
          <AlertDialogDescription>
            A mensagem será marcada como apagada e não será usada pela IA para preencher campos. Um registro de que foi apagada ficará visível no chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteConfirmId && handleDeleteMessage(deleteConfirmId)}
          >
            Apagar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Confirm new activity dialog */}
    <AlertDialog open={!!confirmNewActivity} onOpenChange={(open) => !open && setConfirmNewActivity(null)}>
      <AlertDialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Confirmar criação de atividade
          </AlertDialogTitle>
        </AlertDialogHeader>
        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">A IA preencheu os campos abaixo. Edite se necessário e confirme:</p>
            
            {/* Title - editable */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Título *</label>
              <Input
                value={confirmNewActivity?.title || ''}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, title: e.target.value } : prev)}
                className="h-8 text-sm"
              />
            </div>

            {/* Type and Priority row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Tipo de Atividade *</label>
                <select
                  className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
                  value={confirmNewActivity?.activity_type || 'tarefa'}
                  onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, activity_type: e.target.value } : prev)}
                >
                  {activityTypes.length > 0 ? activityTypes.map(t => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  )) : (
                    <>
                      <option value="tarefa">Tarefa</option>
                      <option value="audiencia">Audiência</option>
                      <option value="prazo">Prazo</option>
                    </>
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Prioridade</label>
                <select
                  className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
                  value={confirmNewActivity?.priority || 'normal'}
                  onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, priority: e.target.value } : prev)}
                >
                  <option value="baixa">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
            </div>

            {/* Assessor */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Assessor (Responsável)</label>
              <select
                className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
                value={confirmNewActivity?.assigned_to || ''}
                onChange={(e) => {
                  const selected = profilesList.find(p => p.user_id === e.target.value);
                  setConfirmNewActivity((prev: any) => prev ? { 
                    ...prev, 
                    assigned_to: e.target.value || null, 
                    assigned_to_name: selected?.full_name || null 
                  } : prev);
                }}
              >
                <option value="">Selecione...</option>
                {profilesList.map(p => (
                  <option key={p.user_id} value={p.user_id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            {/* Deadline and Notification date */}
            <ConfirmDialogDateFields
              confirmNewActivity={confirmNewActivity}
              setConfirmNewActivity={setConfirmNewActivity}
            />

            {/* Eisenhower */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Eisenhower</label>
              <select
                className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
                value={confirmNewActivity?.matrix_quadrant || 'schedule'}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, matrix_quadrant: e.target.value } : prev)}
              >
                <option value="do_now">🔥 Faça Agora</option>
                <option value="schedule">📅 Agende</option>
                <option value="delegate">🤝 Delegue</option>
                <option value="eliminate">🗑️ Retire</option>
              </select>
            </div>

            {/* Suggested lead/contact */}
            {(confirmNewActivity?.suggested_lead_name || confirmNewActivity?.suggested_contact_name) && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30 p-2 space-y-1">
                <span className="text-xs font-medium text-foreground">Sugestões de vínculo</span>
                {confirmNewActivity?.suggested_lead_name && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Briefcase className="h-3 w-3" /> Lead: {confirmNewActivity.suggested_lead_name}
                  </div>
                )}
                {confirmNewActivity?.suggested_contact_name && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" /> Contato: {confirmNewActivity.suggested_contact_name}
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Descrição</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
                value={confirmNewActivity?.notes || ''}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, notes: e.target.value } : prev)}
                placeholder="Descrição da atividade..."
              />
            </div>

            {/* What was done */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">O que foi feito</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-none"
                value={confirmNewActivity?.what_was_done || ''}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, what_was_done: e.target.value } : prev)}
                placeholder="O que já foi realizado..."
              />
            </div>

            {/* Current status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Observações</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-none"
                value={confirmNewActivity?.current_status_notes || ''}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, current_status_notes: e.target.value } : prev)}
                placeholder="Situação atual..."
              />
            </div>

            {/* Next steps */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Próximos passos</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-none"
                value={confirmNewActivity?.next_steps || ''}
                onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, next_steps: e.target.value } : prev)}
                placeholder="O que precisa ser feito..."
              />
            </div>
          </div>
        </ScrollArea>
        <AlertDialogFooter className="shrink-0 pt-2 border-t">
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (onCreateActivity && confirmNewActivity) {
                const result: any = onCreateActivity(confirmNewActivity);
                const resolved = result instanceof Promise ? await result : result;
                const createdId = resolved?.id || null;
                toast.success('Atividade criada!');
                
                // Send follow-up message asking if user wants to open it
                const scope = getConversationScope();
                await supabase.from('activity_chat_messages').insert({
                  activity_id: scope.activity_id,
                  lead_id: scope.lead_id,
                  message_type: 'ai_suggestion',
                  content: `✅ Atividade criada com sucesso!\n\n📋 ${confirmNewActivity.title}`,
                  ai_suggestion: { created_activity_id: createdId, created_activity_title: confirmNewActivity.title },
                  sender_id: null,
                  sender_name: 'Assistente IA',
                });
                fetchMessages();
              }
              setConfirmNewActivity(null);
            }}
            disabled={!confirmNewActivity?.title?.trim() || !confirmNewActivity?.deadline}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Confirmar e Criar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

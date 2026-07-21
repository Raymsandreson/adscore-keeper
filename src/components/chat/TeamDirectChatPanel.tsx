import { useState, useRef, useEffect, useCallback } from 'react';
import { useTeamDirectChat, TeamMessage } from '@/hooks/useTeamDirectChat';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Send, Users, MessageCircle, ArrowLeft, Loader2, Plus, Hash,
  Mic, Square, Paperclip, Image, FileText, Briefcase, ClipboardList,
  Play, Pause, Check, CheckCheck, Reply, X, AlertTriangle, Search, Timer, Forward,
} from 'lucide-react';
import { setActiveTeamChatConversation } from '@/lib/teamChatActiveConversation';
import { cloudFunctions } from '@/lib/functionRouter';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { TeamChatEntityMention, renderMessageWithMentions, EntityMention, EntityMentionType } from './TeamChatEntityMention';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { Sparkles } from 'lucide-react';
import type { TeamChatOpenIntent } from '@/lib/teamChatPanelEvents';

interface TeamDirectChatPanelProps {
  intent?: TeamChatOpenIntent | null;
  onIntentHandled?: () => void;
}

export function TeamDirectChatPanel({ intent, onIntentHandled }: TeamDirectChatPanelProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const {
    conversations, messages, activeConversationId, setActiveConversationId,
    loading, sendingMessage, sendMessage, sendMessageTo, alertMessageAgain, dismissPending, startDirectChat, ensureGeneralChat,
    otherMembersReadAt,
  } = useTeamDirectChat();
  const profiles = useProfilesList();
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'responder' | 'aguardando'>('all');
  const [teamGroups, setTeamGroups] = useState<{ name: string; memberIds: string[] }[]>([]);
  const [inactiveIds, setInactiveIds] = useState<Set<string>>(new Set());

  // Times pro filtro: usa os grupos "👥 {time}" sincronizados na aba Times
  useEffect(() => {
    (async () => {
      try {
        await ensureExternalSession();
        // Desativados (org_user_status) somem do chat: sem conversa nova,
        // sem @menção e a conversa direta antiga fica oculta.
        const { data: statusRows } = await (externalSupabase.from('org_user_status') as any)
          .select('user_id').eq('active', false);
        setInactiveIds(new Set(((statusRows as any[]) || []).map(r => r.user_id)));
        const { data: groups } = await (externalSupabase.from('team_conversations') as any)
          .select('id, name').eq('type', 'group').like('name', '👥 %');
        if (!groups?.length) return;
        const { data: mems } = await (externalSupabase.from('team_conversation_members') as any)
          .select('conversation_id, user_id').in('conversation_id', (groups as any[]).map(g => g.id));
        setTeamGroups((groups as any[]).map(g => ({
          name: (g.name as string).replace(/^👥 /, ''),
          memberIds: ((mems as any[]) || []).filter(m => m.conversation_id === g.id).map(m => m.user_id),
        })));
      } catch (e) {
        console.error('[TeamDirectChatPanel] Failed to load team groups:', e);
      }
    })();
  }, []);
  const [showEntityMention, setShowEntityMention] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [replyingTo, setReplyingTo] = useState<TeamMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<TeamMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardSending, setForwardSending] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Track which user_ids were @mentioned in the current draft
  const mentionedUsersRef = useRef<Map<string, string>>(new Map()); // name -> user_id

  // Membro que saiu do escritório: desativado no org_user_status ou com o
  // perfil apagado do Cloud (só avalia "apagado" depois dos profiles carregarem).
  const isGoneUser = (uid?: string | null) => {
    if (!uid) return false;
    if (inactiveIds.has(uid)) return true;
    return profiles.length > 0 && !profiles.some(p => p.user_id === uid);
  };

  // Filtered members for @mention picker
  const mentionCandidates = (() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase().trim();
    return profiles
      .filter(p => p.user_id !== user?.id && !inactiveIds.has(p.user_id))
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .slice(0, 6);
  })();

  const handleMessageChange = (value: string) => {
    setMessageText(value);
    const m = value.match(/(?:^|\s)@([\wÀ-ÿ.\- ]{0,30})$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (name: string, userId: string) => {
    mentionedUsersRef.current.set(name, userId);
    setMessageText(prev => prev.replace(/(?:^|\s)@([\wÀ-ÿ.\- ]{0,30})$/, (full, _q, offset) => {
      const prefix = offset === 0 ? '' : full[0];
      return `${prefix}@${name} `;
    }));
    setMentionQuery(null);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  // Resolve mentioned user_ids by scanning final text against the tracked map
  const resolveMentionedUserIds = (text: string): string[] => {
    const ids = new Set<string>();
    for (const [name, uid] of mentionedUsersRef.current.entries()) {
      // word boundary match for "@Name"
      const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(text)) ids.add(uid);
    }
    return Array.from(ids);
  };


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Informa o sistema de notificações qual conversa está visível,
  // pra não mostrar popup do que o usuário já está lendo
  useEffect(() => {
    setActiveTeamChatConversation(activeConversationId);
    return () => setActiveTeamChatConversation(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (!intent?.nonce) return;

    setActiveConversationId(intent.conversationId);

    if (typeof intent.draft === 'string') {
      setMessageText(intent.draft);
    }


    if (intent.focusComposer) {
      requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    }

    onIntentHandled?.();
  }, [intent, onIntentHandled, setActiveConversationId]);

  // Só mensagens de texto entram na transcrição da IA (ignora áudio/imagem/arquivo).
  const textMessagesForAI = () =>
    (messages || []).filter(
      (m) => m.content && String(m.content).trim() && (!m.message_type || m.message_type === 'text'),
    );

  // Contexto p/ sugestão da IA: últimas falas de texto, em ordem cronológica.
  // "Eu" = usuário atual; demais falas prefixadas pelo nome de quem enviou.
  const buildReplyContext = (): string =>
    textMessagesForAI()
      .slice(-20)
      .map((m) => {
        const who = m.sender_id === user?.id ? 'Eu' : (m.sender_name || 'Colega');
        return `${who}: ${String(m.content).trim()}`;
      })
      .join('\n');

  // Estado p/ a IA saber se há resposta pendente e não repetir o que já mandei.
  const buildReplyState = () => {
    const withText = textMessagesForAI();
    const last = withText[withText.length - 1];
    const lastOutbound = [...withText].reverse().find((m) => m.sender_id === user?.id);
    const lastOther = [...withText].reverse().find((m) => m.sender_id !== user?.id);
    return {
      // Pendente quando a última mensagem com texto NÃO é minha.
      pending: !!last && last.sender_id !== user?.id,
      lastOutboundText: lastOutbound ? String(lastOutbound.content).trim() : '',
      lastClientText: lastOther ? String(lastOther.content).trim() : '',
    };
  };

  // ===== Tempo de resposta do chat interno =====
  // A média é calculada no banco (RPC team_chat_my_response_avg, 30 dias,
  // respostas em até 8h) — mesmo número que entra como critério de desempate
  // no ranking de atividades (/tv/atividades).
  const [myAvgResp, setMyAvgResp] = useState<number | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await (externalSupabase.rpc as any)('team_chat_my_response_avg', {
          _user_id: user.id,
        });
        setMyAvgResp(typeof data === 'number' ? data : null);
      } catch (e) {
        console.error('[TeamDirectChatPanel] média de resposta:', e);
      }
    })();
  }, [user?.id, activeConversationId]);

  const fmtAvg = (s: number | null) => {
    if (s == null) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
  };

  // Cronômetro: no PRIVADO, se a última mensagem é de outra pessoa, conta o
  // tempo até eu responder. Em GRUPO só conta se a última mensagem me
  // @mencionou — mesma regra da média/ranking (RPC team_chat_my_response_avg).
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const activeConvType = conversations.find(c => c.id === activeConversationId)?.type ?? null;
  const lastMsgFromOther = !!(activeConversationId && lastMsg && lastMsg.sender_id !== user?.id);
  const [lastMsgMentionsMe, setLastMsgMentionsMe] = useState(false);
  useEffect(() => {
    setLastMsgMentionsMe(false);
    if (!lastMsgFromOther || !lastMsg || !user?.id || activeConvType !== 'group') return;
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await (externalSupabase.from('team_chat_mentions') as any)
          .select('id')
          .eq('message_id', lastMsg.id)
          .eq('mentioned_user_id', user.id)
          .limit(1);
        if (!cancelled) setLastMsgMentionsMe(!!(data as any[])?.length);
      } catch {
        // sem confirmação de menção, não mostra o cronômetro
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsg?.id, lastMsgFromOther, activeConvType, user?.id]);
  const awaitingReply = lastMsgFromOther && (activeConvType === 'direct' || lastMsgMentionsMe);
  const [awaitingElapsed, setAwaitingElapsed] = useState(0);
  useEffect(() => {
    if (!awaitingReply || !lastMsg) {
      setAwaitingElapsed(0);
      return;
    }
    const t0 = new Date(lastMsg.created_at).getTime();
    const update = () => setAwaitingElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingReply, lastMsg?.id]);

  const fmtElapsed = (s: number) => {
    if (s >= 3600) {
      return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const handleSend = async () => {
    if (!messageText.trim()) return;
    const mentionedIds = resolveMentionedUserIds(messageText);
    await sendMessage(messageText, {
      mentionedUserIds: mentionedIds,
      reply_to_id: replyingTo?.id || null,
      is_urgent: urgent,
    });
    setMessageText('');
    mentionedUsersRef.current.clear();
    setReplyingTo(null);
    setUrgent(false);
  };

  // ===== Encaminhar mensagem =====
  // O cabeçalho "↪️ Encaminhada de X por Y" vai no próprio content: fica legível
  // no preview da conversa, no push e no contexto da IA, sem mudança de schema.
  const FWD_PREFIX = '↪️ Encaminhada';
  const parseForward = (content: string | null): { header: string | null; body: string } => {
    const m = (content || '').match(/^(↪️ Encaminhada[^\n]*)(?:\n([\s\S]*))?$/);
    if (!m) return { header: null, body: content || '' };
    return { header: m[1], body: m[2] || '' };
  };

  const buildForwardContent = (msg: TeamMessage): string => {
    const myName = profiles.find(p => p.user_id === user?.id)?.full_name || user?.email || 'Alguém';
    const origName = msg.sender_id === user?.id ? myName : (msg.sender_name || 'Alguém');
    const header = origName === myName
      ? `${FWD_PREFIX} por ${myName}`
      : `${FWD_PREFIX} de ${origName} por ${myName}`;
    // Se a mensagem já era encaminhada, mantém só o conteúdo original (não empilha cabeçalhos)
    const body = parseForward(msg.content).header ? parseForward(msg.content).body : (msg.content || '');
    return body.trim() ? `${header}\n${body}` : header;
  };

  const doForward = async (targetConversationId: string) => {
    if (!forwardingMsg || forwardSending) return;
    setForwardSending(true);
    try {
      const msg = forwardingMsg;
      await sendMessageTo(targetConversationId, buildForwardContent(msg), {
        message_type: msg.message_type || 'text',
        file_url: msg.file_url || undefined,
        file_name: msg.file_name || undefined,
        file_size: msg.file_size || undefined,
        file_type: msg.file_type || undefined,
        audio_duration: msg.audio_duration || undefined,
        transcription: msg.transcription || undefined,
      });
      toast.success('Mensagem encaminhada');
      setForwardingMsg(null);
      setForwardSearch('');
      setActiveConversationId(targetConversationId);
    } catch (e) {
      console.error('[TeamDirectChatPanel] Erro ao encaminhar:', e);
      toast.error('Não foi possível encaminhar a mensagem');
    } finally {
      setForwardSending(false);
    }
  };

  const handleForwardToUser = async (otherUserId: string) => {
    const convId = await startDirectChat(otherUserId);
    if (convId) await doForward(convId);
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightMsgId(msgId);
      setTimeout(() => setHighlightMsgId(null), 1600);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = mentionCandidates[mentionIndex];
        if (pick) insertMention(pick.full_name || pick.email || 'membro', pick.user_id);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  const getInitials = (name: string) =>
    name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  // Audio recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const duration = recordingDuration;
        setIsRecording(false);
        setRecordingDuration(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

        // Upload
        setUploading(true);
        const fileName = `audio_${Date.now()}.webm`;
        const path = `${user?.id}/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('team-chat-media')
          .upload(path, blob);

        if (uploadError) {
          toast.error('Erro ao enviar áudio');
          setUploading(false);
          return;
        }

        const { data: urlData } = supabase.storage.from('team-chat-media').getPublicUrl(path);

        // Transcrição automática (best-effort): ElevenLabs Scribe v2 → fallback Gemini,
        // via Railway. Se falhar/demorar, envia o áudio mesmo assim sem transcrição.
        let transcription: string | undefined;
        try {
          const { data } = await cloudFunctions.invoke<{ success: boolean; transcription?: string }>(
            'transcribe-team-audio',
            { body: { audio_url: urlData.publicUrl, audio_mime: 'audio/webm' } },
          );
          if (data?.success && data.transcription?.trim()) {
            transcription = data.transcription.trim();
          }
        } catch (e) {
          console.error('[TeamDirectChatPanel] Falha ao transcrever áudio:', e);
        }

        await sendMessage('🎤 Áudio', {
          message_type: 'audio',
          file_url: urlData.publicUrl,
          file_name: fileName,
          file_size: blob.size,
          file_type: 'audio/webm',
          audio_duration: duration,
          ...(transcription ? { transcription } : {}),
        });
        setUploading(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch {
      toast.error('Permissão de microfone negada');
    }
  }, [user?.id, sendMessage, recordingDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // File upload (shared logic)
  const uploadAndSendFile = useCallback(async (file: File) => {
    if (!user?.id) return;

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx. 20MB)');
      return;
    }

    setUploading(true);
    const path = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('team-chat-media')
      .upload(path, file);

    if (uploadError) {
      toast.error('Erro ao enviar arquivo');
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('team-chat-media').getPublicUrl(path);

    const isImage = file.type.startsWith('image/');
    await sendMessage(isImage ? '📷 Imagem' : `📎 ${file.name}`, {
      message_type: isImage ? 'image' : 'file',
      file_url: urlData.publicUrl,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type,
    });

    setUploading(false);
  }, [user?.id, sendMessage]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndSendFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadAndSendFile]);

  // Paste image (Ctrl+V)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void uploadAndSendFile(file);
        return;
      }
    }
  }, [uploadAndSendFile]);

  // Drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadAndSendFile(file);
  }, [uploadAndSendFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // Entity mention
  const handleEntitySelect = useCallback((entity: EntityMention) => {
    const mention = `[${entity.type}:${entity.id}:${entity.name}]`;
    setMessageText(prev => prev + mention + ' ');
  }, []);

  // Navigate on mention click
  const handleMentionNavigate = useCallback((type: EntityMentionType, id: string) => {
    switch (type) {
      case 'lead':
        navigate(`/leads?openLead=${id}`);
        break;
      case 'activity':
        navigate(`/?openActivity=${id}`);
        break;
      case 'contact':
        navigate(`/leads?openContact=${id}`);
        break;
    }
  }, [navigate]);

  // Audio playback
  const toggleAudio = useCallback((msgId: string, url: string) => {
    const existing = audioElementsRef.current.get(msgId);
    if (existing) {
      if (playingAudioId === msgId) {
        existing.pause();
        setPlayingAudioId(null);
      } else {
        existing.play();
        setPlayingAudioId(msgId);
      }
      return;
    }

    const audio = new Audio(url);
    audio.onended = () => setPlayingAudioId(null);
    audioElementsRef.current.set(msgId, audio);
    audio.play();
    setPlayingAudioId(msgId);
  }, [playingAudioId]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Render message bubble content
  const renderMsgContent = (msg: TeamMessage, isMe: boolean) => {
    const fwd = parseForward(msg.content);
    const fwdHeader = fwd.header ? (
      <div className="flex items-center gap-1 text-[10px] italic opacity-70 mb-0.5">
        <Forward className="h-3 w-3 shrink-0" />
        <span className="truncate">{fwd.header.replace('↪️ ', '')}</span>
      </div>
    ) : null;

    if (msg.message_type === 'audio' && msg.file_url) {
      return (
        <div>
          {fwdHeader}
          <button
            onClick={() => toggleAudio(msg.id, msg.file_url!)}
            className="flex items-center gap-2 py-1 w-full"
          >
            {playingAudioId === msg.id ? (
              <Pause className="h-4 w-4 shrink-0" />
            ) : (
              <Play className="h-4 w-4 shrink-0" />
            )}
            <div className="flex-1 h-1.5 rounded-full bg-current/20 min-w-[80px]">
              <div className={cn('h-full rounded-full', isMe ? 'bg-primary-foreground/60' : 'bg-foreground/40')} style={{ width: playingAudioId === msg.id ? '100%' : '0%', transition: 'width linear' }} />
            </div>
            <span className="text-[10px] opacity-70">
              {msg.audio_duration ? formatDuration(msg.audio_duration) : '0:00'}
            </span>
          </button>
          {msg.transcription && (
            <p className="text-xs mt-1 pt-1 border-t border-current/15 whitespace-pre-wrap break-words opacity-80 italic">
              {msg.transcription}
            </p>
          )}
        </div>
      );
    }

    if (msg.message_type === 'image' && msg.file_url) {
      return (
        <div>
          {fwdHeader}
          <a href={msg.file_url} target="_blank" rel="noopener noreferrer">
            <img src={msg.file_url} alt={msg.file_name || 'Imagem'} className="rounded-lg max-w-full max-h-48 object-cover" />
          </a>
          {fwd.body && fwd.body !== '📷 Imagem' && (
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">
              {renderMessageWithMentions(fwd.body, handleMentionNavigate)}
            </p>
          )}
        </div>
      );
    }

    if (msg.message_type === 'file' && msg.file_url) {
      return (
        <div>
          {fwdHeader}
          <a
            href={msg.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 py-1 hover:opacity-80"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{msg.file_name || 'Arquivo'}</div>
              {msg.file_size && (
                <div className="text-[10px] opacity-60">
                  {(msg.file_size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
          </a>
        </div>
      );
    }

    // Text with entity mentions
    return (
      <div>
        {fwdHeader}
        <p className="text-sm whitespace-pre-wrap break-words">
          {renderMessageWithMentions(fwd.body, handleMentionNavigate)}
        </p>
      </div>
    );
  };

  // Forward target picker
  if (forwardingMsg) {
    const fq = forwardSearch.trim().toLowerCase();
    const fwdPreview = forwardingMsg.content
      || (forwardingMsg.message_type === 'image' ? '📷 Imagem'
        : forwardingMsg.message_type === 'audio' ? '🎤 Áudio'
        : forwardingMsg.message_type === 'file' ? `📎 ${forwardingMsg.file_name || 'Arquivo'}` : '...');
    const groupConvs = conversations
      .filter(c => c.type === 'group')
      .filter(c => !fq || (c.name || '').toLowerCase().includes(fq));
    const fwdProfiles = profiles
      .filter(p => p.user_id !== user?.id && !isGoneUser(p.user_id))
      .filter(p => !fq
        || (p.full_name || '').toLowerCase().includes(fq)
        || (p.email || '').toLowerCase().includes(fq));
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => { setForwardingMsg(null); setForwardSearch(''); }}
            disabled={forwardSending}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Forward className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Encaminhar para...</span>
          {forwardSending && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
        </div>
        <div className="shrink-0 px-3 py-1.5 border-b bg-muted/20">
          <p className="text-[11px] text-muted-foreground truncate">
            <b>{forwardingMsg.sender_name || 'Mensagem'}:</b> {fwdPreview}
          </p>
        </div>
        <div className="shrink-0 px-3 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={forwardSearch}
              onChange={e => setForwardSearch(e.target.value)}
              placeholder="Buscar pessoa ou grupo..."
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {groupConvs.length === 0 && fwdProfiles.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">Ninguém encontrado com esse nome.</p>
            )}
            {groupConvs.map(c => (
              <button
                key={c.id}
                disabled={forwardSending}
                onClick={() => doForward(c.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3 disabled:opacity-50"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    <Hash className="h-3.5 w-3.5" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate flex-1">{c.name || 'Grupo'}</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">grupo</Badge>
              </button>
            ))}
            {fwdProfiles.map(p => (
              <button
                key={p.user_id}
                disabled={forwardSending}
                onClick={() => handleForwardToUser(p.user_id)}
                className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3 disabled:opacity-50"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    {getInitials(p.full_name || p.email || '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.full_name || p.email}</div>
                  {p.email && p.full_name && (
                    <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Active conversation
  if (activeConversationId) {
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const convTitle = activeConv?.type === 'group'
      ? (activeConv.name || 'Chat em Grupo')
      : (activeConv?.otherMemberName || 'Chat');

    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setActiveConversationId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
              {activeConv?.type === 'group' ? <Hash className="h-3.5 w-3.5" /> : getInitials(convTitle)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium truncate">{convTitle}</span>
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"
            title="Sua média de tempo pra responder o chat interno (30 dias, respostas em até 8h). Conta como critério de desempate no ranking de atividades."
          >
            <Timer className="h-3 w-3" /> média {fmtAvg(myAvgResp)}
          </span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              Nenhuma mensagem ainda. Diga oi! 👋
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === user?.id;
              const repliedMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
              const isHighlighted = highlightMsgId === msg.id;
              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  className={cn('group flex items-end gap-1', isMe ? 'justify-end' : 'justify-start')}
                >
                  {isMe && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                      <button
                        type="button"
                        onClick={() => alertMessageAgain(msg.id)}
                        className="p-1 rounded hover:bg-accent text-destructive"
                        title="Reenviar como urgente (alerta o destinatário de novo)"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(msg)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                        title="Responder"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setForwardingMsg(msg); setForwardSearch(''); }}
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                        title="Encaminhar para outra pessoa ou grupo"
                      >
                        <Forward className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <div className={cn(
                    'max-w-[85%] rounded-xl px-3 py-1.5 transition-shadow',
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted rounded-bl-sm',
                    msg.is_urgent && 'ring-1 ring-destructive',
                    isHighlighted && 'ring-2 ring-yellow-400'
                  )}>
                    {!isMe && (
                      <div className="text-[10px] font-semibold opacity-70 mb-0.5">
                        {msg.sender_name}
                      </div>
                    )}
                    {msg.is_urgent && (
                      <span className="inline-flex items-center gap-1 mb-0.5 px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                        <AlertTriangle className="h-2.5 w-2.5" /> URGENTE
                      </span>
                    )}
                    {repliedMsg && (
                      <button
                        type="button"
                        onClick={() => scrollToMessage(repliedMsg.id)}
                        className={cn(
                          'w-full text-left mb-1 pl-2 pr-2 py-1 border-l-2 rounded text-[11px] hover:opacity-80 transition-opacity',
                          isMe
                            ? 'border-primary-foreground/60 bg-primary-foreground/10'
                            : 'border-primary bg-background/60'
                        )}
                      >
                        <div className="font-semibold opacity-80 truncate">
                          {repliedMsg.sender_name || 'Mensagem'}
                        </div>
                        <div className="opacity-70 truncate">
                          {repliedMsg.content || (repliedMsg.message_type === 'image' ? '📷 Imagem' : repliedMsg.message_type === 'audio' ? '🎤 Áudio' : repliedMsg.message_type === 'file' ? `📎 ${repliedMsg.file_name || 'Arquivo'}` : '...')}
                        </div>
                      </button>
                    )}
                    {renderMsgContent(msg, isMe)}
                    <div className={cn('flex items-center gap-0.5 mt-0.5 justify-end', isMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                      <span className="text-[9px]">
                        {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                      </span>
                      {isMe && (() => {
                        const allRead = otherMembersReadAt.length > 0 && otherMembersReadAt.every(
                          readAt => new Date(readAt) >= new Date(msg.created_at)
                        );
                        return allRead
                          ? <CheckCheck className="h-3 w-3 text-blue-400" />
                          : <Check className="h-3 w-3" />;
                      })()}
                    </div>
                  </div>
                  {!isMe && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                      <button
                        type="button"
                        onClick={() => setReplyingTo(msg)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                        title="Responder"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setForwardingMsg(msg); setForwardSearch(''); }}
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                        title="Encaminhar para outra pessoa ou grupo"
                      >
                        <Forward className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Input area */}
        <div
          className={cn('shrink-0 border-t relative', dragOver && 'ring-2 ring-primary ring-inset bg-primary/5')}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <TeamChatEntityMention
            open={showEntityMention}
            onClose={() => setShowEntityMention(false)}
            onSelect={handleEntitySelect}
          />

          {/* Sugestão de resposta por IA — mesma UX do WhatsApp (tom + ajuste), persona de equipe. */}
          <AISuggestReply
            mode="team"
            hideTrigger
            open={aiSuggestOpen}
            onOpenChange={setAiSuggestOpen}
            buildContext={buildReplyContext}
            getState={buildReplyState}
            onApply={(text) => {
              setMessageText(text);
              requestAnimationFrame(() => messageInputRef.current?.focus());
            }}
          />

          {awaitingReply && !isRecording && (
            <div className="px-3 py-1.5 border-b bg-amber-500/10 flex items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-amber-500 animate-pulse shrink-0" />
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Aguardando sua resposta há <b className="tabular-nums">{fmtElapsed(awaitingElapsed)}</b>
              </span>
              <span
                className="ml-auto text-[10px] text-muted-foreground shrink-0"
                title="Média dos últimos 30 dias (respostas em até 8h). Entra no ranking de atividades como critério de desempate."
              >
                sua média: <b>{fmtAvg(myAvgResp)}</b>
              </span>
            </div>
          )}

          {replyingTo && (
            <div className="px-3 py-1.5 border-b bg-muted/40 flex items-start gap-2">
              <Reply className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold text-primary">
                  Respondendo a {replyingTo.sender_name || 'mensagem'}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {replyingTo.content || (replyingTo.message_type === 'image' ? '📷 Imagem' : replyingTo.message_type === 'audio' ? '🎤 Áudio' : replyingTo.message_type === 'file' ? `📎 ${replyingTo.file_name || 'Arquivo'}` : '...')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
                title="Cancelar resposta"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}


          {isRecording ? (
            <div className="px-3 py-2 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium flex-1">
                Gravando... {formatDuration(recordingDuration)}
              </span>
              <Button size="icon" variant="destructive" className="h-8 w-8" onClick={stopRecording}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="px-2 py-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowEntityMention(!showEntityMention)}
                title="Mencionar lead/contato/atividade"
              >
                <Briefcase className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Enviar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />

              <Button
                variant={urgent ? 'destructive' : 'ghost'}
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setUrgent(v => !v)}
                title={urgent ? 'Mensagem marcada como URGENTE' : 'Marcar como urgente'}
              >
                <AlertTriangle className={cn('h-4 w-4', urgent && 'animate-pulse')} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setAiSuggestOpen(true)}
                title="Sugerir resposta com IA (baseada na conversa)"
              >
                <Sparkles className="h-4 w-4 text-primary" />
              </Button>

              <div className="relative flex-1 min-w-0">
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-md shadow-lg z-50 max-h-56 overflow-auto">
                    {mentionCandidates.map((p, i) => (
                      <button
                        key={p.user_id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); insertMention(p.full_name || p.email || 'membro', p.user_id); }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                          i === mentionIndex && 'bg-accent'
                        )}
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                            {getInitials(p.full_name || p.email || '?')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{p.full_name || p.email}</div>
                          {p.full_name && p.email && (
                            <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  ref={messageInputRef}
                  value={messageText}
                  onChange={(e) => handleMessageChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Digite sua mensagem... use @ para mencionar"
                  className="text-sm h-8 w-full"
                />
              </div>

              {messageText.trim() ? (
                <Button
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleSend}
                  disabled={sendingMessage || uploading}
                >
                  {(sendingMessage || uploading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={startRecording}
                  disabled={uploading}
                  title="Gravar áudio"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // New chat selection
  if (showNewChat) {
    const newChatQuery = newChatSearch.trim().toLowerCase();
    const otherProfiles = profiles
      .filter(p => p.user_id !== user?.id && !inactiveIds.has(p.user_id))
      .filter(p => !newChatQuery
        || (p.full_name || '').toLowerCase().includes(newChatQuery)
        || (p.email || '').toLowerCase().includes(newChatQuery));
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowNewChat(false); setNewChatSearch(''); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">Nova Conversa</span>
        </div>
        <div className="shrink-0 px-3 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={newChatSearch}
              onChange={e => setNewChatSearch(e.target.value)}
              placeholder="Buscar pessoa por nome..."
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {otherProfiles.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">Ninguém encontrado com esse nome.</p>
            )}
            {otherProfiles.map(p => (
              <button
                key={p.user_id}
                onClick={async () => {
                  await startDirectChat(p.user_id);
                  setShowNewChat(false);
                }}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    {getInitials(p.full_name || p.email || '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.full_name || p.email}</div>
                  {p.email && p.full_name && (
                    <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Conversation list
  const convQuery = convSearch.trim().toLowerCase();
  const activeTeamGroup = teamFilter === 'all' ? null : teamGroups.find(t => t.name === teamFilter);

  // Mensagem de encerramento não deixa pendência: curta, sem pergunta e dentro
  // da lista de fechamentos comuns (ou só emoji/pontuação, ex.: "👍").
  const CLOSING_WORDS = new Set([
    'ok', 'okay', 'okk', 'oks', 'blz', 'beleza', 'obrigado', 'obrigada', 'brigado', 'brigada',
    'valeu', 'vlw', 'feito', 'ta bom', 'tá bom', 'ta bem', 'tá bem', 'ta otimo', 'tá ótimo',
    'perfeito', 'show', 'certo', 'combinado', 'de nada', 'disponha', 'boa', 'top', 'joia',
    'jóia', 'tmj', 'é isso', 'isso', 'entendido', 'anotado', 'ciente', 'ja foi', 'já foi',
    'resolvido', 'pode deixar', 'deixa comigo', 'tudo certo', 'sim', 'uhum', 'aham',
    'obg', 'obrigado!', 'maravilha', 'otimo', 'ótimo', 'excelente', 'fechado', 'fechou',
  ]);
  const isClosingMessage = (text: string): boolean => {
    const t = (text || '').trim().toLowerCase();
    if (!t || t.length > 40 || t.includes('?')) return false;
    // remove emojis e pontuação pra comparar só o texto
    const cleaned = t
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/[!.,…:;~]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return true; // só emoji/pontuação (ex.: "👍", "✅")
    return CLOSING_WORDS.has(cleaned);
  };

  // Status de pendência da conversa:
  // 'responder'  → a última mensagem é de outra pessoa (em grupo, só se houver não lidas)
  // 'aguardando' → a última mensagem é minha e ninguém respondeu ainda
  // null         → sem pendência: mensagem de fechamento ("ok", "obrigado", "👍")
  //                ou dispensada no "✓ Resolvido" (até chegar mensagem nova)
  const convPendingStatus = (conv: (typeof conversations)[number]): 'responder' | 'aguardando' | null => {
    if (!conv.lastMessageSenderId || !user?.id) return null;
    if (
      conv.pendingDismissedAt && conv.lastMessageAt
      && new Date(conv.pendingDismissedAt) >= new Date(conv.lastMessageAt)
    ) return null;
    if (isClosingMessage(conv.lastMessage || '')) return null;
    if (conv.lastMessageSenderId === user.id) return 'aguardando';
    if (conv.type === 'direct') return 'responder';
    return (conv.unreadCount || 0) > 0 ? 'responder' : null;
  };

  const teamFilteredConversations = conversations.filter(conv => {
    // Conversa direta com quem saiu do escritório some da lista
    // (histórico continua no banco; só deixa de aparecer).
    if (conv.type === 'direct' && isGoneUser(conv.otherMemberId)) return false;
    if (activeTeamGroup) {
      const inGroupName = conv.type === 'group' && (conv.name || '').includes(activeTeamGroup.name);
      const otherInTeam = conv.type === 'direct' && !!conv.otherMemberId
        && activeTeamGroup.memberIds.includes(conv.otherMemberId);
      if (!inGroupName && !otherInTeam) return false;
    }
    return true;
  });

  const responderCount = teamFilteredConversations.filter(c => convPendingStatus(c) === 'responder').length;
  const aguardandoCount = teamFilteredConversations.filter(c => convPendingStatus(c) === 'aguardando').length;

  const filteredConversations = teamFilteredConversations.filter(conv => {
    if (statusFilter !== 'all' && convPendingStatus(conv) !== statusFilter) return false;
    if (!convQuery) return true;
    const title = conv.type === 'group' ? (conv.name || 'Grupo') : (conv.otherMemberName || '');
    return title.toLowerCase().includes(convQuery)
      || (conv.lastMessage || '').toLowerCase().includes(convQuery);
  });

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-muted-foreground">Conversas</span>
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80 truncate"
            title="Sua média de tempo pra responder o chat interno (30 dias, respostas em até 8h). Conta como critério de desempate no ranking de atividades."
          >
            <Timer className="h-3 w-3 shrink-0" /> média {fmtAvg(myAvgResp)}
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={ensureGeneralChat}>
            <Users className="h-3.5 w-3.5" /> Geral
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowNewChat(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-b space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={convSearch}
            onChange={e => setConvSearch(e.target.value)}
            placeholder="Buscar conversa por nome..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        {teamGroups.length > 0 && (
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Filtrar por time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os times</SelectItem>
              {teamGroups.map(t => (
                <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors',
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
            )}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter(v => v === 'responder' ? 'all' : 'responder')}
            title="Conversas em que a última mensagem é de outra pessoa — esperando VOCÊ responder"
            className={cn(
              'flex-1 h-6 rounded-full text-[10px] font-semibold border transition-colors inline-flex items-center justify-center gap-1',
              statusFilter === 'responder'
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/20'
            )}
          >
            <Timer className="h-3 w-3" /> Responder{responderCount > 0 ? ` (${responderCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter(v => v === 'aguardando' ? 'all' : 'aguardando')}
            title="Conversas em que a última mensagem é sua — esperando os OUTROS responderem"
            className={cn(
              'flex-1 h-6 rounded-full text-[10px] font-semibold border transition-colors inline-flex items-center justify-center gap-1',
              statusFilter === 'aguardando'
                ? 'bg-sky-500 text-white border-sky-500'
                : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/40 hover:bg-sky-500/20'
            )}
          >
            <Reply className="h-3 w-3" /> Aguardando{aguardandoCount > 0 ? ` (${aguardandoCount})` : ''}
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-xs text-center gap-2 px-6">
            <MessageCircle className="h-8 w-8 opacity-30" />
            <p>Nenhuma conversa ainda.<br/>Clique em <b>"Geral"</b> para o chat da equipe ou <b>"Nova"</b> para conversa direta.</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            {statusFilter === 'responder'
              ? 'Nada pendente de resposta sua. 🎉'
              : statusFilter === 'aguardando'
                ? 'Ninguém te devendo resposta.'
                : 'Nenhuma conversa com esse nome.'}
          </p>
        ) : (
          <div className="divide-y">
            {filteredConversations.map(conv => {
              const title = conv.type === 'group' ? (conv.name || 'Grupo') : (conv.otherMemberName || 'Chat');
              const hasUnread = (conv.unreadCount || 0) > 0;
              const pending = convPendingStatus(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversationId(conv.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3',
                    hasUnread && 'bg-primary/5',
                    pending === 'responder' && 'bg-amber-500/10 border-l-2 border-l-amber-500',
                    pending === 'aguardando' && 'border-l-2 border-l-sky-500/70'
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs bg-primary/20 text-primary">
                      {conv.type === 'group' ? <Hash className="h-3.5 w-3.5" /> : getInitials(title)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{title}</span>
                      {conv.type === 'group' && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">grupo</Badge>
                      )}
                      {pending === 'responder' && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold"
                          title="A última mensagem é de outra pessoa — esperando você responder"
                        >
                          <Timer className="h-2.5 w-2.5 animate-pulse" /> RESPONDER
                        </span>
                      )}
                      {pending === 'aguardando' && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 h-4 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/40 text-[9px] font-semibold"
                          title="A última mensagem é sua — esperando os outros responderem"
                        >
                          <Reply className="h-2.5 w-2.5" /> aguardando
                        </span>
                      )}
                    </div>
                    {conv.lastMessage && (
                      <p className="text-[11px] text-muted-foreground truncate">{conv.lastMessage}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {conv.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(conv.lastMessageAt), 'dd/MM HH:mm', { locale: ptBR })}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      {pending && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); dismissPending(conv.id); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              dismissPending(conv.id);
                            }
                          }}
                          title="Marcar como resolvida — some dos pendentes até chegar mensagem nova"
                          className={cn(
                            'w-5 h-5 rounded-full border flex items-center justify-center transition-colors',
                            pending === 'responder'
                              ? 'border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white'
                              : 'border-sky-500/50 text-sky-600 dark:text-sky-400 hover:bg-sky-500 hover:text-white'
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                      {hasUnread && (
                        <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

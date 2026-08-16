import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useTeamDirectChat, isManagedGroup, TeamMessage } from '@/hooks/useTeamDirectChat';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';

// Formulário COMPLETO de atividade (único do sistema) — lazy pra não pesar o chat.
const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then((m) => ({ default: m.ActivityFullSheet }))
);
import { useProfilesList } from '@/hooks/useProfilesList';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { useInactiveUserIds } from '@/hooks/useInactiveUserIds';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Send, Users, MessageCircle, ArrowLeft, Loader2, Plus, Hash,
  Mic, Square, Paperclip, Image, FileText, Briefcase, ClipboardList,
  Play, Pause, Check, CheckCheck, Reply, X, AlertTriangle, Search, Timer, Forward, Phone,
  MessageCircleReply,
} from 'lucide-react';
import { useCall } from '@/contexts/CallContext';
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
import { ChatMessageActions } from './ChatMessageActions';
import { ForwardMessagePicker } from './ForwardMessagePicker';
import { NewGroupPanel, GroupMembersPanel, GroupPerson } from './TeamGroupPanels';
import {
  buildForwardContent,
  buildPrivateReplyHeader,
  msgPlainText,
  msgPreviewText,
  parseForward,
  parsePrivateReply,
} from '@/lib/teamChatMessageContext';
import { formatQuotedMessages } from '@/lib/teamChatQuoteEvents';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { AITextActions } from '@/components/ui/AITextActions';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { Sparkles } from 'lucide-react';
import type { TeamChatOpenIntent, TeamChatContextReply } from '@/lib/teamChatPanelEvents';

interface TeamDirectChatPanelProps {
  intent?: TeamChatOpenIntent | null;
  onIntentHandled?: () => void;
}

export function TeamDirectChatPanel({ intent, onIntentHandled }: TeamDirectChatPanelProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const { startCall } = useCall();
  const {
    conversations, messages, activeConversationId, setActiveConversationId,
    loading, sendingMessage, sendMessage, sendMessageTo, alertMessageAgain, dismissPending, startDirectChat, ensureGeneralChat,
    createGroupConversation, fetchConversationMembers, addGroupMembers, removeGroupMember, leaveGroup, renameGroup,
    otherMembersReadAt, typingPeers, sendTypingSignal,
  } = useTeamDirectChat();
  const profiles = useProfilesList();
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  // Grupo: criação e tela de participantes da conversa aberta.
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'responder' | 'aguardando'>('all');
  const [teamGroups, setTeamGroups] = useState<{ name: string; memberIds: string[] }[]>([]);
  // Desativados (org_user_status) somem do chat: sem conversa nova, sem @menção
  // e a conversa direta antiga fica oculta.
  const inactiveIds = useInactiveUserIds();

  // Times pro filtro: usa os grupos "👥 {time}" sincronizados na aba Times
  useEffect(() => {
    (async () => {
      try {
        await ensureExternalSession();
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
  // "Responder no privado": mensagem de outro chat (grupo, ficha ou conversa do
  // WhatsApp) respondida na conversa direta com quem escreveu. O contexto pode
  // nascer aqui ou chegar de outro painel pelo intent.
  const [privateReply, setPrivateReply] = useState<
    (TeamChatContextReply & { targetConvId: string }) | null
  >(null);
  const [forwardingMsg, setForwardingMsg] = useState<TeamMessage | null>(null);
  const [forwardSending, setForwardSending] = useState(false);
  // "Criar atividade a partir do chat": seleção de mensagens + rascunho da IA
  const [activitySelectMode, setActivitySelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [creatingActivityDraft, setCreatingActivityDraft] = useState(false);
  const [activityDraft, setActivityDraft] = useState<ActivityDraft | null>(null);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  // Mensagens que geraram o rascunho aberto — viram vínculo quando a atividade é criada.
  const [originMsgIds, setOriginMsgIds] = useState<string[]>([]);
  // Vínculo já gravado: message_id -> atividade (marca a bolha e dá o atalho).
  const [msgActivities, setMsgActivities] = useState<Record<string, { activity_id: string; activity_title: string | null }>>({});
  // Atividade aberta pelo atalho da bolha (ficha completa, modo edição).
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);
  // Imagem sempre abre no visualizador interno — nunca em outra página.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  // Mensagem específica que a IA deve responder (botão da bolha).
  const [aiTargetMessage, setAiTargetMessage] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Parou de teclar por um tempo => avisa que não está mais digitando.
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which user_ids were @mentioned in the current draft
  const mentionedUsersRef = useRef<Map<string, string>>(new Map()); // name -> user_id

  // Membro que saiu do escritório: desativado no org_user_status ou com o
  // perfil apagado do Cloud (só avalia "apagado" depois dos profiles carregarem).
  const isGoneUser = (uid?: string | null) => {
    if (!uid) return false;
    if (inactiveIds.has(uid)) return true;
    return profiles.length > 0 && !profiles.some(p => p.user_id === uid);
  };

  // Quem pode entrar em grupo: mesmo critério do seletor de @menção — sem
  // desativados e sem as contas de teste/duplicadas da blocklist.
  const groupPeople: GroupPerson[] = useMemo(() => (
    filterAssignableMembers(profiles)
      .filter(p => p.user_id !== user?.id && !inactiveIds.has(p.user_id))
      .map(p => ({ id: p.user_id, name: p.full_name || p.email || 'Sem nome', email: p.email }))
  ), [profiles, inactiveIds, user?.id]);

  const personName = useCallback((uid: string) => {
    const p = profiles.find(pp => pp.user_id === uid);
    return p?.full_name || p?.email || 'Membro';
  }, [profiles]);

  const loadGroupMembers = useCallback(async (conversationId: string) => {
    setGroupMembersLoading(true);
    try {
      setGroupMemberIds(await fetchConversationMembers(conversationId));
    } finally {
      setGroupMembersLoading(false);
    }
  }, [fetchConversationMembers]);

  // Filtered members for @mention picker
  const mentionCandidates = (() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase().trim();
    return filterAssignableMembers(profiles)
      .filter(p => p.user_id !== user?.id && !inactiveIds.has(p.user_id))
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .slice(0, 6);
  })();

  /** Sinaliza "digitando" e reagenda o "parou de digitar" (3s sem tecla). */
  const pingTyping = useCallback(() => {
    sendTypingSignal('typing');
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => sendTypingSignal('stop'), 3000);
  }, [sendTypingSignal]);

  /** Encerra o indicador na hora (enviou, limpou o campo, saiu da conversa). */
  const stopTyping = useCallback(() => {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    sendTypingSignal('stop');
  }, [sendTypingSignal]);

  // Trocou/fechou a conversa ou desmontou o painel: não deixa o outro
  // vendo "digitando" pra sempre.
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      sendTypingSignal('stop');
    };
  }, [activeConversationId, sendTypingSignal]);

  const handleMessageChange = (value: string) => {
    setMessageText(value);
    if (value.trim()) pingTyping(); else stopTyping();
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

    // "Responder no privado" disparado de outro chat (grupo, ficha, WhatsApp):
    // a tarja aparece aqui e o cabeçalho entra no content só no envio.
    if (intent.contextReply) {
      setReplyingTo(null);
      setPrivateReply({ ...intent.contextReply, targetConvId: intent.conversationId });
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
  const activeConvForStatus = conversations.find(c => c.id === activeConversationId) ?? null;
  const activeConvType = activeConvForStatus?.type ?? null;
  // "Conversa finalizada": se já dispensei a pendência DEPOIS da última mensagem,
  // o banner de cobrança some (volta sozinho quando chegar mensagem nova).
  const activeConvDismissed = !!(
    activeConvForStatus?.pendingDismissedAt && lastMsg
    && new Date(activeConvForStatus.pendingDismissedAt) >= new Date(lastMsg.created_at)
  );
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
  const awaitingReply = lastMsgFromOther && !activeConvDismissed && (activeConvType === 'direct' || lastMsgMentionsMe);
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

  // ===== "Fulano está digitando / gravando áudio" =====
  // Vem do broadcast do canal da conversa (nada é gravado no banco).
  const someoneRecording = typingPeers.some(p => p.kind === 'recording');
  const typingLabel = useMemo(() => {
    if (typingPeers.length === 0) return null;
    const firstName = (n: string) => (n || 'Alguém').trim().split(/\s+/)[0];
    const phrase = (list: typeof typingPeers, one: string, many: string) => {
      if (list.length === 0) return null;
      if (list.length === 1) return `${firstName(list[0].name)} ${one}`;
      if (list.length === 2) return `${firstName(list[0].name)} e ${firstName(list[1].name)} ${many}`;
      return `${list.length} pessoas ${many}`;
    };
    return [
      phrase(typingPeers.filter(p => p.kind === 'recording'), 'está gravando um áudio', 'estão gravando áudio'),
      phrase(typingPeers.filter(p => p.kind === 'typing'), 'está digitando', 'estão digitando'),
    ].filter(Boolean).join(' · ');
  }, [typingPeers]);

  // ===== Responder no privado (mensagem de grupo → conversa direta) =====
  // O contexto vai no próprio content (cabeçalho + trecho citado), montado em
  // teamChatMessageContext — o mesmo formato usado pelo chat interno da ficha.
  const startPrivateReply = async (msg: TeamMessage, groupName: string) => {
    if (!msg.sender_id || msg.sender_id === user?.id) return;
    const convId = await startDirectChat(msg.sender_id);
    if (!convId) return;
    const scopeLabel = `grupo ${groupName}`;
    const excerpt = msgPreviewText(msg).replace(/\s+/g, ' ').trim().slice(0, 120);
    setReplyingTo(null);
    setPrivateReply({
      header: buildPrivateReplyHeader(scopeLabel, excerpt),
      scopeLabel,
      senderName: msg.sender_name,
      excerpt,
      targetConvId: convId,
    });
    requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  // Trocou de conversa sem enviar → descarta o contexto do "responder no privado"
  useEffect(() => {
    if (privateReply && activeConversationId !== privateReply.targetConvId) {
      setPrivateReply(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  const handleSend = async () => {
    if (!messageText.trim()) return;
    stopTyping();
    const mentionedIds = resolveMentionedUserIds(messageText);
    const content = privateReply
      ? `${privateReply.header}\n${messageText}`
      : messageText;
    await sendMessage(content, {
      mentionedUserIds: mentionedIds,
      reply_to_id: replyingTo?.id || null,
      is_urgent: urgent,
    });
    setMessageText('');
    mentionedUsersRef.current.clear();
    setReplyingTo(null);
    setPrivateReply(null);
    setUrgent(false);
  };

  // ===== Encaminhar mensagem =====
  // O cabeçalho "↪️ Encaminhada de X por Y" vai no próprio content
  // (teamChatMessageContext): fica legível no preview da conversa, no push e no
  // contexto da IA, sem mudança de schema.
  const myDisplayName = profiles.find(p => p.user_id === user?.id)?.full_name || user?.email || 'Alguém';

  const doForward = async (targetConversationId: string) => {
    if (!forwardingMsg || forwardSending) return;
    setForwardSending(true);
    try {
      const msg = forwardingMsg;
      // Mensagem própria não vira "encaminhada de mim mesmo".
      const origin = msg.sender_id === user?.id ? { ...msg, sender_name: myDisplayName } : msg;
      await sendMessageTo(targetConversationId, buildForwardContent(origin, myDisplayName), {
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

  // ===== Criar atividade a partir de mensagens do chat =====
  const { types: activityTypes } = useActivityTypes();

  const startActivitySelection = (msg: TeamMessage) => {
    setActivitySelectMode(true);
    setSelectedMsgIds(new Set([msg.id]));
  };

  const toggleMsgSelection = (msgId: string) => {
    setSelectedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  };

  const cancelActivitySelection = () => {
    setActivitySelectMode(false);
    setSelectedMsgIds(new Set());
  };

  // Texto de uma mensagem pro contexto da IA (áudio usa a transcrição)
  const msgTextForAI = (m: TeamMessage): string => {
    if (m.message_type === 'audio') return m.transcription?.trim() || '🎤 Áudio (sem transcrição)';
    if (m.message_type === 'image') return m.content && m.content !== '📷 Imagem' ? m.content : '📷 Imagem';
    if (m.message_type === 'file') return `📎 Arquivo: ${m.file_name || 'sem nome'}`;
    return m.content || '';
  };

  /** Cita o texto no rascunho ("> …") — mesma ação do chat interno da ficha. */
  const quoteMessage = (m: TeamMessage) => {
    const text = msgPlainText(m);
    if (!text.trim()) { toast.error('Essa mensagem não tem texto para citar.'); return; }
    let when = '';
    try { when = format(new Date(m.created_at), 'dd/MM HH:mm', { locale: ptBR }); } catch { /* sem data */ }
    const quote = formatQuotedMessages([{
      who: m.sender_id === user?.id ? 'Eu' : (m.sender_name || 'Colega'),
      when,
      text,
    }]);
    setMessageText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${quote}\n` : `${quote}\n`));
    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  /** Copia o texto da bolha (áudio usa a transcrição). */
  const copyMessageText = async (m: TeamMessage) => {
    const text = m.message_type === 'audio' ? (m.transcription || '').trim() : (m.content || '').trim();
    if (!text) { toast.error('Essa mensagem não tem texto para copiar.'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Texto copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  /** Abre a sugestão da IA focada NESTA mensagem. */
  const replyWithAI = (m: TeamMessage) => {
    const text = m.message_type === 'audio' ? (m.transcription || '').trim() : (m.content || '').trim();
    if (!text) { toast.error('Essa mensagem não tem texto para a IA responder.'); return; }
    setAiTargetMessage(text);
    setAiSuggestOpen(true);
  };

  const createActivityFromSelection = async () => {
    const selected = messages
      .filter(m => selectedMsgIds.has(m.id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (selected.length === 0) {
      toast.error('Selecione pelo menos uma mensagem');
      return;
    }
    setCreatingActivityDraft(true);
    try {
      const myName = profiles.find(p => p.user_id === user?.id)?.full_name || user?.email || 'Eu';
      const transcript = selected
        .map(m => {
          const who = m.sender_id === user?.id ? myName : (m.sender_name || 'Colega');
          return `${who}: ${msgTextForAI(m)}`;
        })
        .join('\n');
      const memberNames = profiles
        .filter(p => !isGoneUser(p.user_id))
        .map(p => p.full_name)
        .filter(Boolean) as string[];

      // Tipos ainda não carregados no clique (cache frio/sessão do Externo atrasada) →
      // busca direto; com lista vazia a IA é instruída a deixar o TIPO em branco.
      let typeOptions = activityTypes.filter(t => t.is_active).map(t => ({ key: t.key, label: t.label }));
      if (typeOptions.length === 0) {
        await ensureExternalSession();
        const { data: tRows } = await externalSupabase
          .from('activity_types')
          .select('key, label, is_active')
          .order('display_order', { ascending: true });
        typeOptions = ((tRows as { key: string; label: string; is_active: boolean }[]) || [])
          .filter(t => t.is_active)
          .map(t => ({ key: t.key, label: t.label }));
      }

      const { data, error } = await cloudFunctions.invoke('chat-to-activity', {
        body: {
          transcript,
          activity_types: typeOptions,
          member_names: memberNames,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao gerar o rascunho da atividade');

      const f = data.fields || {};
      // Assessor sugerido pela IA → user_id (match exato de nome; o usuário pode trocar no formulário)
      const assigneeProfile = f.assignee_name
        ? profiles.find(p => (p.full_name || '').trim().toLowerCase() === String(f.assignee_name).trim().toLowerCase())
        : null;

      setActivityDraft({
        title: f.title || '',
        activity_type: f.activity_type || '',
        priority: f.priority || 'normal',
        deadline: f.deadline || undefined,
        lead_name: f.lead_name || undefined,
        assigned_to: assigneeProfile?.user_id || undefined,
        assigned_to_name: assigneeProfile?.full_name || undefined,
        what_was_done: f.what_was_done || '',
        current_status_notes: f.current_status || '',
        next_steps: f.next_steps || '',
        notes: [f.notes || '', `— Origem: chat interno —\n${transcript}`].filter(Boolean).join('\n\n'),
      });
      setOriginMsgIds(selected.map(m => m.id));
      setActivitySheetOpen(true);
      cancelActivitySelection();
    } catch (e: any) {
      console.error('[TeamDirectChatPanel] Erro ao gerar atividade do chat:', e);
      toast.error(e?.message || 'Não foi possível gerar a atividade');
    } finally {
      setCreatingActivityDraft(false);
    }
  };

  // ===== Vínculo mensagem → atividade (marca a bolha e dá o atalho) =====
  // Só os IDs entram na dependência: `messages` muda de identidade a cada evento
  // do realtime e recarregaria o vínculo à toa.
  const msgIdsKey = useMemo(() => messages.map(m => m.id).join(','), [messages]);

  const loadMsgActivities = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setMsgActivities({}); return; }
    try {
      await ensureExternalSession();
      const { data, error } = await ((externalSupabase as any).from('team_message_activities') as any)
        .select('message_id, activity_id, activity_title')
        .in('message_id', ids);
      if (error) throw error;
      const map: Record<string, { activity_id: string; activity_title: string | null }> = {};
      for (const row of (data || []) as { message_id: string; activity_id: string; activity_title: string | null }[]) {
        map[row.message_id] = { activity_id: row.activity_id, activity_title: row.activity_title };
      }
      setMsgActivities(map);
    } catch (e) {
      // Chat funciona sem o vínculo — só perde o selo/atalho.
      console.warn('[TeamDirectChatPanel] vínculos mensagem→atividade indisponíveis:', e);
    }
  }, []);

  useEffect(() => {
    loadMsgActivities(msgIdsKey ? msgIdsKey.split(',') : []);
  }, [msgIdsKey, loadMsgActivities]);

  /** Grava de quais mensagens a atividade nasceu (chamado ao criar de fato). */
  const linkMessagesToActivity = async (created?: { id?: string; title?: string } | null) => {
    const ids = originMsgIds;
    setOriginMsgIds([]);
    if (!created?.id || ids.length === 0) return;
    try {
      await ensureExternalSession();
      const rows = ids.map(mid => ({
        message_id: mid,
        conversation_id: activeConversationId,
        activity_id: created.id,
        activity_title: created.title || null,
        created_by: user?.id || null,
      }));
      const { error } = await ((externalSupabase as any).from('team_message_activities') as any)
        .upsert(rows, { onConflict: 'message_id,activity_id' });
      if (error) throw error;
      setMsgActivities(prev => {
        const next = { ...prev };
        ids.forEach(id => { next[id] = { activity_id: created.id!, activity_title: created.title || null }; });
        return next;
      });
    } catch (e) {
      console.warn('[TeamDirectChatPanel] não consegui registrar a origem da atividade:', e);
    }
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
        stopTyping();

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
      // Enquanto grava, o outro lado vê "está gravando um áudio...".
      sendTypingSignal('recording');

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
        sendTypingSignal('recording'); // o hook limita a 1 envio a cada 2s
      }, 1000);
    } catch {
      toast.error('Permissão de microfone negada');
    }
  }, [user?.id, sendMessage, recordingDuration, sendTypingSignal, stopTyping]);

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
          <button type="button" onClick={() => setLightboxUrl(msg.file_url!)} className="block cursor-zoom-in">
            <img src={msg.file_url} alt={msg.file_name || 'Imagem'} className="rounded-lg max-w-full max-h-48 object-cover" />
          </button>
          {fwd.body && fwd.body !== '📷 Imagem' && (
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">
              {renderMessageWithMentions(fwd.body, handleMentionNavigate)}
            </p>
          )}
        </div>
      );
    }

    if (msg.message_type === 'file' && msg.file_url) {
      // Anexo que na verdade é imagem/PDF também abre no visualizador interno.
      const previewable = /^image\//i.test(msg.file_type || '') || /\.(jpe?g|png|webp|gif|pdf)($|\?)/i.test(msg.file_url);
      const fileClass = 'flex items-center gap-2 py-1 hover:opacity-80 w-full text-left';
      const fileBody = (
        <>
          <FileText className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{msg.file_name || 'Arquivo'}</div>
            {msg.file_size && (
              <div className="text-[10px] opacity-60">
                {(msg.file_size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
        </>
      );
      return (
        <div>
          {fwdHeader}
          {previewable ? (
            <button type="button" onClick={() => setLightboxUrl(msg.file_url!)} className={fileClass}>
              {fileBody}
            </button>
          ) : (
            <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className={fileClass}>
              {fileBody}
            </a>
          )}
        </div>
      );
    }

    // Resposta no privado: cabeçalho citando a mensagem do grupo
    const pvt = parsePrivateReply(msg.content);
    if (pvt.header) {
      return (
        <div>
          <div className={cn(
            'flex items-start gap-1 mb-1 pl-2 pr-2 py-1 border-l-2 rounded text-[11px] italic opacity-80',
            isMe ? 'border-primary-foreground/60 bg-primary-foreground/10' : 'border-primary bg-background/60'
          )}>
            <MessageCircleReply className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="break-words">{pvt.header.replace('↩️ ', '')}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">
            {renderMessageWithMentions(pvt.body, handleMentionNavigate)}
          </p>
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

  // Forward target picker — o mesmo seletor usado pelo chat interno da ficha.
  if (forwardingMsg) {
    return (
      <ForwardMessagePicker
        preview={msgPreviewText(forwardingMsg)}
        senderName={forwardingMsg.sender_name}
        sending={forwardSending}
        groups={conversations.filter(c => c.type === 'group').map(c => ({ id: c.id, name: c.name }))}
        excludeUserIds={inactiveIds}
        onCancel={() => setForwardingMsg(null)}
        onPickConversation={doForward}
        onPickUser={handleForwardToUser}
      />
    );
  }

  // Active conversation
  if (activeConversationId) {
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const convTitle = activeConv?.type === 'group'
      ? (activeConv.name || 'Chat em Grupo')
      : (activeConv?.otherMemberName || 'Chat');

    // Participantes do grupo: tela DENTRO do painel — o voltar devolve pra conversa.
    if (showGroupMembers && activeConv?.type === 'group') {
      const memberPeople: GroupPerson[] = groupMemberIds.map(uid => {
        const p = profiles.find(pp => pp.user_id === uid);
        return { id: uid, name: p?.full_name || p?.email || 'Membro', email: p?.email ?? null };
      });
      const memberSet = new Set(groupMemberIds);

      return (
        <GroupMembersPanel
          groupName={convTitle}
          managed={isManagedGroup(activeConv)}
          loading={groupMembersLoading}
          busy={groupBusy}
          members={memberPeople}
          candidates={groupPeople.filter(p => !memberSet.has(p.id))}
          currentUserId={user?.id}
          onBack={() => setShowGroupMembers(false)}
          onRename={async (name) => {
            setGroupBusy(true);
            await renameGroup(activeConversationId, name);
            setGroupBusy(false);
          }}
          onAdd={async (people) => {
            setGroupBusy(true);
            await addGroupMembers(activeConversationId, people);
            await loadGroupMembers(activeConversationId);
            setGroupBusy(false);
          }}
          onRemove={async (person) => {
            setGroupBusy(true);
            await removeGroupMember(activeConversationId, person);
            await loadGroupMembers(activeConversationId);
            setGroupBusy(false);
          }}
          onLeave={async () => {
            setGroupBusy(true);
            const ok = await leaveGroup(activeConversationId);
            setGroupBusy(false);
            if (ok) setShowGroupMembers(false);
          }}
        />
      );
    }

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
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {activeConv?.type === 'group' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs gap-1 text-muted-foreground"
                title="Participantes do grupo"
                onClick={() => { setShowGroupMembers(true); loadGroupMembers(activeConversationId); }}
              >
                <Users className="h-3.5 w-3.5" />
                {activeConv.memberCount ?? ''}
              </Button>
            )}
            {activeConv?.type === 'direct' && activeConv.otherMemberId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-600 hover:text-green-700"
                title={`Ligar para ${convTitle} (voz pelo sistema)`}
                onClick={() => startCall(activeConv.otherMemberId!, convTitle)}
              >
                <Phone className="h-4 w-4" />
              </Button>
            )}
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              title="Sua média de tempo pra responder o chat interno (30 dias, respostas em até 8h). Conta como critério de desempate no ranking de atividades."
            >
              <Timer className="h-3 w-3" /> média {fmtAvg(myAvgResp)}
            </span>
          </div>
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
              const isSelected = activitySelectMode && selectedMsgIds.has(msg.id);
              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  onClick={activitySelectMode ? () => toggleMsgSelection(msg.id) : undefined}
                  className={cn(
                    'group flex items-end gap-1',
                    isMe ? 'justify-end' : 'justify-start',
                    activitySelectMode && 'cursor-pointer'
                  )}
                >
                  {activitySelectMode && !isMe && (
                    <span className={cn(
                      'shrink-0 w-4 h-4 rounded-full border flex items-center justify-center self-center',
                      isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                  )}
                  {isMe && !activitySelectMode && (
                    <ChatMessageActions
                      isMe
                      onAlertAgain={() => alertMessageAgain(msg.id)}
                      onReply={() => setReplyingTo(msg)}
                      onQuote={() => quoteMessage(msg)}
                      onCopy={() => copyMessageText(msg)}
                      onAI={() => replyWithAI(msg)}
                      onForward={() => setForwardingMsg(msg)}
                      onCreateActivity={() => startActivitySelection(msg)}
                    />
                  )}
                  <div className={cn(
                    'max-w-[85%] rounded-xl px-3 py-1.5 transition-shadow',
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted rounded-bl-sm',
                    msg.is_urgent && 'ring-1 ring-destructive',
                    isHighlighted && 'ring-2 ring-yellow-400',
                    isSelected && 'ring-2 ring-primary'
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
                    {msgActivities[msg.id] && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenActivityId(msgActivities[msg.id].activity_id); }}
                        className={cn(
                          'w-full mt-1 flex items-center gap-1 px-1.5 py-1 rounded border text-[10px] font-medium text-left hover:opacity-80 transition-opacity',
                          isMe
                            ? 'border-primary-foreground/40 bg-primary-foreground/10'
                            : 'border-primary/40 bg-background/60'
                        )}
                        title="Abrir a atividade criada a partir desta mensagem"
                      >
                        <ClipboardList className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          Virou atividade{msgActivities[msg.id].activity_title ? `: ${msgActivities[msg.id].activity_title}` : ''}
                        </span>
                      </button>
                    )}
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
                  {!isMe && !activitySelectMode && (
                    <ChatMessageActions
                      isMe={false}
                      onReply={() => setReplyingTo(msg)}
                      onPrivateReply={
                        activeConv?.type === 'group' && !isGoneUser(msg.sender_id)
                          ? () => startPrivateReply(msg, activeConv?.name || 'grupo')
                          : undefined
                      }
                      privateReplyTitle={`Responder no privado (abre a conversa direta com ${msg.sender_name || 'o autor'})`}
                      onQuote={() => quoteMessage(msg)}
                      onCopy={() => copyMessageText(msg)}
                      onAI={() => replyWithAI(msg)}
                      onForward={() => setForwardingMsg(msg)}
                      onCreateActivity={() => startActivitySelection(msg)}
                    />
                  )}
                  {activitySelectMode && isMe && (
                    <span className={cn(
                      'shrink-0 w-4 h-4 rounded-full border flex items-center justify-center self-center order-first',
                      isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
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
            onOpenChange={(o) => { setAiSuggestOpen(o); if (!o) setAiTargetMessage(undefined); }}
            targetMessage={aiTargetMessage}
            buildContext={buildReplyContext}
            getState={buildReplyState}
            onApply={(text) => {
              setMessageText(text);
              requestAnimationFrame(() => messageInputRef.current?.focus());
            }}
          />

          {activitySelectMode && (
            <div className="px-3 py-2 border-b bg-primary/5 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs flex-1">
                <b>{selectedMsgIds.size}</b> mensagem{selectedMsgIds.size === 1 ? '' : 's'} selecionada{selectedMsgIds.size === 1 ? '' : 's'} — toque nas mensagens pra incluir/remover
              </span>
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={createActivityFromSelection}
                disabled={creatingActivityDraft || selectedMsgIds.size === 0}
              >
                {creatingActivityDraft
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />}
                Criar atividade
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={cancelActivitySelection}
                disabled={creatingActivityDraft}
                title="Cancelar seleção"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {awaitingReply && !isRecording && (
            <div className="px-3 py-1.5 border-b bg-amber-500/10 flex items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-amber-500 animate-pulse shrink-0" />
              <span className="text-[11px] text-amber-600 dark:text-amber-400 min-w-0 truncate">
                Aguardando sua resposta há <b className="tabular-nums">{fmtElapsed(awaitingElapsed)}</b>
              </span>
              <button
                type="button"
                onClick={() => activeConversationId && dismissPending(activeConversationId)}
                title="Marcar como finalizada — some da cobrança até chegar mensagem nova"
                className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 h-6 rounded-full border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold hover:bg-emerald-500 hover:text-white transition-colors"
              >
                <Check className="h-3 w-3" /> Conversa finalizada
              </button>
              <span
                className="text-[10px] text-muted-foreground shrink-0"
                title="Média dos últimos 30 dias (respostas em até 8h). Entra no ranking de atividades como critério de desempate."
              >
                sua média: <b>{fmtAvg(myAvgResp)}</b>
              </span>
            </div>
          )}

          {privateReply && (
            <div className="px-3 py-1.5 border-b bg-primary/5 flex items-start gap-2">
              <MessageCircleReply className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold text-primary">
                  Respondendo no privado — {privateReply.senderName || 'mensagem'} no {privateReply.scopeLabel}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {privateReply.excerpt}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrivateReply(null)}
                className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
                title="Cancelar resposta no privado"
              >
                <X className="h-3.5 w-3.5" />
              </button>
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


          {/* "Fulano está digitando / gravando um áudio" — bloco no fluxo, empurra
              o composer pra baixo em vez de cobrir qualquer coisa. */}
          {typingLabel && (
            <div className="px-3 py-1 border-b bg-muted/20 flex items-center gap-2">
              {someoneRecording ? (
                <Mic className="h-3.5 w-3.5 text-destructive animate-pulse shrink-0" />
              ) : (
                <span className="flex items-end gap-0.5 shrink-0 h-3.5">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="w-1 h-1 rounded-full bg-primary animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground italic truncate">
                {typingLabel}...
              </span>
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
            <div className="px-2 py-2 space-y-1">
              {/* Ferramentas acima do campo — numa coluna estreita elas
                  espremiam o texto e a palavra quebrava letra a letra. */}
              <div className="flex items-center gap-0.5 flex-wrap">
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

              {/* Edição do texto com IA — mesmo menu do WhatsApp (tom, tradução,
                  resumo, rascunho, prompt personalizado). */}
              <AITextActions
                value={messageText}
                onChange={(v) => handleMessageChange(v)}
                buttonClassName="h-8 w-8 shrink-0 flex items-center justify-center"
              />

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => { setAiTargetMessage(undefined); setAiSuggestOpen(true); }}
                title="Sugerir resposta com IA (baseada na conversa)"
              >
                <Sparkles className="h-4 w-4 text-primary" />
              </Button>
              </div>

              {/* Linha do texto: campo com a largura toda + enviar/gravar. */}
              <div className="flex items-end gap-1">
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
                <AutoResizeTextarea
                  ref={messageInputRef}
                  value={messageText}
                  onChange={(e) => handleMessageChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Digite sua mensagem... use @ para mencionar"
                  className="w-full min-h-[32px] py-1.5 text-sm"
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
            </div>
          )}
        </div>

        {/* Formulário COMPLETO de atividade (aba lateral), pré-preenchido pela IA
            a partir das mensagens selecionadas. O usuário revisa, escolhe o
            assessor (qualquer membro) e cria de fato. */}
        {activityDraft && (
          <Suspense fallback={null}>
            <ActivityFullSheet
              open={activitySheetOpen}
              mode="create"
              draft={activityDraft}
              activityId={null}
              onOpenChange={(o) => {
                // Fechar sem criar descarta a origem — senão a próxima atividade
                // herdaria as mensagens desta.
                if (!o) { setActivitySheetOpen(false); setActivityDraft(null); setOriginMsgIds([]); }
              }}
              onCreated={(created) => {
                linkMessagesToActivity(created);
                toast.success('Atividade criada a partir do chat!');
              }}
            />
          </Suspense>
        )}

        {/* Atalho da bolha: abre a ficha da atividade que nasceu daquela mensagem. */}
        {openActivityId && (
          <Suspense fallback={null}>
            <ActivityFullSheet
              open={!!openActivityId}
              activityId={openActivityId}
              onOpenChange={(o) => { if (!o) setOpenActivityId(null); }}
            />
          </Suspense>
        )}

        <MediaLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      </div>
    );
  }

  // Novo grupo (nome + participantes)
  if (showNewGroup) {
    return (
      <NewGroupPanel
        people={groupPeople}
        creating={creatingGroup}
        onCancel={() => setShowNewGroup(false)}
        onCreate={async (name, members) => {
          setCreatingGroup(true);
          const conversationId = await createGroupConversation(name, members);
          setCreatingGroup(false);
          if (conversationId) {
            setShowNewGroup(false);
            setShowNewChat(false);
            setNewChatSearch('');
          }
        }}
      />
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
            <button
              onClick={() => setShowNewGroup(true)}
              className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/20 text-primary">
                  <Users className="h-3.5 w-3.5" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">Novo grupo</div>
                <div className="text-[10px] text-muted-foreground truncate">Conversa com várias pessoas</div>
              </div>
            </button>
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
            <p>Nenhuma conversa ainda.<br/>Clique em <b>"Geral"</b> para o chat da equipe ou <b>"Nova"</b> para conversa direta — é lá também que se cria um <b>grupo</b>.</p>
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
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                          grupo{conv.memberCount ? ` · ${conv.memberCount}` : ''}
                        </Badge>
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

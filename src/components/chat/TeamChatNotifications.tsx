import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle } from 'lucide-react';
import { TeamNotificationToast } from './TeamNotificationToast';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';
import {
  getActiveTeamChatConversation,
  subscribeActiveTeamChatConversation,
} from '@/lib/teamChatActiveConversation';

const MUTE_KEY = 'team-chat-notifications-muted';
const MUTE_UNTIL_KEY = 'team-chat-notifications-muted-until';

function isMuted() {
  // Check timed mute first
  const mutedUntil = localStorage.getItem(MUTE_UNTIL_KEY);
  if (mutedUntil) {
    if (Date.now() < Number(mutedUntil)) return true;
    // Expired – clean up
    localStorage.removeItem(MUTE_UNTIL_KEY);
    localStorage.removeItem(MUTE_KEY);
    return false;
  }
  return localStorage.getItem(MUTE_KEY) === 'true';
}

function muteForMinutes(minutes: number | null) {
  if (minutes === null) {
    // Indefinite mute
    localStorage.setItem(MUTE_KEY, 'true');
    localStorage.removeItem(MUTE_UNTIL_KEY);
    toast.info('Notificações silenciadas até você reativar');
  } else {
    const until = Date.now() + minutes * 60 * 1000;
    localStorage.setItem(MUTE_UNTIL_KEY, String(until));
    localStorage.setItem(MUTE_KEY, 'true');
    const label = minutes >= 60 ? `${minutes / 60} hora${minutes > 60 ? 's' : ''}` : `${minutes} minutos`;
    toast.info(`Notificações silenciadas por ${label}`);
  }
}

function buildPreview(message: { content?: string | null; message_type?: string | null; file_name?: string | null }) {
  const content = message.content?.trim();
  if (content) return content;

  switch (message.message_type) {
    case 'audio':
      return '🎤 Áudio';
    case 'image':
      return '📷 Imagem';
    case 'file':
      return message.file_name ? `📎 ${message.file_name}` : '📎 Arquivo';
    default:
      return 'Nova mensagem';
  }
}

const NORMAL_TOAST_DURATION_MS = 15000;

// Um popup por conversa (estilo WhatsApp): mensagens novas da mesma pessoa/grupo
// atualizam o popup existente e incrementam o contador, em vez de empilhar.
const conversationToastState = new Map<string, { count: number; urgent: boolean }>();

function conversationToastId(conversationId: string) {
  return `team-chat-conv-${conversationId}`;
}

function clearConversationToastState(conversationId: string) {
  conversationToastState.delete(conversationId);
}

function dismissConversationToast(conversationId: string) {
  clearConversationToastState(conversationId);
  toast.dismiss(conversationToastId(conversationId));
}

function playUrgentSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [0, 0.25, 0.5].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Navegador pode bloquear áudio antes de interação do usuário
  }
}

function showNotificationToast({
  id,
  icon,
  title,
  context,
  preview,
  count,
  urgent,
  onOpen,
  onReply,
  onClosed,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  count?: number;
  urgent?: boolean;
  onOpen: () => void | Promise<void>;
  onReply?: (reply: string) => Promise<void>;
  onClosed?: () => void;
}) {
  toast.custom((toastId) => (
    <TeamNotificationToast
      toastId={toastId}
      icon={icon}
      title={title}
      context={context}
      preview={preview}
      count={count}
      urgent={urgent}
      onOpen={onOpen}
      onReply={onReply}
      onMuteForMinutes={muteForMinutes}
    />
  ), {
    ...(id ? { id } : {}),
    duration: urgent ? Infinity : NORMAL_TOAST_DURATION_MS,
    position: 'top-center',
    onDismiss: onClosed,
    onAutoClose: onClosed,
  });
}

function showConversationToast({
  conversationId,
  icon,
  title,
  context,
  preview,
  urgent,
  increment,
  onOpen,
  onReply,
}: {
  conversationId: string;
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  urgent?: boolean;
  increment: boolean;
  onOpen: () => void | Promise<void>;
  onReply?: (reply: string) => Promise<void>;
}) {
  const state = conversationToastState.get(conversationId) || { count: 0, urgent: false };
  if (increment || state.count === 0) state.count += 1;
  state.urgent = state.urgent || !!urgent;
  conversationToastState.set(conversationId, state);

  showNotificationToast({
    id: conversationToastId(conversationId),
    icon,
    title,
    context,
    preview,
    count: state.count,
    urgent: state.urgent,
    onOpen: () => {
      clearConversationToastState(conversationId);
      return onOpen();
    },
    onReply: onReply
      ? async (reply) => {
          await onReply(reply);
          clearConversationToastState(conversationId);
        }
      : undefined,
    onClosed: () => clearConversationToastState(conversationId),
  });

  if (urgent) playUrgentSound();
}

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const teamConversationIdsRef = useRef<Set<string>>(new Set());
  const teamConversationLabelsRef = useRef<Map<string, string>>(new Map());
  const currentUserNameRef = useRef('');

  useEffect(() => {
    if (!user) return;

    console.log('[TeamChatNotifications] Subscribing for user:', user.id);

    void ensureExternalSession();

    const loadCurrentUserName = async () => {
      // profiles continua no Cloud
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      currentUserNameRef.current = data?.full_name || user.email || 'Usuário';
    };

    const loadTeamConversationContext = async () => {
      const { data: memberships, error: membershipsError } = await externalSupabase
        .from('team_conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (membershipsError) {
        console.error('[TeamChatNotifications] Failed to load team memberships:', membershipsError);
        return;
      }

      const conversationIds = memberships?.map((membership) => membership.conversation_id) || [];
      teamConversationIdsRef.current = new Set(conversationIds);

      if (conversationIds.length === 0) {
        teamConversationLabelsRef.current = new Map();
        return;
      }

      const { data: conversations, error: conversationsError } = await externalSupabase
        .from('team_conversations')
        .select('id, type, name')
        .in('id', conversationIds);

      if (conversationsError) {
        console.error('[TeamChatNotifications] Failed to load team conversations:', conversationsError);
        return;
      }

      teamConversationLabelsRef.current = new Map(
        (conversations || []).map((conversation) => [
          conversation.id,
          getConversationLabel(conversation.type, conversation.name),
        ])
      );
    };

    const resolveConversationLabel = async (conversationId: string) => {
      const cached = teamConversationLabelsRef.current.get(conversationId);
      if (cached) return cached;

      const { data } = await externalSupabase
        .from('team_conversations')
        .select('type, name')
        .eq('id', conversationId)
        .maybeSingle();

      const label = getConversationLabel(data?.type, data?.name ?? null);
      teamConversationLabelsRef.current.set(conversationId, label);
      return label;
    };

    const isUserConversationMember = async (conversationId: string) => {
      if (teamConversationIdsRef.current.has(conversationId)) return true;

      const { data } = await externalSupabase
        .from('team_conversation_members')
        .select('conversation_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data?.conversation_id) {
        teamConversationIdsRef.current.add(conversationId);
        return true;
      }

      return false;
    };

    const getCurrentUserName = () => currentUserNameRef.current || user.email || 'Usuário';

    const replyToEntityChat = async ({
      entityType,
      entityId,
      entityName,
      content,
    }: {
      entityType: string;
      entityId: string;
      entityName?: string | null;
      content: string;
    }) => {
      const { error } = await externalSupabase
        .from('team_chat_messages')
        .insert({
          entity_type: entityType,
          entity_id: entityId,
          entity_name: entityName || null,
          content,
          sender_id: user.id,
          sender_name: getCurrentUserName(),
        });

      if (error) throw error;
    };

    const replyToConversation = async (conversationId: string, content: string) => {
      const { error } = await externalSupabase
        .from('team_messages')
        .insert({
          conversation_id: conversationId,
          content,
          sender_id: user.id,
          sender_name: getCurrentUserName(),
          message_type: 'text',
        });

      if (error) throw error;

      const { error: updateError } = await externalSupabase
        .from('team_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      if (updateError) throw updateError;
    };

    const getEntityChatUrl = async ({
      entityType,
      entityId,
      messageId,
    }: {
      entityType: string;
      entityId: string;
      messageId?: string;
    }) => {
      const messageParam = messageId ? `&highlightMsg=${messageId}` : '';

      switch (entityType) {
        case 'lead': {
          let boardParam = '';
          const { data } = await supabase
            .from('leads')
            .select('board_id')
            .eq('id', entityId)
            .maybeSingle();

          if (data?.board_id) {
            boardParam = `board=${data.board_id}&`;
          }

          return `/leads?${boardParam}openLead=${entityId}${messageParam}`;
        }
        case 'activity':
          return `/?openActivity=${entityId}${messageParam}`;
        case 'contact':
          return `/leads?openContact=${entityId}${messageParam}`;
        case 'workflow':
          return `/workflow?openBoard=${entityId}${messageParam}`;
        case 'whatsapp':
          return `/whatsapp?openChat=${encodeURIComponent(entityId)}`;
        default:
          return null;
      }
    };

    const openEntityChat = async (options: { entityType: string; entityId: string; messageId?: string }) => {
      const url = await getEntityChatUrl(options);
      if (!url) return;
      window.location.assign(url);
    };

    void Promise.all([loadTeamConversationContext(), loadCurrentUserName()]);

    // Listen for new mentions directed at this user
    const mentionsChannel = externalSupabase
      .channel('notification-mentions-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_mentions',
        filter: `mentioned_user_id=eq.${user.id}`,
      }, async (payload) => {
        console.log('[TeamChatNotifications] Mention received:', payload);
        if (isMuted()) return;
        const mention = payload.new as any;

        // Branch 1: mention inside a team conversation (general/direct chat)
        if (mention.conversation_id) {
          const { data: tmsg } = await externalSupabase
            .from('team_messages')
            .select('content, sender_name, sender_id, message_type, file_name, is_urgent')
            .eq('id', mention.message_id)
            .maybeSingle();

          if (!tmsg) return;
          if ((tmsg as any).sender_id === user.id) return; // nunca notificar mensagem própria
          if (
            getActiveTeamChatConversation() === mention.conversation_id &&
            document.visibilityState === 'visible'
          ) return; // conversa já aberta na tela

          const senderName = tmsg.sender_name || 'Alguém';
          const context = await resolveConversationLabel(mention.conversation_id);
          const preview = buildPreview(tmsg as any).substring(0, 120);

          showConversationToast({
            conversationId: mention.conversation_id,
            icon: <AtSign className="h-4 w-4 text-primary shrink-0" />,
            title: `${senderName} te mencionou`,
            context,
            preview,
            urgent: Boolean((tmsg as any).is_urgent),
            increment: false, // o canal de team_messages já conta essa mensagem
            onOpen: () => {
              openTeamChatConversation({
                conversationId: mention.conversation_id,
                focusComposer: true,
              });
            },
            onReply: (reply) => replyToConversation(mention.conversation_id, reply),
          });
          return;
        }

        // Branch 2: legacy entity-bound mention (lead/activity/etc)
        const { data: msg } = await externalSupabase
          .from('team_chat_messages')
          .select('content, sender_name, sender_id, entity_name, entity_type')
          .eq('id', mention.message_id)
          .single();

        if (!msg) return;
        if ((msg as any).sender_id === user.id) return; // nunca notificar mensagem própria

        const senderName = msg.sender_name || 'Alguém';
        const context = msg.entity_name || msg.entity_type || '';
        const preview = buildPreview(msg).substring(0, 120);

        showNotificationToast({
          id: `team-entity-${mention.entity_type}-${mention.entity_id}`,
          icon: <AtSign className="h-4 w-4 text-primary shrink-0" />,
          title: `${senderName} te mencionou`,
          context: context ? `em ${context}` : undefined,
          preview,
          onOpen: () => openEntityChat({
            entityType: msg.entity_type,
            entityId: mention.entity_id,
            messageId: mention.message_id,
          }),
          onReply: (reply) => replyToEntityChat({
            entityType: mention.entity_type,
            entityId: mention.entity_id,
            entityName: mention.entity_name,
            content: reply,
          }),
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Mentions channel status:', status);
      });

    // Contextual team chat messages channel REMOVED — was broadcasting to ALL users.
    // Mentions are already handled by mentionsChannel above.

    // Listen for team direct/group chat messages used by the Chat da Equipe panel
    const teamMessagesChannel = externalSupabase
      .channel('notification-team-messages-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages',
      }, async (payload) => {
        console.log('[TeamChatNotifications] Team message received:', payload);
        if (isMuted()) return;

        const msg = payload.new as any;
        if (msg.sender_id === user.id) return; // mensagem própria nunca gera popup
        if (
          getActiveTeamChatConversation() === msg.conversation_id &&
          document.visibilityState === 'visible'
        ) return; // conversa já aberta na tela
        if (!(await isUserConversationMember(msg.conversation_id))) return;

        const senderName = msg.sender_name || 'Alguém';
        const context = await resolveConversationLabel(msg.conversation_id);
        const preview = buildPreview(msg).substring(0, 120);

        showConversationToast({
          conversationId: msg.conversation_id,
          icon: <MessageCircle className="h-4 w-4 text-primary shrink-0" />,
          title: senderName,
          context,
          preview,
          urgent: Boolean(msg.is_urgent),
          increment: true,
          onOpen: () => {
            openTeamChatConversation({
              conversationId: msg.conversation_id,
              focusComposer: true,
            });
          },
          onReply: (reply) => replyToConversation(msg.conversation_id, reply),
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Team messages channel status:', status);
      });

    const teamMembershipsChannel = externalSupabase
      .channel('notification-team-memberships-' + user.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        console.log('[TeamChatNotifications] Team memberships changed');
        void loadTeamConversationContext();
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Team memberships channel status:', status);
      });

    // Ao abrir uma conversa no painel, dispensa o popup dela
    const unsubscribeActiveConversation = subscribeActiveTeamChatConversation((conversationId) => {
      if (conversationId) dismissConversationToast(conversationId);
    });

    return () => {
      externalSupabase.removeChannel(mentionsChannel);
      externalSupabase.removeChannel(teamMessagesChannel);
      externalSupabase.removeChannel(teamMembershipsChannel);
      unsubscribeActiveConversation();
    };
  }, [user]);

  return null;
}

function getEntityLabel(type: string): string {
  switch (type) {
    case 'lead': return 'Lead';
    case 'activity': return 'Atividade';
    case 'whatsapp': return 'WhatsApp';
    case 'direct': return 'Mensagem direta';
    case 'general': return 'Chat Geral';
    default: return type || '';
  }
}

function getConversationLabel(type?: string | null, name?: string | null): string {
  if (type === 'group') return name || 'Chat da Equipe';
  return 'Mensagem direta';
}

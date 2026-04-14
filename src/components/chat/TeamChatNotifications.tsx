import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle } from 'lucide-react';
import { TeamNotificationToast } from './TeamNotificationToast';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';

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

function showNotificationToast({
  icon,
  title,
  context,
  preview,
  onOpen,
  onReply,
}: {
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  onOpen: () => void | Promise<void>;
  onReply?: (reply: string) => Promise<void>;
}) {
  toast.custom((toastId) => (
    <TeamNotificationToast
      toastId={toastId}
      icon={icon}
      title={title}
      context={context}
      preview={preview}
      onOpen={onOpen}
      onReply={onReply}
      onMuteForMinutes={muteForMinutes}
    />
  ), {
    duration: Infinity,
    position: 'top-center',
  });
}

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const teamConversationIdsRef = useRef<Set<string>>(new Set());
  const teamConversationLabelsRef = useRef<Map<string, string>>(new Map());
  const currentUserNameRef = useRef('');

  useEffect(() => {
    if (!user) return;

    console.log('[TeamChatNotifications] Subscribing for user:', user.id);

    const loadCurrentUserName = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      currentUserNameRef.current = data?.full_name || user.email || 'Usuário';
    };

    const loadTeamConversationContext = async () => {
      const { data: memberships, error: membershipsError } = await supabase
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

      const { data: conversations, error: conversationsError } = await supabase
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

      const { data } = await supabase
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

      const { data } = await supabase
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
      const { error } = await supabase
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
      const { error } = await supabase
        .from('team_messages')
        .insert({
          conversation_id: conversationId,
          content,
          sender_id: user.id,
          sender_name: getCurrentUserName(),
          message_type: 'text',
        });

      if (error) throw error;

      const { error: updateError } = await supabase
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
    const mentionsChannel = supabase
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

        const { data: msg } = await supabase
          .from('team_chat_messages')
          .select('content, sender_name, entity_name, entity_type')
          .eq('id', mention.message_id)
          .single();

        if (!msg) return;

        const senderName = msg.sender_name || 'Alguém';
        const context = msg.entity_name || msg.entity_type || '';
        const preview = buildPreview(msg).substring(0, 120);

        showNotificationToast({
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
    const teamMessagesChannel = supabase
      .channel('notification-team-messages-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages',
      }, async (payload) => {
        console.log('[TeamChatNotifications] Team message received:', payload);
        if (isMuted()) return;

        const msg = payload.new as any;
        if (msg.sender_id === user.id) return;
        if (!(await isUserConversationMember(msg.conversation_id))) return;

        const senderName = msg.sender_name || 'Alguém';
        const context = await resolveConversationLabel(msg.conversation_id);
        const preview = buildPreview(msg).substring(0, 120);

        showNotificationToast({
          icon: <MessageCircle className="h-4 w-4 text-primary shrink-0" />,
          title: senderName,
          context,
          preview,
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

    const teamMembershipsChannel = supabase
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

    return () => {
      supabase.removeChannel(mentionsChannel);
      supabase.removeChannel(teamMessagesChannel);
      supabase.removeChannel(teamMembershipsChannel);
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

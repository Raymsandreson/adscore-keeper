import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle } from 'lucide-react';

const MUTE_KEY = 'team-chat-notifications-muted';

function isMuted() {
  return localStorage.getItem(MUTE_KEY) === 'true';
}

function toggleMute() {
  const next = !isMuted();
  localStorage.setItem(MUTE_KEY, String(next));
  toast.info(next ? 'Notificações silenciadas' : 'Notificações ativadas');
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
  duration,
}: {
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  duration: number;
}) {
  toast(title, {
    icon,
    duration,
    description: (
      <div className="flex flex-col gap-1">
        {context && (
          <span className="text-xs text-muted-foreground">{context}</span>
        )}
        <p className="text-sm text-foreground/80 line-clamp-2">{preview}</p>
      </div>
    ),
    action: {
      label: 'Silenciar',
      onClick: toggleMute,
    },
  });
}

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const teamConversationIdsRef = useRef<Set<string>>(new Set());
  const teamConversationLabelsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user) return;

    console.log('[TeamChatNotifications] Subscribing for user:', user.id);

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

    void loadTeamConversationContext();

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
          duration: 8000,
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Mentions channel status:', status);
      });

    // Listen for contextual team chat messages
    const chatChannel = supabase
      .channel('notification-chat-messages-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
      }, (payload) => {
        console.log('[TeamChatNotifications] Message received:', payload);
        if (isMuted()) return;
        const msg = payload.new as any;
        // Don't notify for own messages
        if (msg.sender_id === user.id) return;

        const senderName = msg.sender_name || 'Alguém';
        const preview = buildPreview(msg).substring(0, 120);
        const context = msg.entity_name || '';
        const entityLabel = getEntityLabel(msg.entity_type);

        showNotificationToast({
          icon: <MessageCircle className="h-4 w-4 text-primary shrink-0" />,
          title: senderName,
          context: (context || entityLabel) ? `${entityLabel}${context ? `: ${context}` : ''}` : undefined,
          preview,
          duration: 6000,
        });
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Chat channel status:', status);
      });

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
          duration: 6000,
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
      supabase.removeChannel(chatChannel);
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

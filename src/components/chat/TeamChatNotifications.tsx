import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MUTE_KEY = 'team-chat-notifications-muted';

function isMuted() {
  return localStorage.getItem(MUTE_KEY) === 'true';
}

function toggleMute() {
  const next = !isMuted();
  localStorage.setItem(MUTE_KEY, String(next));
  toast.info(next ? 'Notificações silenciadas' : 'Notificações ativadas');
}

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!user) return;

    console.log('[TeamChatNotifications] Subscribing for user:', user.id);

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
        const preview = (msg.content || '').substring(0, 120);

        toast(
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <AtSign className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold text-sm">{senderName} te mencionou</span>
            </div>
            {context && (
              <span className="text-xs text-muted-foreground">em {context}</span>
            )}
            <p className="text-sm text-foreground/80 line-clamp-2">{preview}</p>
            <Button
              variant="ghost"
              size="sm"
              className="self-end mt-1 h-6 text-xs text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            >
              <BellOff className="h-3 w-3 mr-1" />
              Silenciar
            </Button>
          </div>,
          { duration: 8000 }
        );
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Mentions channel status:', status);
      });

    // Listen for ALL new chat messages (any entity_type)
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
        const preview = (msg.content || '').substring(0, 120);
        const context = msg.entity_name || '';
        const entityLabel = getEntityLabel(msg.entity_type);

        toast(
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold text-sm">{senderName}</span>
            </div>
            {(context || entityLabel) && (
              <span className="text-xs text-muted-foreground">
                {entityLabel}{context ? `: ${context}` : ''}
              </span>
            )}
            <p className="text-sm text-foreground/80 line-clamp-2">{preview}</p>
            <Button
              variant="ghost"
              size="sm"
              className="self-end mt-1 h-6 text-xs text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            >
              <BellOff className="h-3 w-3 mr-1" />
              Silenciar
            </Button>
          </div>,
          { duration: 6000 }
        );
      })
      .subscribe((status) => {
        console.log('[TeamChatNotifications] Chat channel status:', status);
      });

    return () => {
      supabase.removeChannel(mentionsChannel);
      supabase.removeChannel(chatChannel);
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

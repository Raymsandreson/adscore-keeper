import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AtSign, MessageCircle, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MUTE_KEY = 'team-chat-notifications-muted';

export function TeamChatNotifications() {
  const { user } = useAuthContext();
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === 'true');

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      localStorage.setItem(MUTE_KEY, String(next));
      toast.info(next ? 'Notificações silenciadas' : 'Notificações ativadas');
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen for new mentions
    const mentionsChannel = supabase
      .channel('notification-mentions')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_mentions',
        filter: `mentioned_user_id=eq.${user.id}`,
      }, async (payload) => {
        if (muted) return;
        const mention = payload.new as any;

        // Fetch the message content
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
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
            >
              <BellOff className="h-3 w-3 mr-1" />
              Silenciar
            </Button>
          </div>,
          { duration: 8000 }
        );
      })
      .subscribe();

    // Listen for new direct chat messages (team_chat_messages where entity_type = 'direct')
    const chatChannel = supabase
      .channel('notification-direct-chat')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
      }, (payload) => {
        if (muted) return;
        const msg = payload.new as any;
        // Don't notify for own messages
        if (msg.sender_id === user.id) return;
        // Only notify for direct messages or general chat
        if (msg.entity_type !== 'direct' && msg.entity_type !== 'general') return;

        const senderName = msg.sender_name || 'Alguém';
        const preview = (msg.content || '').substring(0, 120);
        const isGeneral = msg.entity_type === 'general';

        toast(
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold text-sm">
                {senderName}
                {isGeneral ? ' (Geral)' : ''}
              </span>
            </div>
            <p className="text-sm text-foreground/80 line-clamp-2">{preview}</p>
            <Button
              variant="ghost"
              size="sm"
              className="self-end mt-1 h-6 text-xs text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
            >
              <BellOff className="h-3 w-3 mr-1" />
              Silenciar
            </Button>
          </div>,
          { duration: 6000 }
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(mentionsChannel);
      supabase.removeChannel(chatChannel);
    };
  }, [user, muted, toggleMute]);

  return null;
}

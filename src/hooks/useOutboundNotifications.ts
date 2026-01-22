import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface OutboundReply {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  created_at: string;
  post_url: string | null;
}

export function useOutboundNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isEnabled, setIsEnabled] = useState(() => {
    return localStorage.getItem('outbound-notifications-enabled') === 'true';
  });
  const lastCheckRef = useRef<string | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  // Check if browser supports notifications
  const isSupported = 'Notification' in window;

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast.error('Seu navegador não suporta notificações push');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      
      if (result === 'granted') {
        setIsEnabled(true);
        localStorage.setItem('outbound-notifications-enabled', 'true');
        toast.success('Notificações ativadas!');
        return true;
      } else if (result === 'denied') {
        toast.error('Permissão de notificação negada');
        return false;
      }
      return false;
    } catch (error) {
      console.error('Erro ao pedir permissão:', error);
      toast.error('Erro ao ativar notificações');
      return false;
    }
  }, [isSupported]);

  // Toggle notifications
  const toggleNotifications = useCallback(async () => {
    if (!isEnabled) {
      const granted = await requestPermission();
      return granted;
    } else {
      setIsEnabled(false);
      localStorage.setItem('outbound-notifications-enabled', 'false');
      toast.info('Notificações desativadas');
      return false;
    }
  }, [isEnabled, requestPermission]);

  // Show notification
  const showNotification = useCallback((reply: OutboundReply) => {
    if (!isSupported || permission !== 'granted' || !isEnabled) return;
    
    // Avoid duplicate notifications
    if (notifiedIdsRef.current.has(reply.id)) return;
    notifiedIdsRef.current.add(reply.id);

    const title = `🔔 Resposta Outbound!`;
    const body = reply.author_username 
      ? `@${reply.author_username} respondeu: ${reply.comment_text?.slice(0, 100) || 'Novo comentário'}`
      : reply.comment_text?.slice(0, 100) || 'Novo comentário em seu post';
    
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `outbound-${reply.id}`,
      requireInteraction: true,
      data: { url: reply.post_url }
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      // Navigate to prospecting funnel
      window.location.href = '/?tab=automation&subtab=funnel';
    };

    // Also show in-app toast
    toast.success(`Nova resposta outbound de @${reply.author_username || 'prospect'}`, {
      action: {
        label: 'Ver',
        onClick: () => {
          window.location.href = '/?tab=automation&subtab=funnel';
        }
      }
    });
  }, [isSupported, permission, isEnabled]);

  // Check for new outbound replies
  const checkForNewReplies = useCallback(async () => {
    if (!isEnabled || permission !== 'granted') return;

    try {
      const query = supabase
        .from('instagram_comments')
        .select('id, author_username, comment_text, created_at, post_url, metadata')
        .eq('comment_type', 'reply_to_outbound')
        .order('created_at', { ascending: false })
        .limit(10);

      // Only fetch new ones since last check
      if (lastCheckRef.current) {
        query.gt('created_at', lastCheckRef.current);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao verificar respostas:', error);
        return;
      }

      if (data && data.length > 0) {
        // Update last check timestamp
        lastCheckRef.current = data[0].created_at;

        // Show notifications for new replies
        data.forEach(reply => {
          const metadata = reply.metadata as { is_prospect_reply?: boolean } | null;
          if (metadata?.is_prospect_reply) {
            showNotification(reply);
          }
        });
      }
    } catch (error) {
      console.error('Erro ao verificar notificações:', error);
    }
  }, [isEnabled, permission, showNotification]);

  // Set up realtime subscription for new outbound replies
  useEffect(() => {
    if (!isEnabled || permission !== 'granted') return;

    // Initial check
    checkForNewReplies();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('outbound-replies-notifications')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'instagram_comments',
          filter: 'comment_type=eq.reply_to_outbound'
        },
        (payload) => {
          const reply = payload.new as OutboundReply & { metadata?: { is_prospect_reply?: boolean } };
          if (reply.metadata?.is_prospect_reply) {
            showNotification(reply);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isEnabled, permission, checkForNewReplies, showNotification]);

  // Check permission on mount
  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission);
    }
  }, [isSupported]);

  return {
    isSupported,
    permission,
    isEnabled,
    requestPermission,
    toggleNotifications,
    checkForNewReplies
  };
}

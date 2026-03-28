import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface TeamMessage {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  content: string;
  sender_id: string;
  sender_name: string | null;
  reply_to_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface TeamMention {
  id: string;
  message_id: string;
  mentioned_user_id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  message?: TeamMessage;
}

export interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name, email').then(({ data }) => {
      if (data) setMembers(data);
    });
  }, []);

  return members;
}

export function useTeamChat(entityType: string, entityId: string, entityName?: string) {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('team_chat_messages')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200);
    if (data) setMessages(data as TeamMessage[]);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel(`team-chat-${entityType}-${entityId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
        filter: `entity_type=eq.${entityType}`,
      }, (payload) => {
        const newMsg = payload.new as TeamMessage;
        if (newMsg.entity_id === entityId) {
          setMessages(prev => [...prev, newMsg]);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [entityType, entityId, loadMessages]);

  const sendMessage = useCallback(async (content: string, mentionedUserIds: string[]) => {
    if (!user) return;

    const profileRes = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single();

    const senderName = profileRes.data?.full_name || user.email || 'Usuário';

    const { data: msg, error } = await supabase
      .from('team_chat_messages')
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName || null,
        content,
        sender_id: user.id,
        sender_name: senderName,
      })
      .select()
      .single();

    if (error) {
      toast.error('Erro ao enviar mensagem');
      return;
    }

    // Create mentions
    if (msg && mentionedUserIds.length > 0) {
      const mentions = mentionedUserIds.map(uid => ({
        message_id: msg.id,
        mentioned_user_id: uid,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName || null,
      }));

      await supabase.from('team_chat_mentions').insert(mentions);

      // Send WhatsApp notification to mentioned users (using sender's instance)
      supabase.functions.invoke('notify-team-mention', {
        body: {
          mentioned_user_ids: mentionedUserIds,
          message_content: content,
          sender_id: user.id,
          sender_name: senderName,
          entity_type: entityType,
          entity_id: entityId,
          entity_name: entityName || null,
        },
      }).catch(err => console.error('Failed to notify mentions via WhatsApp:', err));
    }
  }, [user, entityType, entityId, entityName]);

  return { messages, loading, sendMessage };
}

export function useUnreadMentionsCount() {
  const { user } = useAuthContext();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const { count: c } = await supabase
        .from('team_chat_mentions')
        .select('*', { count: 'exact', head: true })
        .eq('mentioned_user_id', user.id)
        .eq('is_read', false);
      setCount(c || 0);
    };

    load();

    const channel = supabase
      .channel('mentions-count')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_chat_mentions',
      }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return count;
}

export function useMyMentions() {
  const { user } = useAuthContext();
  const [mentions, setMentions] = useState<(TeamMention & { message: TeamMessage })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: mentionData } = await supabase
      .from('team_chat_mentions')
      .select('*')
      .eq('mentioned_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!mentionData || mentionData.length === 0) {
      setMentions([]);
      setLoading(false);
      return;
    }

    const msgIds = mentionData.map(m => m.message_id);
    const { data: msgData } = await supabase
      .from('team_chat_messages')
      .select('*')
      .in('id', msgIds);

    const msgMap = new Map((msgData || []).map(m => [m.id, m as TeamMessage]));

    const result = mentionData
      .map(m => ({
        ...(m as TeamMention),
        message: msgMap.get(m.message_id)!,
      }))
      .filter(m => m.message);

    setMentions(result);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: listen for new mentions or updates
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`mentions-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_chat_mentions',
          filter: `mentioned_user_id=eq.${user.id}`,
        },
        () => {
          load();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const markAsRead = useCallback(async (mentionId: string) => {
    await supabase
      .from('team_chat_mentions')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', mentionId);
    setMentions(prev => prev.map(m => m.id === mentionId ? { ...m, is_read: true } : m));
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    await supabase
      .from('team_chat_mentions')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('mentioned_user_id', user.id)
      .eq('is_read', false);
    setMentions(prev => prev.map(m => ({ ...m, is_read: true })));
  }, [user]);

  return { mentions, loading, markAsRead, markAllAsRead, reload: load };
}

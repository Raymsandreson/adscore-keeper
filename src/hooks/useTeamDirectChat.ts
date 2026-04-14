import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface TeamConversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_at: string;
  updated_at: string;
  otherMemberName?: string;
  otherMemberId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

export interface TeamMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  content: string | null;
  message_type: string;
  created_at: string;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  audio_duration?: number | null;
}

const GENERAL_CHAT_NAME = '💬 Chat Geral da Equipe';

export function useTeamDirectChat() {
  const { user } = useAuthContext();
  const [conversations, setConversations] = useState<TeamConversation[]>([]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [otherMembersReadAt, setOtherMembersReadAt] = useState<string[]>([]);

  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from('team_conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id);

      if (membershipsError) {
        console.error('Error fetching memberships:', membershipsError);
        setConversations([]);
        return;
      }

      if (!memberships?.length) {
        setConversations([]);
        return;
      }

      const convIds = memberships.map((m) => m.conversation_id);
      const lastReadMap: Record<string, string> = {};
      memberships.forEach((m) => {
        lastReadMap[m.conversation_id] = m.last_read_at || '';
      });

      const { data: convs, error: conversationsError } = await supabase
        .from('team_conversations')
        .select('*')
        .in('id', convIds)
        .order('updated_at', { ascending: false });

      if (conversationsError || !convs) {
        console.error('Error fetching conversations:', conversationsError);
        setConversations([]);
        return;
      }

      const { data: allMembers, error: membersError } = await supabase
        .from('team_conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', convIds);

      if (membersError) {
        console.error('Error fetching conversation members:', membersError);
      }

      const memberUserIds = [...new Set((allMembers || []).map((m) => m.user_id))];
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', memberUserIds);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
      }

      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p) => {
        profileMap[p.user_id] = p.full_name || 'Sem nome';
      });

      const enriched: TeamConversation[] = await Promise.all(
        convs.map(async (conv) => {
          const { data: lastMsg } = await supabase
            .from('team_messages')
            .select('content, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const lastRead = lastReadMap[conv.id] || '1970-01-01';
          const { count } = await supabase
            .from('team_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', user.id)
            .gt('created_at', lastRead);

          let otherMemberName: string | undefined;
          let otherMemberId: string | undefined;

          if (conv.type === 'direct') {
            const other = (allMembers || []).find(
              (m) => m.conversation_id === conv.id && m.user_id !== user.id
            );

            if (other) {
              otherMemberId = other.user_id;
              otherMemberName = profileMap[other.user_id] || 'Membro';
            }
          }

          return {
            ...conv,
            otherMemberName,
            otherMemberId,
            lastMessage: lastMsg?.content || '',
            lastMessageAt: lastMsg?.created_at || conv.created_at,
            unreadCount: count || 0,
          } as TeamConversation;
        })
      );

      setConversations(enriched);
    } catch (e) {
      console.error('Error fetching team conversations:', e);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const fetchMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from('team_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Error fetching messages:', error);
      setMessages([]);
      return;
    }

    setMessages((data as TeamMessage[]) || []);

    if (user?.id) {
      await supabase
        .from('team_conversation_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      // Fetch other members' last_read_at
      const { data: members } = await supabase
        .from('team_conversation_members')
        .select('last_read_at')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id);

      setOtherMembersReadAt(
        (members || []).map(m => m.last_read_at).filter(Boolean) as string[]
      );
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    }
  }, [activeConversationId, fetchMessages]);

  useEffect(() => {
    if (!activeConversationId) return;

    const channel = supabase
      .channel(`team-chat-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as TeamMessage;
          setMessages((prev) => [...prev, newMsg]);

          if (user?.id && newMsg.sender_id !== user.id) {
            supabase
              .from('team_conversation_members')
              .update({ last_read_at: new Date().toISOString() })
              .eq('conversation_id', activeConversationId)
              .eq('user_id', user.id)
              .then(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'team_conversation_members',
        },
        (payload) => {
          const updated = payload.new as { user_id: string; last_read_at: string | null; conversation_id: string };
          if (updated.conversation_id === activeConversationId && updated.user_id !== user?.id && updated.last_read_at) {
            setOtherMembersReadAt(prev => {
              const next = [...prev, updated.last_read_at!];
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversationId, user?.id]);

  const sendMessage = useCallback(async (
    content: string,
    options?: {
      message_type?: string;
      file_url?: string;
      file_name?: string;
      file_size?: number;
      file_type?: string;
      audio_duration?: number;
    }
  ) => {
    if (!activeConversationId || !user?.id) return;
    if (!content.trim() && !options?.file_url) return;

    setSendingMessage(true);

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      const { error } = await supabase.from('team_messages').insert({
        conversation_id: activeConversationId,
        sender_id: user.id,
        sender_name: profile?.full_name || user.email || 'Anônimo',
        content: content.trim() || null,
        message_type: options?.message_type || 'text',
        file_url: options?.file_url || null,
        file_name: options?.file_name || null,
        file_size: options?.file_size || null,
        file_type: options?.file_type || null,
        audio_duration: options?.audio_duration || null,
      });

      if (error) {
        console.error('Error sending team message:', error);
        toast.error('Não foi possível enviar a mensagem.');
        return;
      }

      await supabase
        .from('team_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    } catch (e) {
      console.error('Error sending team message:', e);
      toast.error('Não foi possível enviar a mensagem.');
    } finally {
      setSendingMessage(false);
    }
  }, [activeConversationId, user?.id, user?.email]);

  const startDirectChat = useCallback(async (otherUserId: string) => {
    if (!user?.id) return null;

    const existing = conversations.find(
      (c) => c.type === 'direct' && c.otherMemberId === otherUserId
    );

    if (existing) {
      setActiveConversationId(existing.id);
      return existing.id;
    }

    try {
      const { data: conversationId, error } = await supabase.rpc('start_team_direct_conversation', {
        _other_user_id: otherUserId,
      });

      if (error || !conversationId) {
        console.error('Error starting direct chat:', error);
        toast.error('Não foi possível abrir a conversa.');
        return null;
      }

      await fetchConversations();
      setActiveConversationId(conversationId);
      return conversationId;
    } catch (e) {
      console.error('Error starting direct chat:', e);
      toast.error('Não foi possível abrir a conversa.');
      return null;
    }
  }, [user?.id, conversations, fetchConversations]);

  const ensureGeneralChat = useCallback(async () => {
    if (!user?.id) return null;

    try {
      const { data: conversationId, error } = await supabase.rpc('ensure_team_general_conversation');

      if (error || !conversationId) {
        console.error('Error opening general chat:', error);
        toast.error('Não foi possível abrir o chat geral.');
        return null;
      }

      await fetchConversations();
      setActiveConversationId(conversationId);
      return conversationId;
    } catch (e) {
      console.error('Error opening general chat:', e);
      toast.error('Não foi possível abrir o chat geral.');
      return null;
    }
  }, [user?.id, fetchConversations]);

  return {
    conversations,
    messages,
    activeConversationId,
    setActiveConversationId,
    loading,
    sendingMessage,
    sendMessage,
    startDirectChat,
    ensureGeneralChat,
    fetchConversations,
    fetchMessages,
    otherMembersReadAt,
  };
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface TeamConversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_at: string;
  updated_at: string;
  // Computed
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
}

const GENERAL_CHAT_NAME = '💬 Chat Geral da Equipe';

export function useTeamDirectChat() {
  const { user } = useAuthContext();
  const [conversations, setConversations] = useState<TeamConversation[]>([]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data: memberships } = await supabase
        .from('team_conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id);

      if (!memberships?.length) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const convIds = memberships.map(m => m.conversation_id);
      const lastReadMap: Record<string, string> = {};
      memberships.forEach(m => { lastReadMap[m.conversation_id] = m.last_read_at || ''; });

      const { data: convs } = await supabase
        .from('team_conversations')
        .select('*')
        .in('id', convIds)
        .order('updated_at', { ascending: false });

      if (!convs) { setConversations([]); setLoading(false); return; }

      // Get all members for these conversations
      const { data: allMembers } = await supabase
        .from('team_conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', convIds);

      // Get profiles
      const memberUserIds = [...new Set((allMembers || []).map(m => m.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', memberUserIds);
      const profileMap: Record<string, string> = {};
      (profiles || []).forEach(p => { profileMap[p.user_id] = p.full_name || 'Sem nome'; });

      // Get last message per conversation
      const enriched: TeamConversation[] = await Promise.all(convs.map(async (conv) => {
        const { data: lastMsg } = await supabase
          .from('team_messages')
          .select('content, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Count unread
        const lastRead = lastReadMap[conv.id] || '1970-01-01';
        const { count } = await supabase
          .from('team_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', user.id)
          .gt('created_at', lastRead);

        // Find other member name for direct chats
        let otherMemberName: string | undefined;
        let otherMemberId: string | undefined;
        if (conv.type === 'direct') {
          const other = (allMembers || []).find(m => m.conversation_id === conv.id && m.user_id !== user.id);
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
      }));

      setConversations(enriched);
    } catch (e) {
      console.error('Error fetching team conversations:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Fetch messages for active conversation
  const fetchMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from('team_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);
    setMessages((data as TeamMessage[]) || []);

    // Mark as read
    if (user?.id) {
      await supabase
        .from('team_conversation_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeConversationId) fetchMessages(activeConversationId);
  }, [activeConversationId, fetchMessages]);

  // Realtime subscription for messages
  useEffect(() => {
    if (!activeConversationId) return;
    const channel = supabase
      .channel(`team-chat-${activeConversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_messages',
        filter: `conversation_id=eq.${activeConversationId}`,
      }, (payload) => {
        const newMsg = payload.new as TeamMessage;
        setMessages(prev => [...prev, newMsg]);
        // Mark as read
        if (user?.id && newMsg.sender_id !== user.id) {
          supabase
            .from('team_conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', activeConversationId)
            .eq('user_id', user.id)
            .then(() => {});
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeConversationId, user?.id]);

  // Send message
  const sendMessage = useCallback(async (content: string) => {
    if (!activeConversationId || !user?.id || !content.trim()) return;
    setSendingMessage(true);
    try {
      // Get sender name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      await supabase.from('team_messages').insert({
        conversation_id: activeConversationId,
        sender_id: user.id,
        sender_name: profile?.full_name || user.email || 'Anônimo',
        content: content.trim(),
        message_type: 'text',
      });

      // Update conversation timestamp
      await supabase
        .from('team_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    } catch (e) {
      console.error('Error sending team message:', e);
    } finally {
      setSendingMessage(false);
    }
  }, [activeConversationId, user?.id, user?.email]);

  // Start or find direct conversation
  const startDirectChat = useCallback(async (otherUserId: string) => {
    if (!user?.id) return null;
    // Check if direct chat already exists
    const existing = conversations.find(
      c => c.type === 'direct' && c.otherMemberId === otherUserId
    );
    if (existing) {
      setActiveConversationId(existing.id);
      return existing.id;
    }

    // Create new direct conversation
    const { data: conv } = await supabase
      .from('team_conversations')
      .insert({ type: 'direct', created_by: user.id })
      .select()
      .single();

    if (!conv) return null;

    // Add both members
    await supabase.from('team_conversation_members').insert([
      { conversation_id: conv.id, user_id: user.id },
      { conversation_id: conv.id, user_id: otherUserId },
    ]);

    await fetchConversations();
    setActiveConversationId(conv.id);
    return conv.id;
  }, [user?.id, conversations, fetchConversations]);

  // Ensure general chat exists and join it
  const ensureGeneralChat = useCallback(async () => {
    if (!user?.id) return null;
    
    // Find existing general chat
    const { data: existing } = await supabase
      .from('team_conversations')
      .select('id')
      .eq('type', 'group')
      .eq('name', GENERAL_CHAT_NAME)
      .maybeSingle();

    let convId: string;
    if (existing) {
      convId = existing.id;
    } else {
      const { data: newConv } = await supabase
        .from('team_conversations')
        .insert({ type: 'group', name: GENERAL_CHAT_NAME, created_by: user.id })
        .select()
        .single();
      if (!newConv) return null;
      convId = newConv.id;
    }

    // Ensure membership
    await supabase
      .from('team_conversation_members')
      .upsert({ conversation_id: convId, user_id: user.id }, { onConflict: 'conversation_id,user_id' });

    await fetchConversations();
    setActiveConversationId(convId);
    return convId;
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
  };
}

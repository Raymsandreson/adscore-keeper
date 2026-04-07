import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
...
  // Start or find direct conversation
  const startDirectChat = useCallback(async (otherUserId: string) => {
    if (!user?.id) return null;

    const existing = conversations.find(
      c => c.type === 'direct' && c.otherMemberId === otherUserId
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

  // Ensure general chat exists and join it
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
  };
}

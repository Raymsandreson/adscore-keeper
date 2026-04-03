import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useToast } from '@/hooks/use-toast';
import type { ConversationDetail } from '../types';
import { convKey } from '../utils';

export function useBatchActions(conversations: ConversationDetail[], fetchData: () => void) {
  const { toast } = useToast();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);

  const toggleSelection = (c: ConversationDetail) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const k = convKey(c);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const selectAll = (list: ConversationDetail[]) => setSelectedKeys(new Set(list.map(convKey)));
  const clearSelection = () => setSelectedKeys(new Set());

  const selectedConversations = useMemo(
    () => conversations.filter(c => selectedKeys.has(convKey(c))),
    [conversations, selectedKeys]
  );

  const batchAction = async (action: 'deactivate') => {
    if (selectedConversations.length === 0) return;
    setBatchProcessing(true);
    try {
      const keys = selectedConversations.map(c => ({ phone: c.phone, instance: c.instance_name }));
      await Promise.all(
        keys.map(({ phone, instance }) =>
          supabase
            .from('whatsapp_conversation_agents')
            .update({ is_active: false, human_paused_until: null } as any)
            .eq('phone', phone)
            .eq('instance_name', instance)
        )
      );

      toast({ title: 'Sucesso', description: `${keys.length} conversa(s) desativada(s)` });
      clearSelection();
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setBatchProcessing(false);
    }
  };

  const batchFollowupAction = async (action: 'anticipate' | 'resume') => {
    if (selectedConversations.length === 0) return;
    setBatchProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let success = 0;
      let fail = 0;
      for (const c of selectedConversations) {
        try {
          const { error } = await cloudFunctions.invoke('wjia-followup-processor', {
            body: { target_phone: c.phone, target_instance: c.instance_name, force_immediate: true },
            authToken: session?.access_token,
          });
          if (error) throw error;
          success++;
          await new Promise(r => setTimeout(r, 1500));
        } catch {
          fail++;
        }
      }
      toast({
        title: action === 'resume' ? 'Follow-up retomado' : 'Follow-up antecipado',
        description: `${success} sucesso${fail > 0 ? `, ${fail} falha(s)` : ''}`,
      });
      clearSelection();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setBatchProcessing(false);
    }
  };

  return {
    selectedKeys, toggleSelection, selectAll, clearSelection, selectedConversations,
    batchProcessing,
    batchAction, batchFollowupAction,
  };
}

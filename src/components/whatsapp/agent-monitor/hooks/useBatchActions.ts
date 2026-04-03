import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useToast } from '@/hooks/use-toast';
import type { ConversationDetail, AgentData } from '../types';
import { convKey } from '../utils';

export function useBatchActions(conversations: ConversationDetail[], fetchData: () => void) {
  const { toast } = useToast();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchAgentId, setBatchAgentId] = useState('');
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

  const batchAction = async (action: 'pause' | 'assign' | 'swap', agentId?: string) => {
    if (selectedConversations.length === 0) return;
    setBatchProcessing(true);
    try {
      const keys = selectedConversations.map(c => ({ phone: c.phone, instance: c.instance_name }));
      for (const { phone, instance } of keys) {
        if (action === 'pause') {
          await supabase
            .from('whatsapp_conversation_agents')
            .update({ is_active: false } as any)
            .eq('phone', phone).eq('instance_name', instance);
        } else if (action === 'assign' && agentId) {
          const { data: existing } = await supabase
            .from('whatsapp_conversation_agents')
            .select('id').eq('phone', phone).eq('instance_name', instance).maybeSingle();
          if (existing) {
            await supabase
              .from('whatsapp_conversation_agents')
              .update({ agent_id: agentId, is_active: true, human_paused_until: null } as any)
              .eq('phone', phone).eq('instance_name', instance);
          } else {
            await supabase
              .from('whatsapp_conversation_agents')
              .insert({ phone, instance_name: instance, agent_id: agentId, is_active: true } as any);
          }
        } else if (action === 'swap' && agentId) {
          await supabase
            .from('whatsapp_conversation_agents')
            .update({ agent_id: agentId } as any)
            .eq('phone', phone).eq('instance_name', instance);
        }
      }
      toast({ title: 'Sucesso', description: `Ação aplicada em ${keys.length} conversas` });
      clearSelection();
      setBatchAgentId('');
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
    batchAgentId, setBatchAgentId, batchProcessing,
    batchAction, batchFollowupAction,
  };
}

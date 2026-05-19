import { useEffect, useState, useCallback } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';

export interface GroupExit {
  id: string;
  phone: string;
  contact_name: string | null;
  group_name: string | null;
  group_jid: string;
  exit_action: string;
  exited_at: string;
  acknowledged_at: string | null;
}

/**
 * Lê saídas de membros do grupo não-reconhecidas para um lead.
 * Atualiza em tempo real via Supabase Realtime.
 */
export function useGroupExits(leadId: string | null | undefined) {
  const [exits, setExits] = useState<GroupExit[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchExits = useCallback(async () => {
    if (!leadId) {
      setExits([]);
      return;
    }
    setLoading(true);
    const { data } = await (externalSupabase as any)
      .from('whatsapp_group_exits')
      .select('id, phone, contact_name, group_name, group_jid, exit_action, exited_at, acknowledged_at')
      .eq('lead_id', leadId)
      .is('acknowledged_at', null)
      .order('exited_at', { ascending: false });
    setExits((data || []) as GroupExit[]);
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    fetchExits();
  }, [fetchExits]);

  useEffect(() => {
    if (!leadId) return;
    const channel = (externalSupabase as any)
      .channel(`group_exits_${leadId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_group_exits',
        filter: `lead_id=eq.${leadId}`,
      }, () => fetchExits())
      .subscribe();
    return () => {
      (externalSupabase as any).removeChannel(channel);
    };
  }, [leadId, fetchExits]);

  const acknowledge = useCallback(async (id: string) => {
    await (externalSupabase as any)
      .from('whatsapp_group_exits')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id);
    setExits(prev => prev.filter(e => e.id !== id));
  }, []);

  const acknowledgeAll = useCallback(async () => {
    if (!leadId) return;
    await (externalSupabase as any)
      .from('whatsapp_group_exits')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('lead_id', leadId)
      .is('acknowledged_at', null);
    setExits([]);
  }, [leadId]);

  return { exits, loading, acknowledge, acknowledgeAll, refresh: fetchExits };
}

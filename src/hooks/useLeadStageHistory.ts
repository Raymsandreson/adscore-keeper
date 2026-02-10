import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LeadStageHistory {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  from_board_id: string | null;
  to_board_id: string | null;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
}

export function useLeadStageHistory() {
  const [history, setHistory] = useState<LeadStageHistory[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_stage_history')
        .select('*')
        .eq('lead_id', leadId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setHistory((data || []) as LeadStageHistory[]);
    } catch (error) {
      console.error('Error fetching stage history:', error);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const addHistoryEntry = useCallback(async (
    leadId: string,
    fromStage: string | null,
    toStage: string,
    fromBoardId?: string | null,
    toBoardId?: string | null,
    notes?: string
  ) => {
    try {
      // Get current user for changed_by attribution
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('lead_stage_history')
        .insert({
          lead_id: leadId,
          from_stage: fromStage,
          to_stage: toStage,
          from_board_id: fromBoardId || null,
          to_board_id: toBoardId || null,
          notes: notes || null,
          changed_by: user?.id || null,
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error adding history entry:', error);
    }
  }, []);

  return {
    history,
    loading,
    fetchHistory,
    addHistoryEntry,
  };
}

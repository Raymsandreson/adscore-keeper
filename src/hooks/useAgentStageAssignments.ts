import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AgentStageAssignment {
  id: string;
  agent_id: string;
  board_id: string;
  stage_id: string;
  created_at: string;
}

export function useAgentStageAssignments(agentId?: string, boardId?: string) {
  const [assignments, setAssignments] = useState<AgentStageAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('agent_stage_assignments').select('*');
      if (agentId) query = query.eq('agent_id', agentId);
      if (boardId) query = query.eq('board_id', boardId);
      const { data, error } = await query;
      if (error) throw error;
      setAssignments((data || []) as AgentStageAssignment[]);
    } catch (error) {
      console.error('Error fetching agent stage assignments:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId, boardId]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  // Set stages for an agent (from agent editor perspective)
  const setAgentStages = async (aId: string, bId: string, stageIds: string[]) => {
    try {
      // Remove existing assignments for this agent+board
      await supabase
        .from('agent_stage_assignments')
        .delete()
        .eq('agent_id', aId)
        .eq('board_id', bId);

      if (stageIds.length > 0) {
        const rows = stageIds.map(stageId => ({
          agent_id: aId,
          board_id: bId,
          stage_id: stageId,
        }));
        const { error } = await supabase.from('agent_stage_assignments').insert(rows);
        if (error) throw error;
      }
      await fetchAssignments();
    } catch (error) {
      console.error('Error setting agent stage assignments:', error);
      throw error;
    }
  };

  // Set agent for a specific stage (from board editor perspective)
  const setStageAgent = async (bId: string, stageId: string, aId: string | null) => {
    try {
      // Remove existing assignment for this board+stage
      await supabase
        .from('agent_stage_assignments')
        .delete()
        .eq('board_id', bId)
        .eq('stage_id', stageId);

      if (aId) {
        const { error } = await supabase.from('agent_stage_assignments').insert({
          agent_id: aId,
          board_id: bId,
          stage_id: stageId,
        });
        if (error) throw error;
      }
      await fetchAssignments();
    } catch (error) {
      console.error('Error setting stage agent:', error);
      throw error;
    }
  };

  const getAgentForStage = (bId: string, stageId: string): string | null => {
    return assignments.find(a => a.board_id === bId && a.stage_id === stageId)?.agent_id || null;
  };

  const getStagesForAgent = (aId: string, bId?: string): string[] => {
    return assignments
      .filter(a => a.agent_id === aId && (!bId || a.board_id === bId))
      .map(a => a.stage_id);
  };

  return {
    assignments,
    loading,
    fetchAssignments,
    setAgentStages,
    setStageAgent,
    getAgentForStage,
    getStagesForAgent,
  };
}

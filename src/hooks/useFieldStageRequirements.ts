import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FieldStageRequirement {
  id: string;
  field_id: string;
  board_id: string;
  stage_id: string;
  created_at: string;
}

export function useFieldStageRequirements(boardId?: string) {
  const [requirements, setRequirements] = useState<FieldStageRequirement[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRequirements = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('field_stage_requirements')
        .select('*')
        .eq('board_id', boardId);
      if (error) throw error;
      setRequirements((data || []) as FieldStageRequirement[]);
    } catch (error) {
      console.error('Error fetching field stage requirements:', error);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  const setFieldStages = async (fieldId: string, bId: string, stageIds: string[]) => {
    try {
      // Delete existing for this field+board
      await supabase
        .from('field_stage_requirements')
        .delete()
        .eq('field_id', fieldId)
        .eq('board_id', bId);

      // Insert new ones
      if (stageIds.length > 0) {
        const rows = stageIds.map(stageId => ({
          field_id: fieldId,
          board_id: bId,
          stage_id: stageId,
        }));
        const { error } = await supabase
          .from('field_stage_requirements')
          .insert(rows);
        if (error) throw error;
      }

      await fetchRequirements();
    } catch (error) {
      console.error('Error setting field stage requirements:', error);
      throw error;
    }
  };

  // Get required field IDs for a specific stage
  const getRequiredFieldIdsForStage = (stageId: string): string[] => {
    return requirements
      .filter(r => r.stage_id === stageId)
      .map(r => r.field_id);
  };

  // Get stages where a field is required
  const getStagesForField = (fieldId: string): string[] => {
    return requirements
      .filter(r => r.field_id === fieldId)
      .map(r => r.stage_id);
  };

  useEffect(() => {
    fetchRequirements();
  }, [fetchRequirements]);

  return {
    requirements,
    loading,
    fetchRequirements,
    setFieldStages,
    getRequiredFieldIdsForStage,
    getStagesForField,
  };
}

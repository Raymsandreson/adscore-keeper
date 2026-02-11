import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfWeek, endOfWeek, format } from 'date-fns';

export interface WeeklyEvaluation {
  id: string;
  evaluator_id: string;
  evaluated_id: string;
  is_self_evaluation: boolean;
  week_start: string;
  week_end: string;
  punctuality_score: number | null;
  communication_score: number | null;
  proactivity_score: number | null;
  quality_score: number | null;
  teamwork_score: number | null;
  overall_score: number | null;
  strengths: string | null;
  improvements: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationFormData {
  evaluated_id: string;
  is_self_evaluation: boolean;
  week_start: string;
  week_end: string;
  punctuality_score: number;
  communication_score: number;
  proactivity_score: number;
  quality_score: number;
  teamwork_score: number;
  strengths: string;
  improvements: string;
  comments: string;
}

export function useWeeklyEvaluations() {
  const { user } = useAuthContext();
  const [evaluations, setEvaluations] = useState<WeeklyEvaluation[]>([]);
  const [loading, setLoading] = useState(true);

  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const currentWeekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const fetchEvaluations = useCallback(async (weekStart?: string) => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase
        .from('weekly_evaluations')
        .select('*')
        .order('created_at', { ascending: false });

      if (weekStart) {
        query = query.eq('week_start', weekStart);
      }

      const { data, error } = await query;
      if (error) throw error;
      setEvaluations((data || []) as WeeklyEvaluation[]);
    } catch (error) {
      console.error('Error fetching evaluations:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEvaluations(currentWeekStart);
  }, [fetchEvaluations, currentWeekStart]);

  const submitEvaluation = useCallback(async (data: EvaluationFormData) => {
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('weekly_evaluations')
      .upsert({
        evaluator_id: user.id,
        evaluated_id: data.evaluated_id,
        is_self_evaluation: data.is_self_evaluation,
        week_start: data.week_start,
        week_end: data.week_end,
        punctuality_score: data.punctuality_score,
        communication_score: data.communication_score,
        proactivity_score: data.proactivity_score,
        quality_score: data.quality_score,
        teamwork_score: data.teamwork_score,
        strengths: data.strengths,
        improvements: data.improvements,
        comments: data.comments,
      }, {
        onConflict: 'evaluator_id,evaluated_id,week_start',
      });

    if (error) throw error;
    await fetchEvaluations(currentWeekStart);
  }, [user, fetchEvaluations, currentWeekStart]);

  const deleteEvaluation = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('weekly_evaluations')
      .delete()
      .eq('id', id);
    if (error) throw error;
    await fetchEvaluations(currentWeekStart);
  }, [fetchEvaluations, currentWeekStart]);

  return {
    evaluations,
    loading,
    currentWeekStart,
    currentWeekEnd,
    submitEvaluation,
    deleteEvaluation,
    fetchEvaluations,
  };
}

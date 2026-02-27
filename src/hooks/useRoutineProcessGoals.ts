import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface RoutineProcessGoal {
  id: string;
  user_id: string;
  activity_type: string;
  metric_key: string;
  target_value: number;
  board_id: string | null;
}

export type GoalCategory = 'action' | 'progress' | 'result';

export interface MetricOption {
  value: string;
  label: string;
  category: GoalCategory;
}

export const ACTION_METRICS: MetricOption[] = [
  { value: 'calls', label: 'Ligações', category: 'action' },
  { value: 'dms_sent', label: 'DMs enviadas', category: 'action' },
  { value: 'replies', label: 'Respostas de comentários', category: 'action' },
  { value: 'time_online', label: 'Tempo online (min)', category: 'action' },
  { value: 'contacts_created', label: 'Contatos criados', category: 'action' },
  { value: 'activities_on_time', label: 'Atividades feitas', category: 'action' },
  { value: 'leads_created', label: 'Leads criados', category: 'action' },
  { value: 'follow_requests', label: 'Solicitações p/ seguir', category: 'action' },
];

export const PROGRESS_METRICS: MetricOption[] = [
  { value: 'stages', label: 'Fases concluídas', category: 'progress' },
];

export const RESULT_METRICS: MetricOption[] = [
  { value: 'deals_closed', label: 'Leads fechados', category: 'result' },
  { value: 'deals_refused', label: 'Leads recusados', category: 'result' },
];

export const GOAL_CATEGORIES = [
  { key: 'action' as GoalCategory, label: 'Metas de Ação', icon: '⚡', period: 'diária', metrics: ACTION_METRICS },
  { key: 'progress' as GoalCategory, label: 'Metas de Progresso', icon: '📈', period: 'mensal', metrics: PROGRESS_METRICS },
  { key: 'result' as GoalCategory, label: 'Metas de Resultado', icon: '🏆', period: 'mensal', metrics: RESULT_METRICS },
];

export const PROCESS_METRIC_OPTIONS: MetricOption[] = [
  ...ACTION_METRICS,
  ...PROGRESS_METRICS,
  ...RESULT_METRICS,
];

export function useRoutineProcessGoals(targetUserId?: string) {
  const { user } = useAuthContext();
  const [goals, setGoals] = useState<RoutineProcessGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveUserId = targetUserId || user?.id;

  const fetchGoals = useCallback(async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('routine_process_goals')
      .select('*')
      .eq('user_id', userId);

    if (!error && data) {
      setGoals(data as RoutineProcessGoal[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!effectiveUserId) { setLoading(false); return; }
    fetchGoals(effectiveUserId);
  }, [effectiveUserId, fetchGoals]);

  const saveGoals = useCallback(async (newGoals: Omit<RoutineProcessGoal, 'id'>[], userId?: string) => {
    const uid = userId || effectiveUserId;
    if (!uid) return;

    // Delete existing goals for this user
    await supabase.from('routine_process_goals').delete().eq('user_id', uid);

    if (newGoals.length > 0) {
      const rows = newGoals.map(g => ({
        user_id: uid,
        activity_type: g.activity_type,
        metric_key: g.metric_key,
        target_value: g.target_value,
        board_id: g.board_id,
      }));

      const { error } = await supabase.from('routine_process_goals').insert(rows as any);
      if (error) {
        console.error('Error saving process goals:', error);
        return;
      }
    }

    await fetchGoals(uid);
  }, [effectiveUserId, fetchGoals]);

  return { goals, loading, saveGoals, refetch: () => effectiveUserId && fetchGoals(effectiveUserId) };
}

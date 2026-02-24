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

export const PROCESS_METRIC_OPTIONS = [
  { value: 'leads_created', label: 'Leads criados' },
  { value: 'replies', label: 'Respostas de comentários' },
  { value: 'dms_sent', label: 'DMs enviadas' },
  { value: 'time_online', label: 'Tempo online (min)' },
  { value: 'contacts_created', label: 'Contatos criados' },
  { value: 'calls', label: 'Ligações' },
  { value: 'activities_on_time', label: 'Atividades não atrasadas' },
  { value: 'stages', label: 'Etapas' },
  { value: 'objectives', label: 'Objetivos' },
  { value: 'steps', label: 'Passos' },
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

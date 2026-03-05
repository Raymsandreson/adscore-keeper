import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface CompanyArea {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_active: boolean;
}

export interface MetricDefinition {
  id: string;
  name: string;
  description: string | null;
  area_id: string;
  category: 'action' | 'progress' | 'result';
  periodicity: 'daily' | 'weekly' | 'monthly';
  unit: string;
  calculation_formula: string | null;
  scope_type: 'funnel' | 'workflow' | 'global' | null;
  scope_id: string | null;
  is_active: boolean;
  display_order: number;
  area?: CompanyArea;
}

export interface MemberAreaAssignment {
  id: string;
  user_id: string;
  area_id: string;
  area?: CompanyArea;
}

export interface MemberMetricGoal {
  id: string;
  user_id: string;
  metric_id: string;
  target_value: number;
  period_type: 'daily' | 'weekly' | 'monthly';
  period_start: string | null;
  period_end: string | null;
  is_active: boolean;
  metric?: MetricDefinition;
}

export function useCompanyAreas() {
  const [areas, setAreas] = useState<CompanyArea[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAreas = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('company_areas')
      .select('*')
      .eq('is_active', true)
      .order('display_order');
    setAreas((data as CompanyArea[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAreas(); }, [fetchAreas]);

  return { areas, loading, refetch: fetchAreas };
}

export function useMetricDefinitions(areaId?: string, category?: string) {
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('metric_definitions')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (areaId) query = query.eq('area_id', areaId);
    if (category) query = query.eq('category', category);

    const { data } = await query;
    setMetrics((data as MetricDefinition[]) || []);
    setLoading(false);
  }, [areaId, category]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const saveMetric = async (metric: Partial<MetricDefinition> & { name: string; area_id: string; category: string; periodicity: string }) => {
    if (metric.id) {
      const { error } = await supabase.from('metric_definitions').update(metric as any).eq('id', metric.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('metric_definitions').insert(metric as any);
      if (error) throw error;
    }
    await fetchMetrics();
  };

  const deleteMetric = async (id: string) => {
    await supabase.from('metric_definitions').update({ is_active: false } as any).eq('id', id);
    await fetchMetrics();
  };

  return { metrics, loading, saveMetric, deleteMetric, refetch: fetchMetrics };
}

export function useMemberAreaAssignments(userId?: string) {
  const [assignments, setAssignments] = useState<MemberAreaAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('member_area_assignments').select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data } = await query;
    setAssignments((data as MemberAreaAssignment[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const assignArea = async (uid: string, areaId: string) => {
    const { error } = await supabase.from('member_area_assignments').insert({ user_id: uid, area_id: areaId } as any);
    if (error) throw error;
    await fetchAssignments();
  };

  const removeArea = async (id: string) => {
    await supabase.from('member_area_assignments').delete().eq('id', id);
    await fetchAssignments();
  };

  return { assignments, loading, assignArea, removeArea, refetch: fetchAssignments };
}

export function useMemberMetricGoals(userId?: string) {
  const [goals, setGoals] = useState<MemberMetricGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('member_metric_goals').select('*').eq('is_active', true);
    if (userId) query = query.eq('user_id', userId);
    const { data } = await query;
    setGoals((data as MemberMetricGoal[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  const saveGoal = async (goal: Partial<MemberMetricGoal> & { user_id: string; metric_id: string; target_value: number; period_type: string }) => {
    if (goal.id) {
      const { error } = await supabase.from('member_metric_goals').update(goal as any).eq('id', goal.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('member_metric_goals').insert(goal as any);
      if (error) throw error;
    }
    await fetchGoals();
  };

  const deleteGoal = async (id: string) => {
    await supabase.from('member_metric_goals').update({ is_active: false } as any).eq('id', id);
    await fetchGoals();
  };

  return { goals, loading, saveGoal, deleteGoal, refetch: fetchGoals };
}

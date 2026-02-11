import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LeadActivity {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  deadline: string | null;
  notification_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  notes: string | null;
  what_was_done: string | null;
  next_steps: string | null;
  current_status_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  contact_id: string | null;
  contact_name: string | null;
}

export function useLeadActivities() {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchActivities = useCallback(async (filters?: {
    status?: string;
    activity_type?: string;
    assigned_to?: string;
    lead_id?: string;
  }) => {
    setLoading(true);
    try {
      let query = supabase
        .from('lead_activities')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters?.activity_type && filters.activity_type !== 'all') {
        query = query.eq('activity_type', filters.activity_type);
      }
      if (filters?.assigned_to && filters.assigned_to !== 'all') {
        query = query.eq('assigned_to', filters.assigned_to);
      }
      if (filters?.lead_id) {
        query = query.eq('lead_id', filters.lead_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setActivities((data || []) as LeadActivity[]);
    } catch (error) {
      console.error('Error fetching activities:', error);
      toast.error('Erro ao carregar atividades');
    } finally {
      setLoading(false);
    }
  }, []);

  const createActivity = async (activity: Partial<LeadActivity>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('lead_activities')
        .insert({
          title: activity.title || 'Nova Atividade',
          lead_id: activity.lead_id || null,
          lead_name: activity.lead_name || null,
          description: activity.description || null,
          activity_type: activity.activity_type || 'tarefa',
          status: 'pendente',
          priority: activity.priority || 'normal',
          assigned_to: activity.assigned_to || null,
          assigned_to_name: activity.assigned_to_name || null,
          deadline: activity.deadline || null,
          notification_date: activity.notification_date || null,
          notes: activity.notes || null,
          created_by: user?.id || null,
          contact_id: activity.contact_id || null,
          contact_name: activity.contact_name || null,
        } as any)
        .select()
        .single();

      if (error) throw error;
      toast.success('Atividade criada!');
      return data;
    } catch (error) {
      console.error('Error creating activity:', error);
      toast.error('Erro ao criar atividade');
      throw error;
    }
  };

  const updateActivity = async (id: string, updates: Partial<LeadActivity>) => {
    try {
      const { error } = await supabase
        .from('lead_activities')
        .update(updates as any)
        .eq('id', id);

      if (error) throw error;
      toast.success('Atividade atualizada!');
    } catch (error) {
      console.error('Error updating activity:', error);
      toast.error('Erro ao atualizar atividade');
    }
  };

  const completeActivity = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user?.id || '')
        .single();

      const { error } = await supabase
        .from('lead_activities')
        .update({
          status: 'concluida',
          completed_at: new Date().toISOString(),
          completed_by: user?.id || null,
          completed_by_name: profile?.full_name || null,
        })
        .eq('id', id);

      if (error) throw error;
      toast.success('Atividade concluída!');
    } catch (error) {
      console.error('Error completing activity:', error);
      toast.error('Erro ao concluir atividade');
    }
  };

  const deleteActivity = async (id: string) => {
    try {
      const { error } = await supabase
        .from('lead_activities')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Atividade excluída!');
    } catch (error) {
      console.error('Error deleting activity:', error);
      toast.error('Erro ao excluir atividade');
    }
  };

  return {
    activities,
    loading,
    fetchActivities,
    createActivity,
    updateActivity,
    completeActivity,
    deleteActivity,
  };
}

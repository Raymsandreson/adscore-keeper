import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/hooks/useAuditLog';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  matrix_quadrant: string | null;
  case_id: string | null;
  case_title: string | null;
  process_id: string | null;
  process_title: string | null;
}

export function useLeadActivities() {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchActivities = useCallback(async (filters?: {
    status?: string | string[];
    activity_type?: string | string[];
    assigned_to?: string | string[];
    lead_id?: string | string[];
    contact_id?: string | string[];
    limit?: number;
  }) => {
    setLoading(true);
    try {
      let query = supabase
        .from('lead_activities')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        const vals = Array.isArray(filters.status) ? filters.status : [filters.status];
        const filtered = vals.filter(v => v !== 'all');
        if (filtered.length === 1) query = query.eq('status', filtered[0]);
        else if (filtered.length > 1) query = query.in('status', filtered);
      }
      if (filters?.activity_type) {
        const vals = Array.isArray(filters.activity_type) ? filters.activity_type : [filters.activity_type];
        const filtered = vals.filter(v => v !== 'all');
        if (filtered.length === 1) query = query.eq('activity_type', filtered[0]);
        else if (filtered.length > 1) query = query.in('activity_type', filtered);
      }
      if (filters?.assigned_to) {
        const vals = Array.isArray(filters.assigned_to) ? filters.assigned_to : [filters.assigned_to];
        const filtered = vals.filter(v => v !== 'all');
        const hasUnassigned = filtered.includes('__unassigned__');
        const userIds = filtered.filter(v => v !== '__unassigned__');
        
        if (hasUnassigned && userIds.length > 0) {
          query = query.or(`assigned_to.in.(${userIds.join(',')}),assigned_to.is.null`);
        } else if (hasUnassigned) {
          query = query.is('assigned_to', null);
        } else if (userIds.length === 1) {
          query = query.eq('assigned_to', userIds[0]);
        } else if (userIds.length > 1) {
          query = query.in('assigned_to', userIds);
        }
      }
      if (filters?.lead_id) {
        const vals = Array.isArray(filters.lead_id) ? filters.lead_id : [filters.lead_id];
        const filtered = vals.filter(v => v !== 'all');
        if (filtered.length === 1) query = query.eq('lead_id', filtered[0]);
        else if (filtered.length > 1) query = query.in('lead_id', filtered);
      }
      if (filters?.contact_id) {
        const vals = Array.isArray(filters.contact_id) ? filters.contact_id : [filters.contact_id];
        const filtered = vals.filter(v => v !== 'all');
        if (filtered.length === 1) query = query.eq('contact_id', filtered[0]);
        else if (filtered.length > 1) query = query.in('contact_id', filtered);
      }

      // Apply limit to prevent loading too many records at once
      const maxRows = filters?.limit ?? 500;
      query = query.limit(maxRows);

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
          assigned_to: activity.assigned_to || user?.id || null,
          assigned_to_name: activity.assigned_to_name || null,
          deadline: activity.deadline || null,
          notification_date: activity.notification_date || null,
          notes: activity.notes || null,
          created_by: user?.id || null,
          contact_id: activity.contact_id || null,
          contact_name: activity.contact_name || null,
          what_was_done: activity.what_was_done || null,
          current_status_notes: activity.current_status_notes || null,
          next_steps: activity.next_steps || null,
          matrix_quadrant: activity.matrix_quadrant || null,
          case_id: activity.case_id || null,
          case_title: activity.case_title || null,
          process_id: activity.process_id || null,
          process_title: activity.process_title || null,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Auto-sync to Google Calendar (silent, best-effort, only if connected)
      if (data && (activity.deadline || activity.notification_date)) {
        try {
          const { data: checkData } = await cloudFunctions.invoke('google-check-connection');
          if (checkData?.connected) {
            cloudFunctions.invoke('google-calendar-event', {
              body: {
                action_type: 'call',
                title: activity.title || 'Nova Atividade',
                description: activity.description || activity.notes || undefined,
                scheduled_at: activity.deadline || activity.notification_date,
                contact_name: activity.contact_name || activity.lead_name || undefined,
                notes: `Lead: ${activity.lead_name || ''}\nTipo: ${activity.activity_type || ''}\nStatus: pendente`,
              },
            }).catch(() => {});
          }
        } catch {}
      }

      toast.success('Atividade criada!');

      // Send WhatsApp notification to assigned user (best-effort, silent)
      if (data) {
        cloudFunctions.invoke('notify-activity-created', {
          body: {
            activity_id: data.id,
            title: activity.title,
            description: activity.description,
            activity_type: activity.activity_type,
            status: 'pendente',
            priority: activity.priority,
            assigned_to: activity.assigned_to || user?.id,
            assigned_to_name: activity.assigned_to_name,
            created_by: user?.id,
            deadline: activity.deadline,
            lead_name: activity.lead_name,
            lead_id: activity.lead_id,
            contact_name: activity.contact_name,
            contact_id: activity.contact_id,
            what_was_done: activity.what_was_done,
            next_steps: activity.next_steps,
            current_status_notes: activity.current_status_notes,
            notes: activity.notes,
          },
        }).catch(() => {});
      }

      return data;
    } catch (error) {
      console.error('Error creating activity:', error);
      toast.error('Erro ao criar atividade');
      throw error;
    }
  };

  const updateActivity = async (id: string, updates: Partial<LeadActivity>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('lead_activities')
        .update({ ...updates, updated_by: user?.id || null } as any)
        .eq('id', id);

      if (error) throw error;

      // If linking a lead, migrate orphan chat messages from activity_id to lead_id
      if (updates.lead_id) {
        await supabase
          .from('activity_chat_messages')
          .update({ lead_id: updates.lead_id } as any)
          .eq('activity_id', id)
          .is('lead_id', null);
      }

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
      // Fetch full snapshot before archiving
      const { data: snapshot } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('id', id)
        .single();

      // Save snapshot to audit log
      if (snapshot) {
        await logAudit({
          action: 'delete',
          entityType: 'lead_activity',
          entityId: id,
          entityName: snapshot.title || 'Atividade',
          details: { snapshot, soft_delete: true },
        });
      }

      // Soft delete
      const { error } = await supabase
        .from('lead_activities')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', id);

      if (error) throw error;
      toast.success('Atividade arquivada!');
    } catch (error) {
      console.error('Error archiving activity:', error);
      toast.error('Erro ao arquivar atividade');
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

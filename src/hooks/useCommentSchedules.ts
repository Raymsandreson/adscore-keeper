import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface CommentSchedule {
  id: string;
  name: string;
  is_active: boolean;
  interval_minutes: number;
  max_comments_per_run: number;
  auto_post: boolean;
  tone: string;
  last_run_at: string | null;
  next_run_at: string | null;
  total_runs: number;
  total_replies: number;
  cron_job_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleInput {
  name: string;
  interval_minutes: number;
  max_comments_per_run: number;
  auto_post: boolean;
  tone: string;
}

export function useCommentSchedules() {
  const [schedules, setSchedules] = useState<CommentSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/n8n_comment_schedules?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setSchedules(data || []);
      }
    } catch (error) {
      console.error("Error fetching schedules:", error);
      toast.error("Erro ao carregar agendamentos");
    } finally {
      setLoading(false);
    }
  };

  const createSchedule = async (input: CreateScheduleInput): Promise<CommentSchedule | null> => {
    try {
      const nextRunAt = new Date();
      nextRunAt.setMinutes(nextRunAt.getMinutes() + input.interval_minutes);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/n8n_comment_schedules`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            ...input,
            next_run_at: nextRunAt.toISOString(),
            is_active: true,
          }),
        }
      );

      if (response.ok) {
        const [newSchedule] = await response.json();
        setSchedules(prev => [newSchedule, ...prev]);
        toast.success("Agendamento criado com sucesso!");
        return newSchedule;
      } else {
        throw new Error("Failed to create schedule");
      }
    } catch (error) {
      console.error("Error creating schedule:", error);
      toast.error("Erro ao criar agendamento");
      return null;
    }
  };

  const updateSchedule = async (id: string, updates: Partial<CommentSchedule>) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/n8n_comment_schedules?id=eq.${id}`,
        {
          method: "PATCH",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(updates),
        }
      );

      if (response.ok) {
        const [updated] = await response.json();
        setSchedules(prev => prev.map(s => s.id === id ? updated : s));
        return updated;
      }
    } catch (error) {
      console.error("Error updating schedule:", error);
      toast.error("Erro ao atualizar agendamento");
    }
  };

  const toggleSchedule = async (id: string, isActive: boolean) => {
    const updated = await updateSchedule(id, { is_active: isActive });
    if (updated) {
      toast.success(isActive ? "Agendamento ativado" : "Agendamento pausado");
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/n8n_comment_schedules?id=eq.${id}`,
        {
          method: "DELETE",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );

      if (response.ok) {
        setSchedules(prev => prev.filter(s => s.id !== id));
        toast.success("Agendamento excluído");
      }
    } catch (error) {
      console.error("Error deleting schedule:", error);
      toast.error("Erro ao excluir agendamento");
    }
  };

  const runScheduleNow = async (schedule: CommentSchedule) => {
    try {
      const response = await cloudFunctions.invoke("n8n-comment-webhook", {
        body: {
          action: "scheduled_run",
          schedule_id: schedule.id,
          limit: schedule.max_comments_per_run,
          auto_post: schedule.auto_post,
          tone: schedule.tone,
        },
      });

      if (response.error) throw response.error;

      toast.success(`Executado! ${response.data.processed} comentários processados`);
      fetchSchedules(); // Refresh to get updated metrics
      return response.data;
    } catch (error: any) {
      toast.error(error.message || "Erro ao executar agendamento");
      return null;
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  return {
    schedules,
    loading,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    toggleSchedule,
    deleteSchedule,
    runScheduleNow,
  };
}

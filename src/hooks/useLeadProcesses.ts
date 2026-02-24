import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LeadProcess {
  id: string;
  lead_id: string;
  process_type: 'judicial' | 'administrativo';
  process_number: string | null;
  title: string;
  description: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  status: 'em_andamento' | 'concluido' | 'arquivado';
  started_at: string | null;
  finished_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useLeadProcesses(leadId?: string) {
  const [processes, setProcesses] = useState<LeadProcess[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProcesses = useCallback(async (id?: string) => {
    const targetId = id || leadId;
    if (!targetId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_processes')
        .select('*')
        .eq('lead_id', targetId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProcesses((data || []) as LeadProcess[]);
    } catch (error) {
      console.error('Error fetching processes:', error);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  const addProcess = useCallback(async (process: Partial<LeadProcess>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('lead_processes')
        .insert({ ...process, created_by: user?.id } as any)
        .select()
        .single();
      if (error) throw error;
      setProcesses(prev => [data as LeadProcess, ...prev]);
      toast.success('Processo adicionado');
      return data as LeadProcess;
    } catch (error) {
      console.error('Error adding process:', error);
      toast.error('Erro ao adicionar processo');
      throw error;
    }
  }, []);

  const updateProcess = useCallback(async (id: string, updates: Partial<LeadProcess>) => {
    try {
      const { data, error } = await supabase
        .from('lead_processes')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setProcesses(prev => prev.map(p => p.id === id ? (data as LeadProcess) : p));
      toast.success('Processo atualizado');
      return data as LeadProcess;
    } catch (error) {
      console.error('Error updating process:', error);
      toast.error('Erro ao atualizar processo');
      throw error;
    }
  }, []);

  const deleteProcess = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('lead_processes')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setProcesses(prev => prev.filter(p => p.id !== id));
      toast.success('Processo removido');
    } catch (error) {
      console.error('Error deleting process:', error);
      toast.error('Erro ao remover processo');
      throw error;
    }
  }, []);

  return { processes, loading, fetchProcesses, addProcess, updateProcess, deleteProcess };
}

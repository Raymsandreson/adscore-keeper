import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LeadSource {
  id: string;
  value: string;
  label: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export function useLeadSources() {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_sources')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      setSources((data || []) as LeadSource[]);
    } catch (err) {
      console.error('Error fetching lead sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addSource = useCallback(async (label: string) => {
    const value = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    try {
      const { error } = await supabase
        .from('lead_sources')
        .insert([{ value, label, display_order: sources.length }] as any);
      if (error) {
        if (error.code === '23505') {
          toast.error('Origem já existe');
          return;
        }
        throw error;
      }
      toast.success('Origem adicionada');
      await fetchSources();
    } catch (err) {
      console.error('Error adding source:', err);
      toast.error('Erro ao adicionar origem');
    }
  }, [sources.length, fetchSources]);

  const updateSource = useCallback(async (id: string, label: string) => {
    try {
      const { error } = await supabase
        .from('lead_sources')
        .update({ label } as any)
        .eq('id', id);
      if (error) throw error;
      toast.success('Origem atualizada');
      await fetchSources();
    } catch (err) {
      console.error('Error updating source:', err);
      toast.error('Erro ao atualizar origem');
    }
  }, [fetchSources]);

  const deleteSource = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('lead_sources')
        .update({ is_active: false } as any)
        .eq('id', id);
      if (error) throw error;
      toast.success('Origem removida');
      await fetchSources();
    } catch (err) {
      console.error('Error deleting source:', err);
      toast.error('Erro ao remover origem');
    }
  }, [fetchSources]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return { sources, loading, fetchSources, addSource, updateSource, deleteSource };
}

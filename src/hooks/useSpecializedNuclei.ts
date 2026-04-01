import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SpecializedNucleus {
  id: string;
  name: string;
  prefix: string;
  color: string;
  description: string | null;
  is_active: boolean;
  sequence_counter: number;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useSpecializedNuclei() {
  const [nuclei, setNuclei] = useState<SpecializedNucleus[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNuclei = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('specialized_nuclei')
        .select('*')
        .order('name');
      if (error) throw error;
      setNuclei((data || []) as SpecializedNucleus[]);
    } catch (error) {
      console.error('Error fetching nuclei:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const addNucleus = useCallback(async (nucleus: Partial<SpecializedNucleus>) => {
    try {
      const { data, error } = await supabase
        .from('specialized_nuclei')
        .insert(nucleus as any)
        .select()
        .single();
      if (error) throw error;
      setNuclei(prev => [...prev, data as SpecializedNucleus]);
      toast.success('Núcleo criado');
      return data as SpecializedNucleus;
    } catch (error) {
      console.error('Error adding nucleus:', error);
      toast.error('Erro ao criar núcleo');
      throw error;
    }
  }, []);

  const updateNucleus = useCallback(async (id: string, updates: Partial<SpecializedNucleus>) => {
    try {
      const { data, error } = await supabase
        .from('specialized_nuclei')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setNuclei(prev => prev.map(n => n.id === id ? (data as SpecializedNucleus) : n));
      toast.success('Núcleo atualizado');
      return data as SpecializedNucleus;
    } catch (error) {
      console.error('Error updating nucleus:', error);
      toast.error('Erro ao atualizar núcleo');
      throw error;
    }
  }, []);

  const deleteNucleus = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('specialized_nuclei')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setNuclei(prev => prev.filter(n => n.id !== id));
      toast.success('Núcleo removido');
    } catch (error) {
      console.error('Error deleting nucleus:', error);
      toast.error('Erro ao remover núcleo');
      throw error;
    }
  }, []);

  useEffect(() => {
    fetchNuclei();
  }, [fetchNuclei]);

  return { nuclei, loading, fetchNuclei, addNucleus, updateNucleus, deleteNucleus };
}

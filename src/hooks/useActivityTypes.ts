import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ActivityType {
  id: string;
  key: string;
  label: string;
  color: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export function useActivityTypes() {
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .order('display_order', { ascending: true });
    if (!error && data) setTypes(data as ActivityType[]);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const addType = useCallback(async (label: string, color: string) => {
    const key = `custom_${Date.now()}`;
    const { error } = await supabase.from('activity_types').insert({
      key,
      label,
      color,
      display_order: types.length,
      is_active: true,
    } as any);
    if (error) toast.error('Erro ao adicionar tipo: ' + error.message);
    else { toast.success('Tipo adicionado!'); await refetch(); }
  }, [types.length, refetch]);

  const deleteType = useCallback(async (id: string) => {
    const { error } = await supabase.from('activity_types').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir tipo: ' + error.message);
    else { toast.success('Tipo excluído!'); await refetch(); }
  }, [refetch]);

  const updateType = useCallback(async (id: string, patch: Partial<Pick<ActivityType, 'label' | 'color' | 'display_order' | 'is_active' | 'description'>>) => {
    const { error } = await supabase.from('activity_types').update(patch as any).eq('id', id);
    if (error) toast.error('Erro ao atualizar tipo: ' + error.message);
    else await refetch();
  }, [refetch]);

  const reorder = useCallback(async (reordered: ActivityType[]) => {
    setTypes(reordered);
    await Promise.all(
      reordered.map((t, i) =>
        supabase.from('activity_types').update({ display_order: i } as any).eq('id', t.id)
      )
    );
  }, []);

  return { types, loading, addType, deleteType, updateType, reorder, refetch };
}

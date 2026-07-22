import { useCallback } from 'react';
import { externalSupabase as supabase } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';
import { useSharedFetch, setSharedData } from '@/lib/sharedFetch';

export interface ActivityType {
  id: string;
  key: string;
  label: string;
  color: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  /** Cloud team IDs that this type is restricted to. Empty = global (all teams). */
  team_ids: string[];
}

const CACHE_KEY = 'activity_types';
const EMPTY: ActivityType[] = [];

/**
 * Detecta o tipo "Reunião" de forma robusta. No Externo (kmedldlepwiityjsdahz) o tipo
 * é uma linha custom (key `custom_...`), NÃO a seed `reuniao` — então casar só pela key
 * não funciona. Casa pela key seed OU pelo rótulo normalizado (sem acento/maiúsculas),
 * pra funcionar em qualquer banco.
 */
export function isMeetingType(key?: string | null, label?: string | null): boolean {
  if (key === 'reuniao') return true;
  const norm = (label || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  return norm === 'reuniao';
}

export function useActivityTypes() {
  const { data: types, loading, refetch } = useSharedFetch<ActivityType[]>(
    CACHE_KEY,
    async () => {
      const { data, error } = await supabase
        .from('activity_types')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []).map((t: any) => ({ ...t, team_ids: t.team_ids ?? [] })) as ActivityType[];
    },
    EMPTY,
  );

  const addType = useCallback(async (label: string, color: string, teamIds: string[] = []) => {
    const key = `custom_${Date.now()}`;
    const payload: any = {
      key,
      label,
      color,
      display_order: types.length,
      is_active: true,
    };
    if (teamIds.length > 0) payload.team_ids = teamIds;
    const { data, error } = await supabase.from('activity_types').insert(payload).select().single();
    if (error) { toast.error('Erro ao adicionar tipo: ' + error.message); return null; }
    toast.success('Tipo adicionado!');
    await refetch();
    return data as ActivityType | null;
  }, [types.length, refetch]);

  const deleteType = useCallback(async (id: string) => {
    const { error } = await supabase.from('activity_types').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir tipo: ' + error.message);
    else { toast.success('Tipo excluído!'); await refetch(); }
  }, [refetch]);

  const updateType = useCallback(async (id: string, patch: Partial<Pick<ActivityType, 'label' | 'color' | 'display_order' | 'is_active' | 'description' | 'team_ids'>>) => {
    const { error } = await supabase.from('activity_types').update(patch as any).eq('id', id);
    if (error) toast.error('Erro ao atualizar tipo: ' + error.message);
    else await refetch();
  }, [refetch]);

  const reorder = useCallback(async (reordered: ActivityType[]) => {
    setSharedData(CACHE_KEY, reordered);
    await Promise.all(
      reordered.map((t, i) =>
        supabase.from('activity_types').update({ display_order: i } as any).eq('id', t.id)
      )
    );
  }, []);

  return { types, loading, addType, deleteType, updateType, reorder, refetch };
}

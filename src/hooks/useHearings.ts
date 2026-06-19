import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, authClient } from '@/integrations/supabase';
import { toast } from 'sonner';

export type HearingStatus = 'ativa' | 'adiada' | 'cancelada' | 'concluida';
export type HearingCategory = 'previdenciario' | 'civel' | 'trabalhista' | 'criminal' | 'outro';

export interface Hearing {
  id: string;
  process_number: string | null;
  case_ref: string | null;
  lead_id: string | null;
  legal_case_id: string | null;
  hearing_type: string | null;
  category: HearingCategory;
  hearing_date: string; // YYYY-MM-DD
  hearing_time: string | null; // HH:MM:SS
  timezone_label: string | null;
  status: HearingStatus;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type HearingInput = Omit<Hearing, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'created_by'>;

const KEY = ['hearings'];

export function useHearings() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<Hearing[]> => {
      const { data, error } = await (db as any)
        .from('hearings')
        .select('*')
        .is('deleted_at', null)
        .order('hearing_date', { ascending: true })
        .order('hearing_time', { ascending: true });
      if (error) throw error;
      return (data || []) as Hearing[];
    },
  });

  const create = useMutation({
    mutationFn: async (input: Partial<HearingInput>) => {
      const { data: userData } = await authClient.auth.getUser();
      const created_by = userData?.user?.id ?? null;
      const { data, error } = await (db as any)
        .from('hearings')
        .insert({ ...input, created_by })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Audiência criada');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: any) => toast.error('Erro ao criar: ' + (e?.message || 'desconhecido')),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<HearingInput> }) => {
      const { data, error } = await (db as any)
        .from('hearings')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Audiência atualizada');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: any) => toast.error('Erro ao atualizar: ' + (e?.message || 'desconhecido')),
  });

  const remove = useMutation({
    mutationFn: async (h: Hearing) => {
      const snapshot = JSON.stringify(h);
      const notes = `${h.notes ? h.notes + '\n\n' : ''}[snapshot:${snapshot.slice(0, 4000)}]`;
      const { error } = await (db as any)
        .from('hearings')
        .update({ deleted_at: new Date().toISOString(), notes })
        .eq('id', h.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Audiência excluída');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: any) => toast.error('Erro ao excluir: ' + (e?.message || 'desconhecido')),
  });

  return { ...list, create, update, remove };
}

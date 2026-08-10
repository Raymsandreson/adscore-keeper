/**
 * Visitas agendadas com as assistentes sociais parceiras (tabela `social_visits`
 * no Supabase EXTERNO).
 *
 * A busca é sempre por janela de datas — `visit_date` tem índice parcial e a
 * agenda cresce sem teto. Quem chama passa o intervalo da visão aberta
 * (semana/mês/lista); a aba dentro do lead passa `leadId` e dispensa o
 * intervalo, porque aí o filtro é o índice de lead.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, authClient } from '@/integrations/supabase';
import { toast } from 'sonner';

export type SocialVisitStatus = 'agendada' | 'confirmada' | 'realizada' | 'remarcada' | 'cancelada';

export interface SocialVisit {
  id: string;
  lead_id: string;
  /** Snapshot do nome do lead no agendamento — evita join no calendário. */
  lead_name: string | null;
  social_worker_contact_id: string | null;
  social_worker_name: string;
  social_worker_phone: string | null;
  visit_date: string;        // YYYY-MM-DD
  visit_time: string | null; // HH:MM:SS
  status: SocialVisitStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SocialVisitInput = Omit<
  SocialVisit,
  'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'created_by' | 'updated_by'
>;

interface UseSocialVisitsOptions {
  /** Início do intervalo (YYYY-MM-DD), inclusivo. */
  from?: string;
  /** Fim do intervalo (YYYY-MM-DD), inclusivo. */
  to?: string;
  /** Só as visitas deste lead (aba dentro do lead). */
  leadId?: string | null;
  /** Só as visitas de leads deste board (calendário dentro do funil). */
  boardId?: string | null;
  enabled?: boolean;
}

export const SOCIAL_VISITS_KEY = 'social_visits';

export function useSocialVisits(options: UseSocialVisitsOptions = {}) {
  const { from, to, leadId, boardId, enabled = true } = options;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [
      SOCIAL_VISITS_KEY,
      { from: from ?? null, to: to ?? null, leadId: leadId ?? null, boardId: boardId ?? null },
    ],
    staleTime: 30_000,
    enabled,
    queryFn: async (): Promise<SocialVisit[]> => {
      // O recorte por funil sai do banco, não da memória: o board "Acidente de
      // Trabalho" tem milhares de leads e mandar a lista de ids no `in()`
      // estouraria a URL. O inner join resolve em uma query só.
      let query = (db as any)
        .from('social_visits')
        .select(boardId ? '*, leads!inner(board_id)' : '*')
        .is('deleted_at', null);

      if (boardId) query = query.eq('leads.board_id', boardId);
      if (leadId) query = query.eq('lead_id', leadId);
      if (from) query = query.gte('visit_date', from);
      if (to) query = query.lte('visit_date', to);

      const { data, error } = await query
        .order('visit_date', { ascending: true })
        .order('visit_time', { ascending: true, nullsFirst: true });

      if (error) throw error;
      // O embed vem junto na resposta; some com ele pro objeto continuar sendo
      // uma SocialVisit limpa (o formulário faz spread do que recebe).
      return ((data || []) as any[]).map(({ leads: _joined, ...visit }) => visit) as SocialVisit[];
    },
  });

  /** Invalida toda a família de chaves — a mesma visita aparece na semana, no mês e na aba do lead. */
  const invalidateAll = () => qc.invalidateQueries({ queryKey: [SOCIAL_VISITS_KEY] });

  const currentUserId = async () => {
    const { data } = await authClient.auth.getUser();
    return data?.user?.id ?? null;
  };

  const create = useMutation({
    mutationFn: async (input: Partial<SocialVisitInput>) => {
      const userId = await currentUserId();
      const { data, error } = await (db as any)
        .from('social_visits')
        .insert({ ...input, created_by: userId, updated_by: userId })
        .select('*')
        .single();
      if (error) throw error;
      return data as SocialVisit;
    },
    onSuccess: () => {
      toast.success('Visita agendada');
      invalidateAll();
    },
    onError: (e: any) => toast.error('Erro ao agendar: ' + (e?.message || 'desconhecido')),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SocialVisitInput> }) => {
      // updated_by só existe se o app carimbar: auth.uid() no Externo é anônimo.
      const userId = await currentUserId();
      const { data, error } = await (db as any)
        .from('social_visits')
        .update({ ...patch, updated_by: userId })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as SocialVisit;
    },
    onSuccess: () => {
      toast.success('Visita atualizada');
      invalidateAll();
    },
    onError: (e: any) => toast.error('Erro ao atualizar: ' + (e?.message || 'desconhecido')),
  });

  /** Soft delete: visita realizada não pode sumir do histórico por engano. */
  const remove = useMutation({
    mutationFn: async (visit: SocialVisit) => {
      const userId = await currentUserId();
      const { error } = await (db as any)
        .from('social_visits')
        .update({ deleted_at: new Date().toISOString(), updated_by: userId })
        .eq('id', visit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Visita excluída');
      invalidateAll();
    },
    onError: (e: any) => toast.error('Erro ao excluir: ' + (e?.message || 'desconhecido')),
  });

  return { ...list, create, update, remove };
}

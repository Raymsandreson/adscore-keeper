// =============================================================================
// Metas processuais por time (tabelas team_process_goals / team_workflow_boards
// no Supabase EXTERNO). O realizado vem da RPC team_process_goals_progress.
//
// Atribuição de processo → time: responsável processual do lead; se ele não
// estiver em nenhum time, cai no POP do processo mapeado em team_workflow_boards.
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

export type GoalPeriodType = 'monthly' | 'quarterly' | 'custom';

export interface TeamProcessGoal {
  id: string;
  team_id: string;
  team_name: string | null;
  name: string | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  /** null = qualquer marco conta */
  marco_tipo: MarcoTipo | null;
  target_processes: number | null;
  target_flow_avg_pct: number | null;
  is_active: boolean;
}

/** Linha da RPC: meta + realizado apurado. */
export interface TeamProcessGoalProgress {
  goal_id: string;
  team_id: string;
  team_name: string | null;
  name: string | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  marco_tipo: MarcoTipo | null;
  target_processes: number | null;
  target_flow_avg_pct: number | null;
  /** Processos distintos do time que bateram o marco dentro do período. */
  realizado_processos: number | null;
  /** Média simples do % de passos do POP concluídos — foto do agora. */
  fluxo_medio_pct: number | null;
  processos_no_time: number | null;
  processos_com_fluxo: number | null;
  processos_com_marco: number | null;
}

export interface TeamLite {
  id: string;
  name: string;
  color: string | null;
}

export interface WorkflowBoardLite {
  id: string;
  name: string;
  /** Time dono do POP (mapa team_workflow_boards), se houver. */
  team_id: string | null;
  /** Processos vivos que rodam esse POP. */
  process_count: number;
}

export type TeamProcessGoalInput = Omit<TeamProcessGoal, 'id' | 'is_active'> & { id?: string };

export function useTeamProcessGoals() {
  const [goals, setGoals] = useState<TeamProcessGoalProgress[]>([]);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [boards, setBoards] = useState<WorkflowBoardLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RLS do Externo exige sessão pronta — sem isso volta lista vazia em silêncio.
      await ensureExternalSession();

      const [progressRes, teamsRes, boardsRes, mapRes, procRes] = await Promise.all([
        db.rpc('team_process_goals_progress' as never, {} as never),
        db.from('teams').select('id, name, color').order('name'),
        db.from('kanban_boards').select('id, name').eq('board_type', 'workflow').order('name'),
        db.from('team_workflow_boards').select('team_id, board_id'),
        db.from('lead_processes').select('workflow_id').is('deleted_at', null),
      ]);

      if (progressRes.error) throw progressRes.error;
      setGoals((progressRes.data as unknown as TeamProcessGoalProgress[]) || []);
      setTeams(((teamsRes.data as TeamLite[]) || []));

      const boardTeam = new Map<string, string>(
        ((mapRes.data as { team_id: string; board_id: string }[]) || [])
          .map(m => [m.board_id, m.team_id]),
      );
      const counts = new Map<string, number>();
      ((procRes.data as { workflow_id: string | null }[]) || []).forEach(p => {
        if (p.workflow_id) counts.set(p.workflow_id, (counts.get(p.workflow_id) || 0) + 1);
      });

      setBoards(((boardsRes.data as { id: string; name: string }[]) || []).map(b => ({
        id: b.id,
        name: b.name,
        team_id: boardTeam.get(b.id) || null,
        process_count: counts.get(b.id) || 0,
      })));
    } catch (e) {
      console.error('Erro ao carregar metas processuais do time:', e);
      setError(e instanceof Error ? e.message : 'Erro ao carregar metas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveGoal = useCallback(async (goal: TeamProcessGoalInput) => {
    await ensureExternalSession();
    const payload = {
      team_id: goal.team_id,
      team_name: goal.team_name,
      name: goal.name || null,
      period_type: goal.period_type,
      period_start: goal.period_start,
      period_end: goal.period_end,
      marco_tipo: goal.marco_tipo,
      target_processes: goal.target_processes,
      target_flow_avg_pct: goal.target_flow_avg_pct,
    };

    const { error: err } = goal.id
      ? await db.from('team_process_goals').update(payload as never).eq('id', goal.id)
      : await db.from('team_process_goals').insert(payload as never);

    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  /** Arquiva a meta (is_active = false) — histórico preservado. */
  const deleteGoal = useCallback(async (id: string) => {
    await ensureExternalSession();
    const { error: err } = await db
      .from('team_process_goals')
      .update({ is_active: false } as never)
      .eq('id', id);
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  /** Define (ou limpa, com teamId null) o time dono de um POP. */
  const setBoardTeam = useCallback(async (boardId: string, teamId: string | null) => {
    await ensureExternalSession();
    const { error: delErr } = await db.from('team_workflow_boards').delete().eq('board_id', boardId);
    if (delErr) throw delErr;
    if (teamId) {
      const { error: insErr } = await db
        .from('team_workflow_boards')
        .insert({ board_id: boardId, team_id: teamId } as never);
      if (insErr) throw insErr;
    }
    await fetchAll();
  }, [fetchAll]);

  return { goals, teams, boards, loading, error, saveGoal, deleteGoal, setBoardTeam, refetch: fetchAll };
}

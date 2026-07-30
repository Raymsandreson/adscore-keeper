// =============================================================================
// Metas processuais por time (tabelas team_process_goals / team_workflow_boards
// no Supabase EXTERNO). O realizado vem da RPC team_process_goals_progress.
//
// Semântica: alvo ABSOLUTO por marco — "hoje temos N processos nesse marco,
// queremos chegar a M". baseline_processes guarda o N do momento do cadastro;
// realizado_processos é o acumulado atual; realizado_no_periodo é o ganho
// dentro do período (ritmo).
//
// Atribuição de processo → time: responsável processual do lead; se ele não
// estiver em nenhum time, cai no POP do processo mapeado em team_workflow_boards.
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

export type GoalPeriodType = 'monthly' | 'quarterly' | 'custom';

/** Linha da RPC de progresso: meta + realizado apurado. */
export interface TeamProcessGoalProgress {
  goal_id: string;
  team_id: string;
  team_name: string | null;
  name: string | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  /** null = a linha é do alvo de fluxo médio, não de um marco. */
  marco_tipo: MarcoTipo | null;
  target_processes: number | null;
  target_flow_avg_pct: number | null;
  /** Quantos já estavam no marco quando a meta foi criada. */
  baseline_processes: number | null;
  /** Acumulado de hoje: processos do time que já registraram o marco. */
  realizado_processos: number | null;
  /** Os que registraram o marco dentro do período da meta. */
  realizado_no_periodo: number | null;
  /** Média simples do % de passos do POP concluídos — foto do agora. */
  fluxo_medio_pct: number | null;
  processos_no_time: number | null;
  processos_com_fluxo: number | null;
  processos_com_marco: number | null;
}

/** Retrato por marco usado no formulário ("o que temos hoje"). */
export interface MarcoBaseline {
  marco_tipo: MarcoTipo;
  /** Processos que já passaram pelo marco alguma vez. */
  acumulado: number;
  /** Processos em que esse é o marco mais recente. */
  atual: number;
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

/** Um alvo de marco dentro do conjunto salvo de uma vez. */
export interface MarcoTargetInput {
  marco_tipo: MarcoTipo;
  target_processes: number;
  baseline_processes: number;
}

export interface GoalSetInput {
  team_id: string;
  team_name: string | null;
  name: string | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  marcos: MarcoTargetInput[];
  /** Alvo de % médio de fluxo — vira a linha com marco_tipo null. */
  target_flow_avg_pct: number | null;
}

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

  /** Quantos processos do time já estão em cada marco — alimenta o formulário. */
  const fetchMarcoBaseline = useCallback(async (teamId: string): Promise<MarcoBaseline[]> => {
    await ensureExternalSession();
    const { data, error: err } = await db.rpc(
      'team_process_marco_baseline' as never,
      { p_team_id: teamId } as never,
    );
    if (err) throw err;
    return (data as unknown as MarcoBaseline[]) || [];
  }, []);

  /**
   * Salva o conjunto de alvos de um time/período de uma vez: uma linha por marco
   * com alvo preenchido, mais a linha de fluxo médio (marco_tipo null).
   * Marco que ficou sem alvo tem a linha arquivada.
   */
  const saveGoalSet = useCallback(async (input: GoalSetInput) => {
    await ensureExternalSession();

    const base = {
      team_id: input.team_id,
      team_name: input.team_name,
      name: input.name,
      period_type: input.period_type,
      period_start: input.period_start,
      period_end: input.period_end,
    };

    // Linhas ativas já existentes para este time/período — para atualizar ou arquivar.
    const { data: existing, error: exErr } = await db
      .from('team_process_goals')
      .select('id, marco_tipo')
      .eq('team_id', input.team_id)
      .eq('period_start', input.period_start)
      .eq('period_end', input.period_end)
      .eq('is_active', true);
    if (exErr) throw exErr;

    const byMarco = new Map<string, string>(
      ((existing as { id: string; marco_tipo: string | null }[]) || [])
        .map(r => [r.marco_tipo ?? '__flow__', r.id]),
    );

    const desired: { key: string; payload: Record<string, unknown> }[] = input.marcos.map(m => ({
      key: m.marco_tipo,
      payload: {
        ...base,
        marco_tipo: m.marco_tipo,
        target_processes: m.target_processes,
        baseline_processes: m.baseline_processes,
        target_flow_avg_pct: null,
      },
    }));

    if (input.target_flow_avg_pct != null) {
      desired.push({
        key: '__flow__',
        payload: {
          ...base,
          marco_tipo: null,
          target_processes: null,
          baseline_processes: null,
          target_flow_avg_pct: input.target_flow_avg_pct,
        },
      });
    }

    for (const d of desired) {
      const id = byMarco.get(d.key);
      const { error: err } = id
        ? await db.from('team_process_goals').update(d.payload as never).eq('id', id)
        : await db.from('team_process_goals').insert(d.payload as never);
      if (err) throw err;
      byMarco.delete(d.key);
    }

    // Sobrou linha ativa que o usuário zerou → arquiva.
    for (const id of byMarco.values()) {
      const { error: err } = await db
        .from('team_process_goals')
        .update({ is_active: false } as never)
        .eq('id', id);
      if (err) throw err;
    }

    await fetchAll();
  }, [fetchAll]);

  /** Arquiva uma linha de meta (is_active = false) — histórico preservado. */
  const deleteGoal = useCallback(async (id: string) => {
    await ensureExternalSession();
    const { error: err } = await db
      .from('team_process_goals')
      .update({ is_active: false } as never)
      .eq('id', id);
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  /** Arquiva todas as linhas de um time/período (o card inteiro). */
  const deleteGoalSet = useCallback(async (teamId: string, start: string, end: string) => {
    await ensureExternalSession();
    const { error: err } = await db
      .from('team_process_goals')
      .update({ is_active: false } as never)
      .eq('team_id', teamId)
      .eq('period_start', start)
      .eq('period_end', end)
      .eq('is_active', true);
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

  return {
    goals, teams, boards, loading, error,
    fetchMarcoBaseline, saveGoalSet, deleteGoal, deleteGoalSet, setBoardTeam,
    refetch: fetchAll,
  };
}

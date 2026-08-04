// =============================================================================
// Metas processuais de TIME e de PESSOA (tabela team_process_goals no Supabase
// EXTERNO; team_workflow_boards é só o fallback POP → time). O realizado vem da
// RPC process_goals_progress.
//
// Semântica: alvo ABSOLUTO por marco — "hoje temos N processos nesse marco,
// queremos chegar a M". baseline_processes guarda o N do momento do cadastro;
// realizado_processos é o acumulado atual; realizado_no_periodo é o ganho
// dentro do período (ritmo).
//
// O dono da meta é um só (CHECK team_process_goals_um_dono no banco): ou um
// time, ou uma pessoa. A atribuição do processo muda junto:
//   - time   → responsável processual do lead que esteja em team_members; sem
//              isso, o POP do processo mapeado em team_workflow_boards;
//   - pessoa → lead_processes.responsible_user_id, senão o responsável
//              processual do lead.
// Os 883 processos sem dono individual (medido em 04/08/2026) só aparecem em
// meta de time.
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

// integrations/supabase/types.ts é gerado do CLOUD; as tabelas e RPCs de metas
// vivem no EXTERNO e não constam lá. Acessor local em vez de `as never` espalhado
// por cada chamada.
type PgResult<T> = { data: T | null; error: { message: string } | null };
const ext = db as unknown as {
  from: (table: string) => {
    select: (cols: string) => any;
    insert: (row: Record<string, unknown>) => Promise<PgResult<unknown>>;
    update: (row: Record<string, unknown>) => any;
    delete: () => any;
  };
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<PgResult<T>>;
};

export type GoalPeriodType = 'monthly' | 'quarterly' | 'custom';
export type OwnerKind = 'team' | 'user';

/** Dono de uma meta — time ou pessoa, nunca os dois. */
export interface GoalOwner {
  kind: OwnerKind;
  id: string;
}

/** Argumentos de dono das RPCs: exatamente um preenchido. */
function ownerArgs(owner: GoalOwner) {
  return {
    p_team_id: owner.kind === 'team' ? owner.id : null,
    p_user_id: owner.kind === 'user' ? owner.id : null,
  };
}

/** Linha da RPC de progresso: meta + realizado apurado. */
export interface TeamProcessGoalProgress {
  goal_id: string;
  /** Diz qual dos dois ids abaixo vale. */
  owner_kind: OwnerKind;
  team_id: string | null;
  team_name: string | null;
  user_id: string | null;
  user_name: string | null;
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
  /** Acumulado de hoje: processos do dono que já registraram o marco. */
  realizado_processos: number | null;
  /** Os que registraram o marco dentro do período da meta. */
  realizado_no_periodo: number | null;
  /** Média simples do % de passos do POP concluídos — foto do agora. */
  fluxo_medio_pct: number | null;
  /** Processos do dono — nome herdado de quando só existia meta de time. */
  processos_no_time: number | null;
  processos_com_fluxo: number | null;
  processos_com_marco: number | null;
}

/** Retrato por marco usado no formulário ("o que temos hoje"). */
export interface MarcoBaseline {
  marco_tipo: MarcoTipo;
  /** Processos que já passaram pelo marco alguma vez ("Até hoje"). */
  acumulado: number;
  /** Processos em que esse é o marco mais avançado ("Atualmente"). */
  atual: number;
}

/** Linha do drill-down: processo por trás do número da tabela de marcos. */
export interface MarcoProcesso {
  process_id: string;
  process_number: string | null;
  title: string | null;
  case_id: string | null;
  lead_id: string | null;
  lead_name: string | null;
  responsavel: string | null;
  data_movimentacao: string | null;
  descricao: string | null;
}

export interface TeamLite {
  id: string;
  name: string;
  color: string | null;
}

/** Pessoa que pode ter meta individual: tem ao menos um processo vivo atribuído. */
export interface ProcessOwner {
  user_id: string;
  full_name: string;
  processos: number;
  processos_com_marco: number;
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
  owner: GoalOwner;
  /** Retrato do nome do dono no momento do cadastro (fallback de exibição). */
  owner_name: string | null;
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
  const [owners, setOwners] = useState<ProcessOwner[]>([]);
  const [boards, setBoards] = useState<WorkflowBoardLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RLS do Externo exige sessão pronta — sem isso volta lista vazia em silêncio.
      await ensureExternalSession();

      const [progressRes, teamsRes, ownersRes, boardsRes, mapRes, procRes] = await Promise.all([
        ext.rpc<TeamProcessGoalProgress[]>('process_goals_progress'),
        db.from('teams').select('id, name, color').order('name'),
        ext.rpc<ProcessOwner[]>('process_owners'),
        db.from('kanban_boards').select('id, name').eq('board_type', 'workflow').order('name'),
        ext.from('team_workflow_boards').select('team_id, board_id'),
        db.from('lead_processes').select('workflow_id').is('deleted_at', null),
      ]);

      if (progressRes.error) throw new Error(progressRes.error.message);
      setGoals(progressRes.data || []);
      setTeams(((teamsRes.data as TeamLite[]) || []));

      if (ownersRes.error) throw new Error(ownersRes.error.message);
      setOwners(ownersRes.data || []);

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
      console.error('Erro ao carregar metas processuais:', e);
      setError(e instanceof Error ? e.message : 'Erro ao carregar metas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /** Quantos processos do dono já estão em cada marco — alimenta o formulário. */
  const fetchMarcoBaseline = useCallback(async (owner: GoalOwner): Promise<MarcoBaseline[]> => {
    await ensureExternalSession();
    const { data, error: err } = await ext.rpc<MarcoBaseline[]>(
      'process_marco_baseline',
      ownerArgs(owner),
    );
    if (err) throw new Error(err.message);
    return data || [];
  }, []);

  /** Processos por trás de um número da tabela de marcos (drill-down). */
  const fetchMarcoProcessos = useCallback(async (
    owner: GoalOwner,
    marco: string,
    modo: 'acumulado' | 'atual',
  ): Promise<MarcoProcesso[]> => {
    await ensureExternalSession();
    const { data, error: err } = await ext.rpc<MarcoProcesso[]>(
      'process_marco_processos',
      { ...ownerArgs(owner), p_marco: marco, p_modo: modo },
    );
    if (err) throw new Error(err.message);
    return data || [];
  }, []);

  /**
   * Salva o conjunto de alvos de um dono/período de uma vez: uma linha por marco
   * com alvo preenchido, mais a linha de fluxo médio (marco_tipo null).
   * Marco que ficou sem alvo tem a linha arquivada.
   */
  const saveGoalSet = useCallback(async (input: GoalSetInput) => {
    await ensureExternalSession();

    const isTeam = input.owner.kind === 'team';
    // Coluna do dono: o CHECK do banco exige que a outra fique null.
    const ownerColumn = isTeam ? 'team_id' : 'user_id';

    const base = {
      team_id: isTeam ? input.owner.id : null,
      team_name: isTeam ? input.owner_name : null,
      user_id: isTeam ? null : input.owner.id,
      user_name: isTeam ? null : input.owner_name,
      name: input.name,
      period_type: input.period_type,
      period_start: input.period_start,
      period_end: input.period_end,
    };

    // Linhas ativas já existentes para este dono/período — para atualizar ou arquivar.
    const { data: existing, error: exErr } = await ext
      .from('team_process_goals')
      .select('id, marco_tipo')
      .eq(ownerColumn, input.owner.id)
      .eq('period_start', input.period_start)
      .eq('period_end', input.period_end)
      .eq('is_active', true);
    if (exErr) throw new Error(exErr.message);

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
        ? await ext.from('team_process_goals').update(d.payload).eq('id', id)
        : await ext.from('team_process_goals').insert(d.payload);
      if (err) throw new Error(err.message);
      byMarco.delete(d.key);
    }

    // Sobrou linha ativa que o usuário zerou → arquiva.
    for (const id of byMarco.values()) {
      const { error: err } = await ext
        .from('team_process_goals')
        .update({ is_active: false })
        .eq('id', id);
      if (err) throw new Error(err.message);
    }

    await fetchAll();
  }, [fetchAll]);

  /** Arquiva uma linha de meta (is_active = false) — histórico preservado. */
  const deleteGoal = useCallback(async (id: string) => {
    await ensureExternalSession();
    const { error: err } = await ext
      .from('team_process_goals')
      .update({ is_active: false })
      .eq('id', id);
    if (err) throw new Error(err.message);
    await fetchAll();
  }, [fetchAll]);

  /** Arquiva todas as linhas de um dono/período (o card inteiro). */
  const deleteGoalSet = useCallback(async (owner: GoalOwner, start: string, end: string) => {
    await ensureExternalSession();
    const { error: err } = await ext
      .from('team_process_goals')
      .update({ is_active: false })
      .eq(owner.kind === 'team' ? 'team_id' : 'user_id', owner.id)
      .eq('period_start', start)
      .eq('period_end', end)
      .eq('is_active', true);
    if (err) throw new Error(err.message);
    await fetchAll();
  }, [fetchAll]);

  /** Define (ou limpa, com teamId null) o time dono de um POP. */
  const setBoardTeam = useCallback(async (boardId: string, teamId: string | null) => {
    await ensureExternalSession();
    const { error: delErr } = await ext.from('team_workflow_boards').delete().eq('board_id', boardId);
    if (delErr) throw new Error(delErr.message);
    if (teamId) {
      const { error: insErr } = await ext
        .from('team_workflow_boards')
        .insert({ board_id: boardId, team_id: teamId });
      if (insErr) throw new Error(insErr.message);
    }
    await fetchAll();
  }, [fetchAll]);

  return {
    goals, teams, owners, boards, loading, error,
    fetchMarcoBaseline, fetchMarcoProcessos, saveGoalSet, deleteGoal, deleteGoalSet, setBoardTeam,
    refetch: fetchAll,
  };
}

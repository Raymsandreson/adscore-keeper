// =============================================================================
// FOCO DOS GERENTES — quanto do esforço de cada gerente cai na área de foco dele
// (tabela manager_focus_targets + RPCs manager_focus_status /
// manager_focus_activity_types, todas no Supabase EXTERNO).
//
// Duas leituras no mesmo card, porque as duas metades do pedido medem coisas
// diferentes (ver migration 20260817120000_foco_dos_gerentes.sql):
//   - esforço:   % das atividades concluídas no período nos tipos da área.
//   - resultado: processos da carteira que SAÍRAM (acordo × execução).
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

// types.ts é gerado do CLOUD; estas tabelas e RPCs vivem no EXTERNO e não
// constam lá. Mesmo acessor local usado em useTeamProcessGoals.
type PgResult<T> = { data: T | null; error: { message: string } | null };
const ext = db as unknown as {
  from: (table: string) => {
    select: (cols: string) => any;
    upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<PgResult<unknown>>;
    delete: () => any;
  };
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<PgResult<T>>;
};

/** Um tipo de atividade com quantas vezes o gerente o concluiu no período. */
export interface FocusTypeCount {
  tipo: string;
  label: string;
  n: number;
}

export interface ManagerFocusRow {
  manager_user_id: string;
  nome: string | null;
  times: string[] | null;
  /** false = gerente ainda sem área de foco escolhida. */
  configurado: boolean;
  focus_label: string | null;
  min_percent: number | null;
  concluidas: number;
  no_foco: number;
  /** null quando não há configuração ou não houve atividade no período. */
  pct: number | null;
  /** null = sem base para julgar (sem config ou sem atividade). */
  atingiu: boolean | null;
  /** Onde o foco vaza: tipos fora da área, do maior para o menor. */
  fora: FocusTypeCount[];
  dentro: FocusTypeCount[];
  track_process_exits: boolean;
  exit_target: number | null;
  processos_carteira: number;
  saidas: number;
  saidas_por_acordo: number;
  saidas_por_execucao: number;
}

export interface ManagerFocusInput {
  manager_user_id: string;
  manager_name: string | null;
  focus_label: string;
  min_percent: number;
  activity_type_keys: string[];
  track_process_exits: boolean;
  exit_target: number | null;
}

export type FocusPeriod = 'mes' | 'semana' | 'trimestre' | 'ano';

export const PERIOD_LABEL: Record<FocusPeriod, string> = {
  semana: 'Esta semana',
  mes: 'Este mês',
  trimestre: 'Trimestre',
  ano: 'Este ano',
};

/** Início do período — mesma régua de datas do telão (semana começa segunda). */
export function periodStart(period: FocusPeriod, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case 'semana': {
      const dow = (d.getDay() + 6) % 7; // segunda = 0
      d.setDate(d.getDate() - dow);
      return d;
    }
    case 'trimestre':
      return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    case 'ano':
      return new Date(d.getFullYear(), 0, 1);
    case 'mes':
    default:
      return new Date(d.getFullYear(), d.getMonth(), 1);
  }
}

export function useManagerFocus(period: FocusPeriod = 'mes') {
  const [rows, setRows] = useState<ManagerFocusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RLS do Externo exige sessão pronta — sem isso volta vazio em silêncio.
      await ensureExternalSession();
      const { data, error: err } = await ext.rpc<ManagerFocusRow[]>('manager_focus_status', {
        p_since: periodStart(period).toISOString(),
        p_until: new Date().toISOString(),
      });
      if (err) throw new Error(err.message);
      setRows((data as ManagerFocusRow[]) || []);
    } catch (e) {
      console.error('[useManagerFocus] falha ao carregar:', e);
      setError(e instanceof Error ? e.message : 'Erro ao carregar foco dos gerentes');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /** Tipos que o gerente concluiu nos últimos 90 dias — alimenta a escolha. */
  const fetchTypes = useCallback(async (managerUserId: string): Promise<FocusTypeCount[]> => {
    await ensureExternalSession();
    const { data, error: err } = await ext.rpc<{ activity_type: string; label: string; n: number }[]>(
      'manager_focus_activity_types',
      { p_manager_user_id: managerUserId },
    );
    if (err) throw new Error(err.message);
    return (data || []).map(r => ({ tipo: r.activity_type, label: r.label, n: r.n }));
  }, []);

  const saveFocus = useCallback(async (input: ManagerFocusInput) => {
    await ensureExternalSession();
    const { error: err } = await ext.from('manager_focus_targets').upsert({
      manager_user_id: input.manager_user_id,
      manager_name: input.manager_name,
      focus_label: input.focus_label,
      min_percent: input.min_percent,
      activity_type_keys: input.activity_type_keys,
      track_process_exits: input.track_process_exits,
      exit_target: input.exit_target,
    }, { onConflict: 'manager_user_id' });
    if (err) throw new Error(err.message);
    await fetchAll();
  }, [fetchAll]);

  const clearFocus = useCallback(async (managerUserId: string) => {
    await ensureExternalSession();
    const { error: err } = await ext.from('manager_focus_targets')
      .delete().eq('manager_user_id', managerUserId);
    if (err) throw new Error(err.message);
    await fetchAll();
  }, [fetchAll]);

  return { rows, loading, error, refetch: fetchAll, fetchTypes, saveFocus, clearFocus };
}

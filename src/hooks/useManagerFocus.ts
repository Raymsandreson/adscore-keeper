// =============================================================================
// FOCO DOS GERENTES — quanto do esforço de cada gerente cai na área de foco dele
// (tabela manager_focus_targets + RPCs manager_focus_status /
// manager_focus_activity_types / manager_focus_preview, no Supabase EXTERNO).
//
// Duas leituras no mesmo card (migrations 20260817120000 e 20260817140000):
//   - esforço:   % das atividades concluídas no período que são da área. Conta
//                por TIPO ou pelo ASSUNTO/CONTEXTO — o tipo erra: na medição de
//                17/08/2026 o tipo dava 53% e o assunto levava a 87%, porque
//                "Prestar esclarecimentos sobre minuta de acordo" estava
//                cadastrada como "Tarefa".
//   - resultado: as DUAS pontas da carteira — quantos processos ENTRARAM
//                (petição inicial) e quantos SAÍRAM (acordo × execução), com a
//                vazão entre elas. O que não sai trava o que pode entrar.
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
  /** Quantas o tipo teria perdido e o assunto recuperou. */
  resgatadas_pelo_texto: number;
  /** null quando não há configuração ou não houve atividade no período. */
  pct: number | null;
  /** null = sem base para julgar (sem config ou sem atividade). */
  atingiu: boolean | null;
  /** Configuração salva — preenche o formulário de edição. */
  activity_type_keys: string[];
  focus_keywords: string[];
  /** Onde o foco vaza: tipos fora da área, do maior para o menor. */
  fora: FocusTypeCount[];
  dentro: FocusTypeCount[];
  track_process_exits: boolean;
  exit_target: number | null;
  /** Piso de % da carteira que precisa sair no período. */
  min_exit_percent: number | null;
  processos_carteira: number;
  /** Processos que entraram no período (marco de petição inicial). */
  entradas: number;
  saidas: number;
  saidas_por_acordo: number;
  saidas_por_execucao: number;
  /** Saídas sobre a carteira. */
  pct_saida_carteira: number | null;
  /** Saiu ÷ entrou. Abaixo de 100% a fila cresce. */
  vazao_pct: number | null;
  atingiu_saida: boolean | null;
}

/** Resultado da prévia: o efeito da configuração antes de salvar. */
export interface FocusPreview {
  concluidas: number;
  no_foco: number;
  so_por_tipo: number;
  resgatadas_pelo_texto: number;
  pct: number | null;
}

export interface ManagerFocusInput {
  manager_user_id: string;
  manager_name: string | null;
  focus_label: string;
  min_percent: number;
  activity_type_keys: string[];
  /** Palavras do assunto/contexto que marcam a atividade como da área. */
  focus_keywords: string[];
  track_process_exits: boolean;
  exit_target: number | null;
  min_exit_percent: number | null;
}

/** Ponto de partida de palavras-chave por área — o usuário edita depois. */
export const KEYWORD_SUGGESTIONS: Record<string, string[]> = {
  processual: [
    'acordo', 'audiencia', 'sentenca', 'peticao', 'protocolo', 'recurso',
    'execucao', 'cumprimento', 'pericia', 'juiz', 'processo', 'manifest',
    'contestacao', 'apelacao', 'embargos', 'laudo', 'penhora', 'alvara',
    'intimacao', 'despacho', 'minuta', 'perito', 'honorario', 'tribunal',
    'cejusc', 'precatorio', 'rpv', 'transito', 'prazo',
  ],
  vendas: [
    'lead', 'acolhimento', 'acolhedor', 'contrato', 'fechamento', 'proposta',
    'atendimento', 'consulta', 'caso novo', 'cadastrar caso', 'filtragem',
    'ligacao', 'retorno', 'followup', 'follow up', 'indicacao', 'parceiro',
    'visita', 'captacao', 'outbound', 'inbound',
  ],
};

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

  /** Efeito da configuração antes de salvar (últimos 60 dias). */
  const previewFocus = useCallback(async (
    managerUserId: string, types: string[], keywords: string[],
  ): Promise<FocusPreview | null> => {
    await ensureExternalSession();
    const { data, error: err } = await ext.rpc<FocusPreview>('manager_focus_preview', {
      p_manager_user_id: managerUserId,
      p_types: types,
      p_keywords: keywords,
    });
    if (err) throw new Error(err.message);
    return (data as FocusPreview) || null;
  }, []);

  const saveFocus = useCallback(async (input: ManagerFocusInput) => {
    await ensureExternalSession();
    const { error: err } = await ext.from('manager_focus_targets').upsert({
      manager_user_id: input.manager_user_id,
      manager_name: input.manager_name,
      focus_label: input.focus_label,
      min_percent: input.min_percent,
      activity_type_keys: input.activity_type_keys,
      focus_keywords: input.focus_keywords,
      track_process_exits: input.track_process_exits,
      exit_target: input.exit_target,
      min_exit_percent: input.min_exit_percent,
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

  return { rows, loading, error, refetch: fetchAll, fetchTypes, previewFocus, saveFocus, clearFocus };
}

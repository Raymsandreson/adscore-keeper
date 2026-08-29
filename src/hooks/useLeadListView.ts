// Dados da visualização em LISTA do kanban (board de acolhimento).
// Consulta a view `lead_list_view` (Supabase Externo) com filtro, ordenação,
// paginação e contagens SEMPRE no servidor. Os filtros recebidos são os mesmos
// objetos de estado usados pelo kanban (Regra Zero: trocar de visualização não
// reseta nada) — aqui eles são traduzidos para a query PostgREST.
//
// `stage_entered_at` na view tem a MESMA semântica do kanban: último
// lead_stage_history.changed_at com to_stage = status, fallback updated_at.
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { LeadFilters } from '@/components/kanban/LeadAdvancedFilters';

export type ListSortKey =
  | 'vitima'
  | 'empresa'
  | 'local'
  | 'estagio'
  | 'tempo_estagio'
  | 'data_acidente'
  | 'acolhedor';

export interface ListSort {
  key: ListSortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_LIST_SORT: ListSort = { key: 'tempo_estagio', dir: 'desc' };

export interface QuickChips {
  semAcolhedor: boolean;
  parado90: boolean;
  semVitima: boolean;
}

export const emptyChips: QuickChips = {
  semAcolhedor: false,
  parado90: false,
  semVitima: false,
};

export interface LeadListRow {
  id: string;
  board_id: string | null;
  status: string | null;
  lead_status: string | null;
  lead_name: string | null;
  lead_number: number | null;
  victim_name: string | null;
  victim_name_trim: string | null;
  victim_age: number | null;
  lead_phone: string | null;
  case_number: string | null;
  case_type: string | null;
  acolhedor: string | null;
  acolhedor_trim: string | null;
  accident_date: string | null;
  created_at: string;
  updated_at: string;
  visit_state: string | null;
  visit_city: string | null;
  visit_region: string | null;
  display_company: string | null;
  display_city: string | null;
  display_state: string | null;
  stage_entered_at: string;
  stage_position: number | null;
}

const ROW_COLUMNS =
  'id, board_id, status, lead_status, lead_name, lead_number, victim_name, victim_name_trim, victim_age, lead_phone, case_number, case_type, acolhedor, acolhedor_trim, accident_date, created_at, updated_at, visit_state, visit_city, visit_region, display_company, display_city, display_state, stage_entered_at, stage_position';

export const PAGE_SIZE = 50;
const STALE_DAYS = 90;
// Acima disso o filtro de checklist não entra na URL via .in(); usamos o
// caminho em duas etapas (ids ordenados no servidor -> interseção -> página).
const MAX_IN_IDS = 150;

// Ordenação server-side. `tempo_estagio` é invertido: mais tempo parado =
// stage_entered_at mais antigo (asc).
const SORT_COLUMNS: Record<ListSortKey, { column: string; invert?: boolean }> = {
  vitima: { column: 'victim_name' },
  empresa: { column: 'display_company' },
  local: { column: 'display_city' },
  estagio: { column: 'stage_position' },
  tempo_estagio: { column: 'stage_entered_at', invert: true },
  data_acidente: { column: 'accident_date' },
  acolhedor: { column: 'acolhedor' },
};

export interface LeadListParams {
  boardId: string | null;
  searchQuery: string;
  acolhedorFilter: string;
  advancedFilters: LeadFilters;
  checklistFilteredIds: Set<string> | null;
  chips: QuickChips;
  sort: ListSort;
  page: number; // 0-based
}

function staleCutoffIso(): string {
  return new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Remove caracteres que quebram a sintaxe do .or() do PostgREST. */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

function parseAgeRange(value: string): { min: number; max: number } | null {
  if (!value) return null;
  if (value.endsWith('+')) {
    const min = parseInt(value, 10);
    return Number.isFinite(min) ? { min, max: 999 } : null;
  }
  const [a, b] = value.split('-').map(v => parseInt(v, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { min: a, max: b };
}

/**
 * Aplica na query os mesmos filtros que o kanban aplica client-side
 * (busca do header, select de acolhedor, filtros avançados e chips da lista).
 */
function applyFilters(q: any, p: LeadListParams): any {
  q = q.eq('board_id', p.boardId).eq('kanban_visible', true);

  // Busca do header: nome, telefone (>=3 dígitos) ou número do caso —
  // mesmos campos de UnifiedKanbanManager.filteredLeads.
  const search = p.searchQuery.trim();
  if (search) {
    const term = sanitizeTerm(search).toLowerCase();
    const digits = search.replace(/\D/g, '');
    const parts: string[] = [];
    if (term) {
      parts.push(`lead_name.ilike.%${term}%`, `case_number.ilike.%${term}%`);
    }
    if (digits.length >= 3) parts.push(`phone_digits.like.%${digits}%`);
    if (parts.length) q = q.or(parts.join(','));
  }

  if (p.acolhedorFilter) q = q.eq('acolhedor', p.acolhedorFilter);

  const f = p.advancedFilters;
  if (f.searchTerm) {
    const term = sanitizeTerm(f.searchTerm).toLowerCase();
    const digits = f.searchTerm.replace(/\D/g, '');
    const parts: string[] = [];
    if (term) {
      parts.push(
        `lead_name.ilike.%${term}%`,
        `victim_name.ilike.%${term}%`,
        `case_number.ilike.%${term}%`,
      );
    }
    if (digits.length >= 3) parts.push(`phone_digits.like.%${digits}%`);
    if (parts.length) q = q.or(parts.join(','));
  }
  if (f.createdBy) q = q.eq('created_by', f.createdBy);
  if (f.updatedBy) q = q.eq('updated_by', f.updatedBy);
  if (f.createdFrom) q = q.gte('created_at', f.createdFrom);
  if (f.createdTo) q = q.lte('created_at', `${f.createdTo}T23:59:59`);
  if (f.updatedFrom) q = q.gte('updated_at', f.updatedFrom);
  if (f.updatedTo) q = q.lte('updated_at', `${f.updatedTo}T23:59:59`);
  if (f.victimName) q = q.ilike('victim_name', `%${sanitizeTerm(f.victimName)}%`);
  const age = parseAgeRange(f.ageRange);
  if (age) q = q.gte('victim_age', age.min).lte('victim_age', age.max);
  if (f.caseType) q = q.eq('case_type', f.caseType);
  if (f.acolhedor) q = q.eq('acolhedor', f.acolhedor);
  if (f.accidentDateFrom) q = q.gte('accident_date', f.accidentDateFrom);
  if (f.accidentDateTo) q = q.lte('accident_date', f.accidentDateTo);
  // Estado é multi: uma UF vira eq, várias viram IN.
  const ufs = Array.isArray(f.visitState) ? f.visitState : f.visitState ? [f.visitState as string] : [];
  if (ufs.length === 1) q = q.eq('visit_state', ufs[0]);
  else if (ufs.length > 1) q = q.in('visit_state', ufs);
  if (f.visitCity) q = q.eq('visit_city', f.visitCity);
  if (f.visitRegion) q = q.eq('visit_region', f.visitRegion);

  if (p.chips.semAcolhedor) q = q.is('acolhedor_trim', null);
  if (p.chips.semVitima) q = q.is('victim_name_trim', null);
  if (p.chips.parado90) q = q.lte('stage_entered_at', staleCutoffIso());

  // Filtro de checklist pequeno entra direto na query; grande usa o caminho
  // em duas etapas em fetchPage().
  if (p.checklistFilteredIds !== null && p.checklistFilteredIds.size <= MAX_IN_IDS) {
    q = q.in('id', Array.from(p.checklistFilteredIds));
  }

  return q;
}

function applyOrder(q: any, sort: ListSort): any {
  const def = SORT_COLUMNS[sort.key] || SORT_COLUMNS.tempo_estagio;
  const ascending = def.invert ? sort.dir === 'desc' : sort.dir === 'asc';
  return q
    .order(def.column, { ascending, nullsFirst: false })
    .order('id', { ascending: true });
}

function view() {
  return (db as any).from('lead_list_view');
}

const usesBigChecklistPath = (p: LeadListParams) =>
  p.checklistFilteredIds !== null && p.checklistFilteredIds.size > MAX_IN_IDS;

/** Busca TODOS os ids + stage_entered_at filtrados, em lotes de 1000, na ordem do servidor. */
async function fetchAllOrderedIds(p: LeadListParams): Promise<Array<{ id: string; stage_entered_at: string }>> {
  const all: Array<{ id: string; stage_entered_at: string }> = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    let q = view().select('id, stage_entered_at');
    q = applyFilters(q, p);
    q = applyOrder(q, p.sort).range(from, from + CHUNK - 1);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data || []) as Array<{ id: string; stage_entered_at: string }>;
    all.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return all;
}

export interface LeadListResult {
  rows: LeadListRow[];
  totalCount: number;
  stale90Count: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Ids de todos os leads filtrados, na ordenação atual (p/ "selecionar todos os N"). */
  fetchAllFilteredIds: () => Promise<string[]>;
  /** Todas as linhas filtradas, na ordenação atual (p/ exportar CSV). */
  fetchAllFilteredRows: () => Promise<LeadListRow[]>;
}

export function useLeadListView(params: LeadListParams): LeadListResult {
  const [rows, setRows] = useState<LeadListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stale90Count, setStale90Count] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Hash independente de ordem: detecta qualquer mudança no conjunto sem
  // serializar milhares de ids a cada render.
  let checklistKey = 'off';
  if (params.checklistFilteredIds !== null) {
    let h = 0;
    for (const id of params.checklistFilteredIds) {
      let x = 0;
      for (let i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0;
      h = (h ^ x) >>> 0;
    }
    checklistKey = `${params.checklistFilteredIds.size}:${h}`;
  }

  const filterKey = JSON.stringify([
    params.boardId,
    params.searchQuery,
    params.acolhedorFilter,
    params.advancedFilters,
    checklistKey,
    params.chips,
    params.sort,
    params.page,
    refreshTick,
  ]);

  useEffect(() => {
    if (!params.boardId) {
      setRows([]);
      setTotalCount(0);
      setStale90Count(0);
      return;
    }
    let cancelled = false;

    const run = async () => {
      const p = paramsRef.current;
      setLoading(true);
      setError(null);
      try {
        try {
          await ensureExternalSession();
        } catch {
          /* sessão anônima é best-effort; RLS de leitura é aberta */
        }

        if (p.checklistFilteredIds !== null && p.checklistFilteredIds.size === 0) {
          if (!cancelled) {
            setRows([]);
            setTotalCount(0);
            setStale90Count(0);
          }
          return;
        }

        if (usesBigChecklistPath(p)) {
          // Duas etapas: ids ordenados no servidor -> interseção com o filtro
          // de checklist -> página de 50 -> linhas completas dessas 50.
          const ordered = await fetchAllOrderedIds(p);
          const wanted = p.checklistFilteredIds!;
          const filtered = ordered.filter(r => wanted.has(r.id));
          const cutoff = staleCutoffIso();
          const stale = filtered.filter(r => r.stage_entered_at <= cutoff).length;
          const pageIds = filtered
            .slice(p.page * PAGE_SIZE, p.page * PAGE_SIZE + PAGE_SIZE)
            .map(r => r.id);

          let pageRows: LeadListRow[] = [];
          if (pageIds.length > 0) {
            const { data, error: rowsErr } = await view()
              .select(ROW_COLUMNS)
              .in('id', pageIds);
            if (rowsErr) throw rowsErr;
            const byId = new Map((data || []).map((r: LeadListRow) => [r.id, r]));
            pageRows = pageIds
              .map(id => byId.get(id))
              .filter(Boolean) as LeadListRow[];
          }
          if (!cancelled) {
            setRows(pageRows);
            setTotalCount(filtered.length);
            setStale90Count(stale);
          }
          return;
        }

        const countQ = applyFilters(view().select('id', { count: 'exact', head: true }), p);
        const staleQ = applyFilters(view().select('id', { count: 'exact', head: true }), p)
          .lte('stage_entered_at', staleCutoffIso());
        let rowsQ = applyFilters(view().select(ROW_COLUMNS), p);
        rowsQ = applyOrder(rowsQ, p.sort).range(
          p.page * PAGE_SIZE,
          p.page * PAGE_SIZE + PAGE_SIZE - 1,
        );

        const [countRes, staleRes, rowsRes] = await Promise.all([countQ, staleQ, rowsQ]);
        if (countRes.error) throw countRes.error;
        if (staleRes.error) throw staleRes.error;
        if (rowsRes.error) throw rowsRes.error;

        if (!cancelled) {
          setRows((rowsRes.data || []) as LeadListRow[]);
          setTotalCount(countRes.count || 0);
          setStale90Count(staleRes.count || 0);
        }
      } catch (err: any) {
        console.error('[useLeadListView] erro ao buscar lista:', err);
        if (!cancelled) {
          setError(err?.message || 'Erro ao carregar a lista');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Debounce curto: busca digitada dispara muitas mudanças seguidas.
    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const refresh = useCallback(() => setRefreshTick(t => t + 1), []);

  const fetchAllFilteredIds = useCallback(async (): Promise<string[]> => {
    const p = paramsRef.current;
    if (!p.boardId) return [];
    const ordered = await fetchAllOrderedIds(p);
    if (usesBigChecklistPath(p)) {
      const wanted = p.checklistFilteredIds!;
      return ordered.filter(r => wanted.has(r.id)).map(r => r.id);
    }
    return ordered.map(r => r.id);
  }, []);

  const fetchAllFilteredRows = useCallback(async (): Promise<LeadListRow[]> => {
    const p = paramsRef.current;
    if (!p.boardId) return [];
    const all: LeadListRow[] = [];
    const CHUNK = 1000;
    for (let from = 0; ; from += CHUNK) {
      let q = view().select(ROW_COLUMNS);
      q = applyFilters(q, p);
      q = applyOrder(q, p.sort).range(from, from + CHUNK - 1);
      const { data, error: err } = await q;
      if (err) throw err;
      const chunk = (data || []) as LeadListRow[];
      all.push(...chunk);
      if (chunk.length < CHUNK) break;
    }
    if (usesBigChecklistPath(p)) {
      const wanted = p.checklistFilteredIds!;
      return all.filter(r => wanted.has(r.id));
    }
    return all;
  }, []);

  return {
    rows,
    totalCount,
    stale90Count,
    loading,
    error,
    refresh,
    fetchAllFilteredIds,
    fetchAllFilteredRows,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

export interface ClassificationContact {
  id: string;
  full_name: string | null;
  phone: string | null;
  instagram_username: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  profession: string | null;
}

export interface FacetRow {
  /** Chave normalizada (sem acento/caixa). `null` = "sem informação". */
  key: string | null;
  label: string | null;
  count: number;
}

export type FacetKey = 'state' | 'city' | 'neighborhood' | 'profession';

export interface ClassificationReport {
  total: number;
  filtered: number;
  facets: Record<FacetKey, FacetRow[]>;
  contacts: ClassificationContact[];
}

const EMPTY_REPORT: ClassificationReport = {
  total: 0,
  filtered: 0,
  facets: { state: [], city: [], neighborhood: [], profession: [] },
  contacts: [],
};

export const NONE_KEY = '__none__';
export const PAGE_SIZE = 60;

/** Contagem de contatos por status. Só dispara com `enabled` (popup aberto). */
export function useClassificationCounts(enabled: boolean) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await (db as any).rpc('contact_classification_counts');
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data || []) as { name: string; contacts: number }[]) {
        map[row.name] = Number(row.contacts) || 0;
      }
      setCounts(map);
    } catch (e) {
      console.error('[useClassificationCounts]', e);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { counts, loading, refresh };
}

export interface ReportFilters {
  state?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  profession?: string | null;
  search?: string;
}

/**
 * Relatório de um relacionamento: total, facetas (estado/cidade/bairro/profissão)
 * e a página atual de contatos. Toda a agregação roda no Postgres — `prospect`
 * sozinho tem ~25k contatos.
 */
export function useClassificationReport(
  name: string | null,
  filters: ReportFilters,
  page: number,
) {
  const [report, setReport] = useState<ClassificationReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const filterKey = useMemo(
    () => JSON.stringify([
      filters.state ?? null,
      filters.city ?? null,
      filters.neighborhood ?? null,
      filters.profession ?? null,
      (filters.search || '').trim(),
    ]),
    [filters.state, filters.city, filters.neighborhood, filters.profession, filters.search],
  );

  const load = useCallback(async () => {
    if (!name) { setReport(EMPTY_REPORT); return; }
    const myId = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      await ensureExternalSession();
      const [state, city, neighborhood, profession, search] = JSON.parse(filterKey) as
        [string | null, string | null, string | null, string | null, string];
      const { data, error: err } = await (db as any).rpc('contact_classification_report', {
        p_name: name,
        p_state: state,
        p_city: city,
        p_neighborhood: neighborhood,
        p_profession: profession,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (err) throw err;
      if (myId !== reqId.current) return; // resposta obsoleta
      const raw = (data || {}) as Partial<ClassificationReport>;
      setReport({
        total: Number(raw.total) || 0,
        filtered: Number(raw.filtered) || 0,
        facets: {
          state: raw.facets?.state || [],
          city: raw.facets?.city || [],
          neighborhood: raw.facets?.neighborhood || [],
          profession: raw.facets?.profession || [],
        },
        contacts: raw.contacts || [],
      });
    } catch (e: any) {
      if (myId !== reqId.current) return;
      console.error('[useClassificationReport]', e);
      setError(e?.message || 'Erro ao carregar contatos');
      setReport(EMPTY_REPORT);
    } finally {
      if (myId === reqId.current) setLoading(false);
    }
  }, [name, filterKey, page]);

  useEffect(() => { load(); }, [load]);

  return { report, loading, error, reload: load };
}

/**
 * Conta processos por tribunal e por unidade de origem, decodificando o número
 * CNJ que já está em `lead_processes.process_number`.
 *
 * É o que substitui a tabela de vínculo manual contato↔processo: nada para o
 * acolhedor preencher, e a lista de contatos passa a ordenar por "onde eu tenho
 * processo de verdade" em vez de ordem alfabética.
 *
 * Carga: ~1.8k linhas de duas colunas, paginadas de 1.000 (teto do PostgREST),
 * com cache de módulo — o sheet reabrir não refaz a consulta.
 */

import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import { parseCnj, cnjUnitKey } from '@/lib/cnj';

export interface CountPair {
  /** Processos não arquivados. */
  active: number;
  total: number;
}

export interface CourtProcessCounts {
  /** Chave: courtCode (TRT22, TJPI...). */
  byCourt: Map<string, CountPair>;
  /** Chave: courtCode:originCode (TRT22:0001) — casamento fino com a vara. */
  byUnit: Map<string, CountPair>;
  /** Processos com CNJ legível (denominador honesto da cobertura). */
  decoded: number;
  scanned: number;
}

const EMPTY: CourtProcessCounts = {
  byCourt: new Map(),
  byUnit: new Map(),
  decoded: 0,
  scanned: 0,
};

const PAGE = 1000;

let cache: CourtProcessCounts | null = null;
let inflight: Promise<CourtProcessCounts> | null = null;

const bump = (map: Map<string, CountPair>, key: string, active: boolean) => {
  const cur = map.get(key) || { active: 0, total: 0 };
  cur.total += 1;
  if (active) cur.active += 1;
  map.set(key, cur);
};

async function fetchCounts(): Promise<CourtProcessCounts> {
  const byCourt = new Map<string, CountPair>();
  const byUnit = new Map<string, CountPair>();
  let decoded = 0;
  let scanned = 0;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('lead_processes')
      .select('process_number, arquivado')
      .is('deleted_at', null)
      .not('process_number', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    scanned += rows.length;

    for (const row of rows) {
      const info = parseCnj((row as { process_number: string }).process_number);
      if (!info) continue;
      decoded += 1;
      const active = (row as { arquivado: boolean | null }).arquivado !== true;
      bump(byCourt, info.courtCode, active);
      bump(byUnit, cnjUnitKey(info.courtCode, info.originCode), active);
    }

    if (rows.length < PAGE) break;
  }

  return { byCourt, byUnit, decoded, scanned };
}

/** Contagens compartilhadas; `enabled` evita puxar dados com o sheet fechado. */
export function useCourtProcessCounts(enabled = true) {
  const [counts, setCounts] = useState<CourtProcessCounts>(cache || EMPTY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    if (cache && !force) { setCounts(cache); return; }
    setLoading(true);
    try {
      if (!inflight || force) inflight = fetchCounts();
      const result = await inflight;
      cache = result;
      setCounts(result);
    } catch (e) {
      console.error('[useCourtProcessCounts] falhou', e);
    } finally {
      inflight = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  return { counts, loading, refresh: () => load(true) };
}

/**
 * Quantos processos caem neste contato. Usa a unidade exata quando o contato já
 * aprendeu o código de origem; senão cai para o tribunal inteiro (`approx`).
 */
export function countForContact(
  counts: CourtProcessCounts,
  contact: { court_code?: string | null; origin_codes?: string[] | null },
): { active: number; total: number; approx: boolean } {
  const code = contact.court_code;
  if (!code) return { active: 0, total: 0, approx: false };

  const origins = contact.origin_codes || [];
  if (origins.length) {
    let active = 0, total = 0;
    for (const o of origins) {
      const hit = counts.byUnit.get(cnjUnitKey(code, o));
      if (hit) { active += hit.active; total += hit.total; }
    }
    return { active, total, approx: false };
  }

  const court = counts.byCourt.get(code);
  return { active: court?.active || 0, total: court?.total || 0, approx: true };
}

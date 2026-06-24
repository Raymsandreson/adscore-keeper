// Carrega colunas "full" sob demanda para um conjunto de leads visíveis.
// Reaproveita o leadsCache compartilhado e faz merge in-place — assim o useLeads('index')
// vê o resultado automaticamente via subscriber.
import { useEffect, useRef } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { leadsCache } from './useLeadsCache';
import { LEAD_FULL_COLUMNS, computeLeadStats, type Lead } from './useLeads';

// Marca por adAccountId quais ids já tiveram fetch full nesta sessão de página.
const loadedByKey = new Map<string, Set<string>>();
function loadedSet(adAccountId?: string): Set<string> {
  const k = adAccountId || '__all__';
  let s = loadedByKey.get(k);
  if (!s) { s = new Set(); loadedByKey.set(k, s); }
  return s;
}

const DEBOUNCE_MS = 150;
const MAX_BATCH = 200;

/**
 * Hidrata colunas full para os ids passados (apenas os ainda não carregados).
 * Use em consumidores que renderizam só uma parte da lista (Kanban visível, drawer).
 */
export function useLeadDetails(ids: string[], adAccountId?: string) {
  const idsKey = ids.join(',');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ids || ids.length === 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const loaded = loadedSet(adAccountId);
      const missing = Array.from(new Set(ids)).filter(id => id && !loaded.has(id));
      if (missing.length === 0) return;

      // Marca otimisticamente para evitar requests duplicados em flight
      missing.forEach(id => loaded.add(id));

      try {
        // Fatia em lotes para evitar URLs gigantes
        const batches: string[][] = [];
        for (let i = 0; i < missing.length; i += MAX_BATCH) {
          batches.push(missing.slice(i, i + MAX_BATCH));
        }

        const all: Lead[] = [];
        for (const batch of batches) {
          const { data, error } = await externalSupabase
            .from('leads')
            .select(LEAD_FULL_COLUMNS)
            .in('id', batch);
          if (error) {
            // Rollback otimismo no batch que falhou
            batch.forEach(id => loaded.delete(id));
            console.warn('[useLeadDetails] batch error:', error.message);
            continue;
          }
          if (data && data.length) all.push(...(data as unknown as Lead[]));
        }

        if (all.length === 0) return;

        leadsCache.update(
          adAccountId,
          (prev) => {
            const map = new Map(prev.map(l => [l.id, l]));
            let changed = false;
            for (const row of all) {
              const existing = map.get(row.id);
              if (existing) {
                map.set(row.id, { ...existing, ...row });
                changed = true;
              }
            }
            return changed ? Array.from(map.values()) : prev;
          },
          (next) => computeLeadStats(next),
        );
      } catch (err) {
        console.warn('[useLeadDetails] fetch error:', err);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [idsKey, adAccountId]);
}

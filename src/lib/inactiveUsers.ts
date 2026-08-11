/**
 * Quem foi desativado na aba Times (org_user_status.active = false, no Supabase
 * Externo) não pode mais aparecer como assessor. A busca é única por sessão
 * (cache + dedupe do promise): são ~15 seletores espalhados pelo sistema e
 * vários montam dentro de lista.
 *
 * O resultado é publicado em src/lib/assigneeBlocklist.ts ANTES de qualquer
 * listener repintar, então `filterAssignableMembers` já enxerga a lista nova no
 * render seguinte.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { setInactiveUserIds } from './assigneeBlocklist';

const TTL_MS = 5 * 60_000;

let cached: { ids: Set<string>; at: number } | null = null;
let inFlight: Promise<Set<string>> | null = null;

/**
 * user_ids (Cloud) desativados. Falha não vira cache — a próxima chamada tenta
 * de novo, e enquanto isso o seletor cai no comportamento antigo (lista fixa).
 */
export function fetchInactiveUserIds(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.ids);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await ensureExternalSession();
      // org_user_status não está no types.ts gerado (tabela só do Externo).
      const { data, error } = await (db as unknown as SupabaseClient)
        .from('org_user_status')
        .select('user_id')
        .eq('active', false);
      if (error) throw error;
      const ids = new Set<string>(
        ((data as { user_id: string | null }[]) || []).map(r => r.user_id).filter((id): id is string => !!id),
      );
      cached = { ids, at: Date.now() };
      setInactiveUserIds(ids);
      return ids;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Descarta o cache — usado ao ativar/desativar alguém na aba Times. */
export function invalidateInactiveUserIds() {
  cached = null;
}

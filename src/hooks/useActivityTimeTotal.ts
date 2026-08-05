import { useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tempo total cronometrado numa atividade — soma de `active_seconds` de TODAS as
 * sessões (`activity_time_entries`), de qualquer membro e de qualquer dia.
 *
 * A ActivitiesPage já fazia essa soma inline pro badge da ficha; o
 * `ActivityFullSheet` (chat, lead, caso, processo) não tinha nada, então a
 * mensagem saía sem o tempo. Extraído pra cá pra ambos usarem a mesma fonte.
 *
 * Índice: `idx_ate_activity` em (activity_id) — a query é coberta.
 * `activity_time_entries` ainda não está nos types gerados: acesso destipado.
 */
export function useActivityTimeTotal(activityId: string | null | undefined): number {
  const [totalSeconds, setTotalSeconds] = useState(0);

  useEffect(() => {
    if (!activityId) { setTotalSeconds(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (db as unknown as SupabaseClient)
          .from('activity_time_entries')
          .select('active_seconds')
          .eq('activity_id', activityId);
        if (cancelled) return;
        const total = ((data as { active_seconds: number | null }[]) || [])
          .reduce((sum, r) => sum + (r.active_seconds || 0), 0);
        setTotalSeconds(total);
      } catch (err) {
        console.warn('[useActivityTimeTotal]', err);
        if (!cancelled) setTotalSeconds(0);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  return totalSeconds;
}

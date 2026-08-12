/**
 * Previsão de tempo da atividade e tempo já gasto nela.
 *
 * Duas coisas que o formulário precisa mostrar lado a lado:
 *  - PREVISÃO  → `lead_activities.estimated_minutes` (migration 20260812120000).
 *                Ao criar, sugerimos a mediana real do tipo escolhido, medida no
 *                próprio cronômetro (RPC `activity_type_time_medians`).
 *  - GASTO     → soma de `activity_time_entries.active_seconds` da atividade
 *                (todas as sessões, todos os dias — o work_date particiona o dia,
 *                o total da atividade é a soma das fatias).
 *
 * As medianas são as mesmas para todo mundo e mudam devagar: uma chamada por
 * carregamento de página, compartilhada por todos os formulários abertos.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

/** Opções do seletor de previsão (min). */
export const ESTIMATE_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

/** Fallback quando o tipo não tem histórico suficiente (amostra < 5 sessões). */
export const ESTIMATE_FALLBACK_MIN = 30;

type MedianRow = { activity_type: string; median_minutes: number; samples: number };

let mediansPromise: Promise<Record<string, MedianRow>> | null = null;

function loadMedians(): Promise<Record<string, MedianRow>> {
  if (mediansPromise) return mediansPromise;
  mediansPromise = (async () => {
    try {
      await ensureExternalSession();
      const { data, error } = await (externalSupabase as any).rpc('activity_type_time_medians');
      if (error) throw error;
      const map: Record<string, MedianRow> = {};
      for (const row of (data || []) as MedianRow[]) map[row.activity_type] = row;
      return map;
    } catch {
      // Sem histórico disponível o formulário cai no fallback — não é erro de tela.
      return {};
    }
  })();
  return mediansPromise;
}

/**
 * Arredonda a mediana PARA CIMA na régua de opções. Previsão abaixo da mediana
 * faria metade das atividades nascerem estouradas, e o vermelho do cronômetro
 * viraria ruído — o excedente só informa se a previsão for alcançável.
 */
export function snapEstimate(minutes: number): number {
  const hit = ESTIMATE_OPTIONS.find(o => o >= minutes);
  return hit ?? ESTIMATE_OPTIONS[ESTIMATE_OPTIONS.length - 1];
}

/** Formata minutos como "45min" / "1h30". */
export function formatEstimate(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Formata segundos como "07:12" / "1h07" (tempo gasto). */
export function formatSpent(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Previsão sugerida por tipo de atividade. `suggestFor` devolve null enquanto as
 * medianas não chegaram — quem chama decide se espera ou usa o fallback.
 */
export function useEstimateSuggestion() {
  const [medians, setMedians] = useState<Record<string, MedianRow> | null>(null);

  useEffect(() => {
    let alive = true;
    loadMedians().then(m => { if (alive) setMedians(m); });
    return () => { alive = false; };
  }, []);

  const suggestFor = useCallback((activityType: string | null | undefined): number => {
    if (!activityType || !medians) return ESTIMATE_FALLBACK_MIN;
    const row = medians[activityType];
    if (!row) return ESTIMATE_FALLBACK_MIN;
    return snapEstimate(row.median_minutes);
  }, [medians]);

  /** Amostra por trás da sugestão (para o tooltip "baseado em N execuções"). */
  const samplesFor = useCallback((activityType: string | null | undefined): number => {
    if (!activityType || !medians) return 0;
    return medians[activityType]?.samples || 0;
  }, [medians]);

  return { ready: medians !== null, suggestFor, samplesFor };
}

/**
 * Tempo total já cronometrado numa atividade (segundos ativos, todas as sessões).
 * Recarrega quando o id muda; `refresh` serve para depois de pausar/concluir.
 */
export function useActivitySpentSeconds(activityId: string | null | undefined, enabled = true) {
  const [seconds, setSeconds] = useState(0);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!activityId || !enabled) { setSeconds(0); return; }
    const req = ++reqRef.current;
    try {
      await ensureExternalSession();
      const { data } = await (externalSupabase as any)
        .from('activity_time_entries')
        .select('active_seconds')
        .eq('activity_id', activityId);
      if (req !== reqRef.current) return; // resposta de atividade já trocada
      const total = ((data || []) as { active_seconds: number | null }[])
        .reduce((sum, r) => sum + (r.active_seconds || 0), 0);
      setSeconds(total);
    } catch {
      if (req === reqRef.current) setSeconds(0);
    }
  }, [activityId, enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { spentSeconds: seconds, refreshSpent: refresh };
}

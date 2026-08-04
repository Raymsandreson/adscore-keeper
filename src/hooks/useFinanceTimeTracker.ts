import { useEffect, useRef } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';
import { useLeadActivities } from '@/hooks/useLeadActivities';
import { useAuthContext } from '@/contexts/AuthContext';

/**
 * Conta o tempo de REGISTRO no controle financeiro no cronômetro, sem criar uma
 * atividade por lançamento. Mesmo modelo do atendimento no WhatsApp
 * (useWhatsAppTimeTracker): uma atividade guarda-chuva por DIA ("Controle
 * Financeiro — DD/MM/AAAA"), interna (is_management), atribuída a quem registrou.
 *
 * `trackFinanceEntry()` é chamado a cada registro REALMENTE gravado: categorizar
 * transação, salvar lançamento financeiro (geral ou do lead).
 * Regras (idênticas às do WhatsApp):
 * - Se já está cronometrando a guarda-chuva → só renova o "último registro".
 * - Se há OUTRA atividade específica aberta (um caso) → ela tem prioridade.
 * - Se está em pausa/almoço (break) → respeita a pausa.
 * - Se está ocioso/parado → garante a guarda-chuva do dia e inicia o cronômetro nela.
 *
 * É função imperativa (não hook) de propósito: o registro acontece dentro de
 * handlers e de hooks de dados (useExpenseCategories) espalhados por ~6 telas do
 * financeiro. O acesso ao cronômetro vem do bridge abaixo, montado uma única vez
 * no ActivityTimerOverlay.
 *
 * O watchdog (useFinanceUmbrellaWatchdog, no mesmo overlay) pausa a guarda-chuva
 * após REGISTER_IDLE_MS sem NENHUM registro — mesmo que o usuário continue
 * mexendo no sistema — e o cronômetro volta ao estado ocioso (gap). Cobre também
 * quem sai da tela do financeiro: sem registro em 5 min → ocioso de novo.
 */

const UMBRELLA_PREFIX = 'Controle Financeiro — ';
/** 5 min sem registrar nada → a guarda-chuva pausa e volta pro ocioso. */
const REGISTER_IDLE_MS = 5 * 60 * 1000;
/** Frequência de checagem do watchdog. */
const WATCHDOG_TICK_MS = 30 * 1000;

// Estado compartilhado entre as telas (registram) e o watchdog global.
// Módulo-level de propósito: sobrevive a desmontagens das telas do financeiro.
const finTracking = {
  umbrellaId: null as string | null,
  lastRegisterAt: 0,
};

type TimerLike = {
  kind: 'activity' | 'gap' | 'break';
  activityId: string | null;
  activityTitle: string;
} | null;

// Ponte com o cronômetro: preenchida pelo hook montado no overlay.
const bridge = {
  ready: false,
  current: null as TimerLike,
  startTimer: null as ((a: { id: string; title: string; activity_type: string; lead_name: string | null }) => Promise<void>) | null,
  createActivity: null as ((a: Record<string, unknown>) => Promise<unknown>) | null,
  userId: null as string | null,
  userName: null as string | null,
};

function todayTitle(): string {
  const d = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `${UMBRELLA_PREFIX}${d}`;
}

/** Busca (ou cria) a atividade guarda-chuva de hoje deste usuário. */
async function ensureTodayUmbrella(): Promise<{ id: string; title: string; activity_type: string } | null> {
  if (!bridge.userId) return null;
  const title = todayTitle();

  // Já existe a de hoje? (reaproveita a mesma linha o dia todo)
  try {
    await ensureExternalSession(); // sem sessão, o RLS devolve 0 linhas em silêncio
    const extUserId = await remapToExternal(bridge.userId);
    let q = externalSupabase
      .from('lead_activities')
      .select('id, title, activity_type')
      .eq('title', title)
      .is('deleted_at', null)
      .limit(1);
    if (extUserId) q = q.eq('created_by', extUserId);
    const { data } = await q;
    const found = (data || [])[0] as { id: string; title: string; activity_type: string } | undefined;
    if (found?.id) return { id: found.id, title: found.title, activity_type: found.activity_type || 'tarefa' };
  } catch { /* segue para criar */ }

  // Cria a guarda-chuva do dia (interna, atribuída a quem registrou).
  const created: any = await bridge.createActivity?.({
    title,
    activity_type: 'tarefa',
    is_management: true,
    assigned_to: bridge.userId,
    assigned_to_name: bridge.userName || undefined,
  });
  if (created?.id) return { id: created.id, title, activity_type: 'tarefa' };
  return null;
}

/**
 * Registrou algo no controle financeiro → conta o tempo na guarda-chuva do dia.
 * Chamar SÓ depois da gravação dar certo. Nunca lança: falha aqui não pode
 * derrubar o salvamento de quem chamou.
 */
export async function trackFinanceEntry(): Promise<void> {
  if (!bridge.ready || !bridge.userId) return;

  // Todo registro renova o relógio do watchdog — inclusive com o timer já rodando.
  finTracking.lastRegisterAt = Date.now();

  const c = bridge.current;
  // Já contando a guarda-chuva → o timer segue; só o lastRegisterAt importava.
  if (c?.kind === 'activity' && c.activityId && c.activityId === finTracking.umbrellaId) return;
  // Outra atividade específica aberta → prioridade dela.
  if (c?.kind === 'activity') return;
  // Pausa/almoço → respeita.
  if (c?.kind === 'break') return;

  // Aqui: current é null (parado) ou 'gap' (ocioso) → inicia a guarda-chuva.
  try {
    const umbrella = await ensureTodayUmbrella();
    if (umbrella) {
      finTracking.umbrellaId = umbrella.id;
      await bridge.startTimer?.({ id: umbrella.id, title: umbrella.title, activity_type: umbrella.activity_type, lead_name: null });
    }
  } catch (e) {
    console.warn('[useFinanceTimeTracker] falha ao iniciar registro financeiro:', e);
  }
}

/**
 * Bridge + watchdog global da guarda-chuva do financeiro. Montar num componente
 * SEMPRE presente (ActivityTimerOverlay):
 * - mantém o bridge atualizado (cronômetro atual, startTimer, createActivity, usuário);
 * - se o cronômetro está na guarda-chuva e não há registro há REGISTER_IDLE_MS,
 *   pausa (stopTimerFor → volta ao ocioso/gap).
 * Detecta pela id registrada OU pelo prefixo do título (cobre reload da página,
 * quando o timer é retomado mas o estado local do módulo zera).
 */
export function useFinanceUmbrellaWatchdog() {
  const { current, startTimer, stopTimerFor } = useActivityTimer();
  const { createActivity } = useLeadActivities();
  const { user, profile } = useAuthContext();

  const createActivityRef = useRef(createActivity);
  createActivityRef.current = createActivity;

  bridge.current = current as TimerLike;
  bridge.startTimer = startTimer;
  bridge.createActivity = (a) => createActivityRef.current(a as any);
  bridge.userId = user?.id || null;
  bridge.userName = profile?.full_name || null;
  bridge.ready = !!user;

  const umbrellaActivityId =
    current?.kind === 'activity' && current.activityId &&
    (current.activityId === finTracking.umbrellaId || (current.activityTitle || '').startsWith(UMBRELLA_PREFIX))
      ? current.activityId
      : null;

  useEffect(() => {
    if (!umbrellaActivityId) return;
    const id = setInterval(() => {
      if (Date.now() - finTracking.lastRegisterAt >= REGISTER_IDLE_MS) {
        // Sem registro há 5 min (ou reload sem novo registro) → pausa e vira ocioso.
        stopTimerFor(umbrellaActivityId);
      }
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [umbrellaActivityId, stopTimerFor]);
}

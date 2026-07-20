import { useCallback, useEffect } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';
import { useLeadActivities } from '@/hooks/useLeadActivities';
import { useAuthContext } from '@/contexts/AuthContext';

/**
 * Conta o tempo de ATENDIMENTO no WhatsApp no cronômetro, sem criar uma atividade
 * por cliente. Modelo: uma atividade guarda-chuva por DIA ("Atendimento WhatsApp —
 * DD/MM/AAAA"), interna (is_management), atribuída a quem está atendendo.
 *
 * `trackClientReply()` é chamado a cada mensagem REALMENTE enviada a um cliente.
 * Regras:
 * - Se já está cronometrando a guarda-chuva → só renova o "último envio".
 * - Se há OUTRA atividade específica aberta (um caso) → ela tem prioridade.
 * - Se está em pausa/almoço (break) → respeita a pausa.
 * - Se está ocioso/parado → garante a guarda-chuva do dia e inicia o cronômetro nela.
 *
 * O watchdog (useWhatsAppUmbrellaWatchdog, montado globalmente no overlay) pausa a
 * guarda-chuva após SEND_IDLE_MS sem NENHUM envio — mesmo que o usuário continue
 * mexendo no sistema — e o cronômetro volta ao estado ocioso (gap). Isso cobre
 * também quem sai da tela do WhatsApp: sem envio em 5 min → ocioso de novo.
 */

const UMBRELLA_PREFIX = 'Atendimento WhatsApp — ';
/** 5 min sem enviar mensagem → a guarda-chuva pausa e volta pro ocioso. */
const SEND_IDLE_MS = 5 * 60 * 1000;
/** Frequência de checagem do watchdog. */
const WATCHDOG_TICK_MS = 30 * 1000;

// Estado compartilhado entre o chat (registra envios) e o watchdog global.
// Módulo-level de propósito: sobrevive a desmontagens do WhatsAppChat
// (troca de conversa / sair da tela) sem depender do ciclo de vida dele.
const waTracking = {
  umbrellaId: null as string | null,
  lastSendAt: 0,
};

function todayTitle(): string {
  const d = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `${UMBRELLA_PREFIX}${d}`;
}

export function useWhatsAppTimeTracker() {
  const { current, startTimer } = useActivityTimer();
  const { createActivity } = useLeadActivities();
  const { user, profile } = useAuthContext();

  /** Busca (ou cria) a atividade guarda-chuva de hoje deste usuário. */
  const ensureTodayUmbrella = useCallback(async (): Promise<{ id: string; title: string; activity_type: string } | null> => {
    if (!user) return null;
    const title = todayTitle();
    const extUserId = await remapToExternal(user.id);

    // Já existe a de hoje? (reaproveita a mesma linha o dia todo)
    try {
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

    // Cria a guarda-chuva do dia (interna, atribuída a quem atende).
    const created: any = await createActivity({
      title,
      activity_type: 'tarefa',
      is_management: true,
      assigned_to: user.id,
      assigned_to_name: profile?.full_name || undefined,
    } as any);
    if (created?.id) return { id: created.id, title, activity_type: 'tarefa' };
    return null;
  }, [user, profile, createActivity]);

  const trackClientReply = useCallback(async () => {
    if (!user) return;

    // Todo envio renova o relógio do watchdog — inclusive com o timer já rodando.
    waTracking.lastSendAt = Date.now();

    const c = current;
    // Já contando a guarda-chuva → o timer segue; só o lastSendAt importava.
    if (c?.kind === 'activity' && c.activityId && c.activityId === waTracking.umbrellaId) return;
    // Outra atividade específica aberta → prioridade dela.
    if (c?.kind === 'activity') return;
    // Pausa/almoço → respeita.
    if (c?.kind === 'break') return;

    // Aqui: current é null (parado) ou 'gap' (ocioso) → inicia a guarda-chuva.
    try {
      const umbrella = await ensureTodayUmbrella();
      if (umbrella) {
        waTracking.umbrellaId = umbrella.id;
        await startTimer({ id: umbrella.id, title: umbrella.title, activity_type: umbrella.activity_type, lead_name: null });
      }
    } catch (e) {
      console.warn('[useWhatsAppTimeTracker] falha ao iniciar atendimento:', e);
    }
  }, [user, current, startTimer, ensureTodayUmbrella]);

  return { trackClientReply };
}

/**
 * Watchdog global da guarda-chuva de atendimento. Montar num componente SEMPRE
 * presente (ActivityTimerOverlay): se o cronômetro está na guarda-chuva e não há
 * envio de mensagem há SEND_IDLE_MS, pausa (stopTimerFor → volta ao ocioso/gap).
 * Detecta pela id registrada OU pelo prefixo do título (cobre reload da página,
 * quando o timer é retomado mas o estado local do módulo zera).
 */
export function useWhatsAppUmbrellaWatchdog() {
  const { current, stopTimerFor } = useActivityTimer();

  const umbrellaActivityId =
    current?.kind === 'activity' && current.activityId &&
    (current.activityId === waTracking.umbrellaId || (current.activityTitle || '').startsWith(UMBRELLA_PREFIX))
      ? current.activityId
      : null;

  useEffect(() => {
    if (!umbrellaActivityId) return;
    const id = setInterval(() => {
      if (Date.now() - waTracking.lastSendAt >= SEND_IDLE_MS) {
        // Sem envio há 5 min (ou reload sem novo envio) → pausa e vira ocioso.
        stopTimerFor(umbrellaActivityId);
      }
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [umbrellaActivityId, stopTimerFor]);
}

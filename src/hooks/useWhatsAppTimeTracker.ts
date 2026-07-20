import { useCallback, useRef } from 'react';
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
 * - Se já está cronometrando a guarda-chuva → nada (o timer roda e a interação
 *   global do usuário já o mantém vivo; o ocioso de 5 min pausa quando ele para).
 * - Se há OUTRA atividade específica aberta (um caso) → ela tem prioridade.
 * - Se está em pausa/almoço (break) → respeita a pausa.
 * - Se está ocioso/parado → garante a guarda-chuva do dia e inicia o cronômetro nela.
 */
export function useWhatsAppTimeTracker() {
  const { current, startTimer } = useActivityTimer();
  const { createActivity } = useLeadActivities();
  const { user, profile } = useAuthContext();

  // Id da guarda-chuva do dia já resolvida (evita query/insert a cada envio).
  const umbrellaIdRef = useRef<string | null>(null);
  // Evita disparos concorrentes enquanto o startTimer/insert está em voo.
  const busyRef = useRef(false);

  const todayTitle = useCallback(() => {
    const d = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `Atendimento WhatsApp — ${d}`;
  }, []);

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
  }, [user, profile, createActivity, todayTitle]);

  const trackClientReply = useCallback(async () => {
    if (!user || busyRef.current) return;

    const c = current;
    // Já contando a guarda-chuva → o timer cuida do resto.
    if (c?.kind === 'activity' && c.activityId && c.activityId === umbrellaIdRef.current) return;
    // Outra atividade específica aberta → prioridade dela.
    if (c?.kind === 'activity') return;
    // Pausa/almoço → respeita.
    if (c?.kind === 'break') return;

    // Aqui: current é null (parado) ou 'gap' (ocioso) → inicia a guarda-chuva.
    busyRef.current = true;
    try {
      const umbrella = await ensureTodayUmbrella();
      if (umbrella) {
        umbrellaIdRef.current = umbrella.id;
        await startTimer({ id: umbrella.id, title: umbrella.title, activity_type: umbrella.activity_type, lead_name: null });
      }
    } catch (e) {
      console.warn('[useWhatsAppTimeTracker] falha ao iniciar atendimento:', e);
    } finally {
      busyRef.current = false;
    }
  }, [user, current, startTimer, ensureTodayUmbrella]);

  return { trackClientReply };
}

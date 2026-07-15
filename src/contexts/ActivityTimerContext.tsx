import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';

// activity_time_entries ainda não está nos types gerados — acesso destipado.
const dbAny = db as unknown as SupabaseClient;

/**
 * Cronômetro de atividades — banco de horas.
 *
 * Modelo:
 * - Auto-start ao ABRIR uma atividade. O tempo é ACUMULADO por atividade:
 *   reabrir a mesma atv retoma a contagem de onde parou (mesma linha no banco).
 * - Enquanto a atv está aberta: conta ATIVO se a aba está visível/focada e
 *   houve interação nos últimos IDLE_THRESHOLD; senão conta OCIOSO.
 * - Após IDLE_THRESHOLD sem interação → notificação de sistema + dialog
 *   "Ainda está fazendo X?": Sim volta a contar; Não fecha/salva e abre o
 *   seletor "qual atividade agora?".
 * - Ao SAIR da atv (fechar) → dialog "Continuar contando ou pausar?".
 * - CONCLUIR encerra o cronômetro da atv (igual pausar).
 * - O tempo ENTRE atividades (nenhuma aberta, mas presente na tela) é
 *   contabilizado como OCIOSIDADE do membro (linha de gap, activity_id null).
 * - Persiste no Externo (activity_time_entries), flush absoluto a cada 30s.
 */

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min sem interação
const FLUSH_INTERVAL_MS = 30 * 1000;
const GAP_TITLE = 'Ocioso (entre atividades)';

export interface TimerActivityRef {
  id: string;
  activity_type?: string | null;
  title?: string | null;
  lead_name?: string | null;
}

interface TimerEntry {
  kind: 'activity' | 'gap';
  entryId: string;
  activityId: string | null;
  activityType: string;
  activityTitle: string;
  leadName: string | null;
  userId: string;
  userName: string;
  activeSeconds: number;
  idleSeconds: number;
  status: 'running' | 'paused';
}

interface ActivityTimerCtx {
  current: TimerEntry | null;
  idlePrompt: boolean;
  leavePrompt: boolean;
  switchPrompt: boolean;
  startTimer: (activity: TimerActivityRef) => Promise<void>;
  /** Fecha o sheet → abre o prompt continuar/pausar. */
  requestLeave: () => void;
  keepRunning: () => void;
  pauseAndClose: () => Promise<void>;
  /** Encerra o cronômetro de uma atv específica (ex.: ao concluir). */
  stopTimerFor: (activityId: string) => Promise<void>;
  confirmStillWorking: () => void;
  rejectStillWorking: () => Promise<void>;
  switchTo: (activity: TimerActivityRef | null) => Promise<void>;
  dismissSwitch: () => void;
  formatHMS: (totalSeconds: number) => string;
}

const Ctx = createContext<ActivityTimerCtx | null>(null);

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

async function resolveUser(): Promise<{ userId: string; userName: string } | null> {
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return null;
  await ensureRemapCache().catch(() => {});
  const extUserId = (await remapToExternal(user.id)) || user.id;

  let name: string | null = null;
  try {
    const { data: extProfile } = await db
      .from('profiles').select('full_name').eq('user_id', extUserId).maybeSingle();
    name = extProfile?.full_name || null;
  } catch { /* ignora */ }
  if (!name) {
    try {
      const { data: cloudProfile } = await authClient
        .from('profiles').select('full_name').eq('user_id', user.id).maybeSingle();
      name = cloudProfile?.full_name || null;
    } catch { /* ignora */ }
  }
  return { userId: extUserId, userName: name || user.email || 'Membro' };
}

function notifyDesktop(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'activity-timer', requireInteraction: true });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') new Notification(title, { body, tag: 'activity-timer', requireInteraction: true });
      });
    }
  } catch { /* sem suporte */ }
}

export function ActivityTimerProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<TimerEntry | null>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [switchPrompt, setSwitchPrompt] = useState(false);

  const entryRef = useRef<TimerEntry | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const awaitingConfirmRef = useRef<boolean>(false);
  const lastFlushRef = useRef<number>(0);
  const busyRef = useRef<boolean>(false);
  const userRef = useRef<{ userId: string; userName: string } | null>(null);

  const getUser = useCallback(async () => {
    if (userRef.current) return userRef.current;
    const u = await resolveUser();
    if (u) userRef.current = u;
    return u;
  }, []);

  const sync = useCallback((e: TimerEntry | null) => {
    entryRef.current = e;
    setCurrent(e ? { ...e } : null);
  }, []);

  const flush = useCallback(async (statusOverride?: 'running' | 'paused' | 'closed') => {
    const e = entryRef.current;
    if (!e) return;
    lastFlushRef.current = Date.now();
    try {
      await dbAny.from('activity_time_entries').update({
        active_seconds: e.activeSeconds,
        idle_seconds: e.idleSeconds,
        ended_at: new Date().toISOString(),
        status: statusOverride ?? e.status,
      }).eq('id', e.entryId);
    } catch (err) {
      console.warn('[activity-timer] flush falhou:', err);
    }
  }, []);

  // ---- Registro de interação (global) ----
  useEffect(() => {
    const mark = () => { lastInteractionRef.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') mark(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', mark);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', mark);
    };
  }, []);

  // ---- Loop de contagem (1s) ----
  useEffect(() => {
    const id = setInterval(() => {
      const e = entryRef.current;
      if (!e || e.status === 'paused') return;

      const now = Date.now();
      const idleFor = now - lastInteractionRef.current;
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      const present = focused && idleFor < IDLE_THRESHOLD_MS;

      const next: TimerEntry = { ...e };

      if (e.kind === 'gap') {
        // Tempo entre atividades: conta ocioso só enquanto presente na tela.
        // Sem prompt (não há atividade aberta).
        if (present) next.idleSeconds += 1;
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      // kind === 'activity'
      const isActive = !awaitingConfirmRef.current && present;
      if (isActive) next.activeSeconds += 1;
      else next.idleSeconds += 1;

      if (!awaitingConfirmRef.current && idleFor >= IDLE_THRESHOLD_MS) {
        awaitingConfirmRef.current = true;
        setIdlePrompt(true);
        notifyDesktop('Cronômetro de atividade', `Ainda está fazendo "${e.activityTitle}"? Confirme para continuar contando.`);
      }

      sync(next);
      if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
    }, 1000);
    return () => clearInterval(id);
  }, [sync, flush]);

  // ---- Flush ao esconder a aba ----
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && entryRef.current) flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flush]);

  // Inicia (ou retoma) o rastreador de ociosidade entre atividades.
  const startGap = useCallback(async () => {
    const u = await getUser();
    if (!u) { sync(null); return; }
    await ensureExternalSession().catch(() => {});
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let entryId: string;
    let idleSeconds = 0;
    try {
      const { data: existing } = await dbAny.from('activity_time_entries')
        .select('id, idle_seconds')
        .eq('user_id', u.userId).is('activity_id', null)
        .gte('started_at', startOfDay.toISOString())
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        entryId = existing.id;
        idleSeconds = existing.idle_seconds || 0;
        await dbAny.from('activity_time_entries')
          .update({ status: 'running', ended_at: new Date().toISOString() }).eq('id', entryId);
      } else {
        const { data, error } = await dbAny.from('activity_time_entries').insert({
          activity_id: null, activity_type: null, activity_title: GAP_TITLE, lead_name: null,
          user_id: u.userId, user_name: u.userName,
          started_at: new Date().toISOString(), active_seconds: 0, idle_seconds: 0, status: 'running',
        }).select('id').single();
        if (error || !data) { sync(null); return; }
        entryId = (data as { id: string }).id;
      }
    } catch { sync(null); return; }

    lastFlushRef.current = Date.now();
    sync({
      kind: 'gap', entryId, activityId: null, activityType: '', activityTitle: GAP_TITLE,
      leadName: null, userId: u.userId, userName: u.userName,
      activeSeconds: 0, idleSeconds, status: 'running',
    });
  }, [getUser, sync]);

  // Finaliza a atv atual (salva) e passa a contar ociosidade entre atividades.
  const finalizeToGap = useCallback(async () => {
    const wasActivity = entryRef.current?.kind === 'activity';
    if (entryRef.current) await flush('paused');
    awaitingConfirmRef.current = false;
    setIdlePrompt(false);
    setLeavePrompt(false);
    setSwitchPrompt(false);
    if (wasActivity) await startGap();
    else sync(null);
  }, [flush, startGap, sync]);

  const startTimer = useCallback(async (activity: TimerActivityRef) => {
    if (!activity?.id) return;

    // Já nesta atv: se pausada, retoma; se rodando, nada.
    if (entryRef.current?.kind === 'activity' && entryRef.current.activityId === activity.id) {
      if (entryRef.current.status === 'paused') {
        lastInteractionRef.current = Date.now();
        awaitingConfirmRef.current = false;
        sync({ ...entryRef.current, status: 'running' });
        flush('running');
      }
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // Encerra o que estava rodando (outra atv ou o gap) salvando o tempo.
      if (entryRef.current) await flush('paused');

      await ensureExternalSession().catch(() => {});
      const u = await getUser();
      if (!u) { console.warn('[activity-timer] sem usuário — timer não iniciado'); sync(null); return; }

      // Retoma a linha existente desta atv (acumula de onde parou) ou cria nova.
      let entryId: string;
      let activeSeconds = 0;
      let idleSeconds = 0;
      const { data: existing } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds')
        .eq('activity_id', activity.id).eq('user_id', u.userId)
        .order('started_at', { ascending: false }).limit(1).maybeSingle();

      if (existing) {
        entryId = existing.id;
        activeSeconds = existing.active_seconds || 0;
        idleSeconds = existing.idle_seconds || 0;
        await dbAny.from('activity_time_entries')
          .update({ status: 'running', ended_at: new Date().toISOString() }).eq('id', entryId);
      } else {
        const { data, error } = await dbAny.from('activity_time_entries').insert({
          activity_id: activity.id,
          activity_type: activity.activity_type || null,
          activity_title: activity.title || null,
          lead_name: activity.lead_name || null,
          user_id: u.userId, user_name: u.userName,
          started_at: new Date().toISOString(), active_seconds: 0, idle_seconds: 0, status: 'running',
        }).select('id').single();
        if (error || !data) { console.warn('[activity-timer] insert falhou:', error); return; }
        entryId = (data as { id: string }).id;
      }

      lastInteractionRef.current = Date.now();
      awaitingConfirmRef.current = false;
      lastFlushRef.current = Date.now();
      setIdlePrompt(false);
      setLeavePrompt(false);
      sync({
        kind: 'activity', entryId, activityId: activity.id,
        activityType: activity.activity_type || '', activityTitle: activity.title || 'Atividade',
        leadName: activity.lead_name || null, userId: u.userId, userName: u.userName,
        activeSeconds, idleSeconds, status: 'running',
      });

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } finally {
      busyRef.current = false;
    }
  }, [getUser, sync, flush]);

  const requestLeave = useCallback(() => {
    if (entryRef.current?.kind === 'activity') setLeavePrompt(true);
  }, []);

  const keepRunning = useCallback(() => setLeavePrompt(false), []);

  const pauseAndClose = useCallback(async () => {
    await finalizeToGap();
  }, [finalizeToGap]);

  const stopTimerFor = useCallback(async (activityId: string) => {
    if (entryRef.current?.kind === 'activity' && entryRef.current.activityId === activityId) {
      await finalizeToGap();
    }
  }, [finalizeToGap]);

  const confirmStillWorking = useCallback(() => {
    awaitingConfirmRef.current = false;
    lastInteractionRef.current = Date.now();
    setIdlePrompt(false);
  }, []);

  const rejectStillWorking = useCallback(async () => {
    await finalizeToGap();
    setSwitchPrompt(true);
  }, [finalizeToGap]);

  const switchTo = useCallback(async (activity: TimerActivityRef | null) => {
    setSwitchPrompt(false);
    if (activity) await startTimer(activity);
  }, [startTimer]);

  const dismissSwitch = useCallback(() => setSwitchPrompt(false), []);

  const value: ActivityTimerCtx = {
    current, idlePrompt, leavePrompt, switchPrompt,
    startTimer, requestLeave, keepRunning, pauseAndClose, stopTimerFor,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch,
    formatHMS,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivityTimer(): ActivityTimerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useActivityTimer deve ser usado dentro de ActivityTimerProvider');
  return ctx;
}

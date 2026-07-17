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
  estimated_minutes?: number | null;
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
  /** Previsão de tempo (min). Gatilho de urgência; null = sem previsão. */
  estimateMinutes: number | null;
}

interface ActivityTimerCtx {
  current: TimerEntry | null;
  /** Última atividade pausada — permite retomar sem reabrir a atv. */
  lastActivity: TimerActivityRef | null;
  /** Retoma o cronômetro da última atividade pausada (acumula de onde parou). */
  resumeLast: () => Promise<void>;
  /** Totais do dia (do membro): produtivo (ativo) e ocioso, ao vivo. */
  dayTotals: { active: number; idle: number };
  hidden: boolean;
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
  hideTimer: () => void;
  showTimer: () => void;
  /** Define/edita a previsão de tempo (min) da atividade atual. */
  setEstimate: (minutes: number | null) => Promise<void>;
  /** Alerta recebido da gestão ("por que está ocioso?"). */
  managerAlert: { from: string | null; message: string | null } | null;
  dismissManagerAlert: () => void;
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

/** Alarme sonoro alto e incômodo (bipes alternados) — usado nos alertas de ociosidade. */
export function playAlarmSound() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctx.resume().catch(() => {});
    const beep = (t: number, freq: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.5, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.28);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    };
    [0, 0.35, 0.7, 1.05, 1.4, 1.75].forEach((t, i) => beep(t, i % 2 ? 660 : 990));
    setTimeout(() => { ctx.close().catch(() => {}); }, 2600);
  } catch { /* sem suporte de áudio */ }
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
  const [dayBase, setDayBase] = useState<{ active: number; idle: number }>({ active: 0, idle: 0 });
  const [hidden, setHidden] = useState(false);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [switchPrompt, setSwitchPrompt] = useState(false);

  const entryRef = useRef<TimerEntry | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const awaitingConfirmRef = useRef<boolean>(false);
  const lastFlushRef = useRef<number>(0);
  const busyRef = useRef<boolean>(false);
  const userRef = useRef<{ userId: string; userName: string } | null>(null);
  const lastActivityRef = useRef<TimerActivityRef | null>(null);
  const [lastActivity, setLastActivity] = useState<TimerActivityRef | null>(null);
  const [managerAlert, setManagerAlert] = useState<{ from: string | null; message: string | null } | null>(null);
  const dismissManagerAlert = useCallback(() => setManagerAlert(null), []);

  // Guarda a atv que estava rodando como "última" (para o botão Retomar).
  const rememberLast = useCallback(() => {
    const e = entryRef.current;
    if (e?.kind !== 'activity' || !e.activityId) return;
    const ref: TimerActivityRef = {
      id: e.activityId,
      activity_type: e.activityType || null,
      title: e.activityTitle || null,
      lead_name: e.leadName,
      estimated_minutes: e.estimateMinutes,
    };
    lastActivityRef.current = ref;
    setLastActivity(ref);
  }, []);
  const nearNotifiedRef = useRef<boolean>(false); // aviso "se aproximando" já disparado
  const overNotifiedRef = useRef<boolean>(false);  // aviso "passou da previsão" já disparado

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

  // Soma todas as sessões de HOJE do membro, exceto a atual (contada ao vivo).
  const refreshDayBase = useCallback(async () => {
    const u = await getUser();
    if (!u) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    try {
      const { data } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds')
        .eq('user_id', u.userId)
        .gte('started_at', startOfDay.toISOString());
      const curId = entryRef.current?.entryId;
      let active = 0, idle = 0;
      for (const r of ((data as { id: string; active_seconds: number; idle_seconds: number }[]) || [])) {
        if (r.id === curId) continue; // a atual entra ao vivo
        active += r.active_seconds || 0;
        idle += r.idle_seconds || 0;
      }
      setDayBase({ active, idle });
    } catch { /* mantém o valor atual */ }
  }, [getUser]);

  // Atualiza a base do dia ao mudar de sessão e periodicamente.
  useEffect(() => {
    refreshDayBase();
    const id = setInterval(refreshDayBase, 60000);
    return () => clearInterval(id);
  }, [current?.entryId, refreshDayBase]);

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

  // ---- Loop de contagem (usa delta de wall-clock p/ sobreviver a throttling em abas ocultas) ----
  useEffect(() => {
    let lastTick = Date.now();
    const id = setInterval(() => {
      const e = entryRef.current;
      const now = Date.now();
      const deltaSec = Math.max(0, Math.round((now - lastTick) / 1000));
      lastTick = now;
      if (!e || e.status === 'paused' || deltaSec === 0) return;

      const idleFor = now - lastInteractionRef.current;
      const next: TimerEntry = { ...e };

      if (e.kind === 'gap') {
        // Tempo entre atividades: conta ocioso enquanto não pausado (independe de foco).
        next.idleSeconds += deltaSec;
        // Alerta automático a cada 5 min de ociosidade (som alto + notificação).
        if (Math.floor(next.idleSeconds / 300) > Math.floor(e.idleSeconds / 300)) {
          playAlarmSound();
          notifyDesktop('⏰ Você está ocioso', `Ocioso há ${Math.round(next.idleSeconds / 60)} min — abra ou retome uma atividade.`);
        }
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      // kind === 'activity': segue contando mesmo com aba oculta.
      // Só entra em ociosidade se o usuário ficou sem interagir por muito tempo.
      const isActive = !awaitingConfirmRef.current;
      if (isActive) next.activeSeconds += deltaSec;
      else next.idleSeconds += deltaSec;

      // Com PREVISÃO definida e ainda dentro dela, não perturba com o check
      // de 5 min — a pergunta "ainda está fazendo?" só vem quando a previsão acaba.
      const estSec = next.estimateMinutes && next.estimateMinutes > 0 ? next.estimateMinutes * 60 : 0;
      const withinEstimate = estSec > 0 && next.activeSeconds < estSec;

      if (!awaitingConfirmRef.current && idleFor >= IDLE_THRESHOLD_MS && !withinEstimate) {
        awaitingConfirmRef.current = true;
        setIdlePrompt(true);
        playAlarmSound();
        notifyDesktop('Cronômetro de atividade', `Ainda está fazendo "${e.activityTitle}"? Confirme para continuar contando.`);
      }

      // Gatilho de urgência da previsão (compara com o tempo ATIVO).
      if (estSec > 0) {
        if (next.activeSeconds >= estSec) {
          if (!overNotifiedRef.current) {
            overNotifiedRef.current = true;
            nearNotifiedRef.current = true;
            notifyDesktop('⏰ Previsão estourada', `"${e.activityTitle}" passou da previsão de ${next.estimateMinutes} min. Ainda está nessa atividade?`);
            // Fim do tempo previsto → pergunta se continua ou se já era.
            awaitingConfirmRef.current = true;
            setIdlePrompt(true);
          }
        } else if (next.activeSeconds >= estSec * 0.8 && !nearNotifiedRef.current) {
          nearNotifiedRef.current = true;
          const faltam = Math.max(1, Math.round((estSec - next.activeSeconds) / 60));
          notifyDesktop('⚠️ Previsão se aproximando', `Faltam ~${faltam} min para a previsão de "${e.activityTitle}".`);
        }
      }

      sync(next);
      if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
    }, 1000);
    return () => clearInterval(id);
  }, [sync, flush]);

  // ---- Alertas da gestão ("por que está ocioso?") via realtime ----
  useEffect(() => {
    let channel: ReturnType<typeof dbAny.channel> | null = null;
    let cancelled = false;
    (async () => {
      await ensureExternalSession().catch(() => {});
      const u = await getUser();
      if (!u || cancelled) return;
      channel = dbAny
        .channel('activity-timer-alerts')
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'activity_timer_alerts',
          filter: `to_user_id=eq.${u.userId}`,
        }, (payload: { new: { id: string; from_name: string | null; message: string | null } }) => {
          setManagerAlert({ from: payload.new.from_name, message: payload.new.message });
          playAlarmSound();
          notifyDesktop('🚨 Chamado da gestão', `${payload.new.from_name || 'Gestão'}: ${payload.new.message || 'Por que você está ocioso?'}`);
          dbAny.from('activity_timer_alerts')
            .update({ seen_at: new Date().toISOString() })
            .eq('id', payload.new.id)
            .then(() => {}, () => {});
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) dbAny.removeChannel(channel);
    };
  }, [getUser]);

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
      activeSeconds: 0, idleSeconds, status: 'running', estimateMinutes: null,
    });
  }, [getUser, sync]);

  // Finaliza a atv atual (salva) e passa a contar ociosidade entre atividades.
  const finalizeToGap = useCallback(async () => {
    const wasActivity = entryRef.current?.kind === 'activity';
    rememberLast();
    if (entryRef.current) await flush('paused');
    awaitingConfirmRef.current = false;
    setIdlePrompt(false);
    setLeavePrompt(false);
    setSwitchPrompt(false);
    if (wasActivity) await startGap();
    else sync(null);
  }, [flush, startGap, sync, rememberLast]);

  const showTimer = useCallback(() => setHidden(false), []);
  const hideTimer = useCallback(() => setHidden(true), []);

  const startTimer = useCallback(async (activity: TimerActivityRef) => {
    if (!activity?.id) return;

    // Sempre mostra o badge ao iniciar/trocar de atividade.
    showTimer();

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
      rememberLast();
      if (entryRef.current) await flush('paused');

      await ensureExternalSession().catch(() => {});
      const u = await getUser();
      if (!u) { console.warn('[activity-timer] sem usuário — timer não iniciado'); sync(null); return; }

      // Retoma a linha existente desta atv (acumula de onde parou) ou cria nova.
      // Busca TODAS as linhas dessa atv e usa a com maior active_seconds
      // (defesa contra linhas duplicadas antigas que zerariam a contagem).
      let entryId: string;
      let activeSeconds = 0;
      let idleSeconds = 0;
      let estimateMinutes: number | null = activity.estimated_minutes ?? null;
      const { data: rows } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds, started_at, estimated_minutes')
        .eq('activity_id', activity.id).eq('user_id', u.userId)
        .order('active_seconds', { ascending: false })
        .limit(10);
      const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

      if (existing) {
        entryId = existing.id;
        activeSeconds = existing.active_seconds || 0;
        idleSeconds = existing.idle_seconds || 0;
        if (existing.estimated_minutes != null) estimateMinutes = existing.estimated_minutes;
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
          estimated_minutes: estimateMinutes,
        }).select('id').single();
        if (error || !data) { console.warn('[activity-timer] insert falhou:', error); return; }
        entryId = (data as { id: string }).id;
      }

      lastInteractionRef.current = Date.now();
      awaitingConfirmRef.current = false;
      lastFlushRef.current = Date.now();
      nearNotifiedRef.current = false;
      overNotifiedRef.current = false;
      setIdlePrompt(false);
      setLeavePrompt(false);
      sync({
        kind: 'activity', entryId, activityId: activity.id,
        activityType: activity.activity_type || '', activityTitle: activity.title || 'Atividade',
        leadName: activity.lead_name || null, userId: u.userId, userName: u.userName,
        activeSeconds, idleSeconds, status: 'running', estimateMinutes,
      });

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } finally {
      busyRef.current = false;
    }
  }, [getUser, sync, flush, showTimer, rememberLast]);

  const resumeLast = useCallback(async () => {
    if (lastActivityRef.current) await startTimer(lastActivityRef.current);
  }, [startTimer]);

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
    if (activity) {
      showTimer();
      await startTimer(activity);
    }
  }, [startTimer, showTimer]);

  const dismissSwitch = useCallback(() => setSwitchPrompt(false), []);

  const setEstimate = useCallback(async (minutes: number | null) => {
    const e = entryRef.current;
    if (!e || e.kind !== 'activity') return;
    const value = minutes && minutes > 0 ? Math.round(minutes) : null;
    // Reavalia os avisos de urgência com a nova previsão.
    const estSec = value ? value * 60 : 0;
    overNotifiedRef.current = !!value && e.activeSeconds >= estSec;
    nearNotifiedRef.current = !!value && e.activeSeconds >= estSec * 0.8;
    sync({ ...e, estimateMinutes: value });
    try {
      await dbAny.from('activity_time_entries')
        .update({ estimated_minutes: value }).eq('id', e.entryId);
    } catch (err) {
      console.warn('[activity-timer] setEstimate falhou:', err);
    }
  }, [sync]);

  const dayTotals = {
    active: dayBase.active + (current?.activeSeconds || 0),
    idle: dayBase.idle + (current?.idleSeconds || 0),
  };

  const value: ActivityTimerCtx = {
    current, lastActivity, resumeLast, dayTotals, hidden, idlePrompt, leavePrompt, switchPrompt,
    startTimer, requestLeave, keepRunning, pauseAndClose, stopTimerFor,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch,
    hideTimer, showTimer, setEstimate, managerAlert, dismissManagerAlert, formatHMS,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivityTimer(): ActivityTimerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useActivityTimer deve ser usado dentro de ActivityTimerProvider');
  return ctx;
}

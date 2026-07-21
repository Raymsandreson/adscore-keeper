import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
 * - O tempo ENTRE atividades (nenhuma aberta) cai na linha de gap
 *   (activity_id null) e conta SEMPRE como OCIOSO: sem atividade vinculada não
 *   há como justificar o tempo pela natureza do trabalho. Interação recente só
 *   muda a mensagem (trabalhando sem vínculo x parado) e o prompt que abre —
 *   quem está trabalhando é cobrado a vincular/criar a atividade.
 * - Persiste no Externo (activity_time_entries), flush absoluto a cada 30s.
 */

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min sem interação
const FLUSH_INTERVAL_MS = 30 * 1000;
const GAP_TITLE = 'Ocioso (entre atividades)';
// Coordenação entre abas: só UMA aba comanda o cronômetro por vez.
const TAB_ID = Math.random().toString(36).slice(2);
const OWNER_CHANNEL = 'activity-timer-owner';

export interface TimerActivityRef {
  id: string;
  activity_type?: string | null;
  title?: string | null;
  lead_name?: string | null;
  estimated_minutes?: number | null;
}

export type BreakType = 'almoco' | 'intervalo' | 'compensacao' | 'cafe' | 'lanche' | 'descanso';
export const BREAK_LABELS: Record<BreakType, string> = {
  almoco: 'Almoço',
  intervalo: 'Intervalo',
  compensacao: 'Compensação de horas',
  cafe: 'Café',
  lanche: 'Lanche',
  descanso: 'Descanso',
};
/** Pausas rápidas: opções de previsão de retorno (min). Mais que isso → Intervalo. */
export const QUICK_PAUSES: { type: BreakType; emoji: string; etas: number[] }[] = [
  { type: 'cafe', emoji: '☕', etas: [5, 10] },
  { type: 'lanche', emoji: '🥪', etas: [10, 15] },
  { type: 'descanso', emoji: '😌', etas: [5, 10] },
];

interface TimerEntry {
  kind: 'activity' | 'gap' | 'break';
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
  /** Pausa justificada em andamento (kind === 'break'). */
  breakType?: BreakType | null;
  breakNote?: string | null;
  /** kind === 'gap': interagindo sem atividade vinculada (só mensagem/prompt — o tempo conta como ocioso do mesmo jeito). */
  gapWorking?: boolean;
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
  /** Pausa justificada. etaMinutes = previsão de retorno (sem apito até estourar). */
  startBreak: (type: BreakType, note?: string, etaMinutes?: number) => Promise<void>;
  /** Retorno da pausa (ex.: retorno do almoço) → volta a contar ocioso. */
  endBreak: () => Promise<void>;
  /** Estende a previsão de retorno da pausa atual em +N min. */
  extendBreak: (minutes: number) => Promise<void>;
  /** Dialog "ocioso — vai se ausentar?" (escolher pausa/justificar/retomar). */
  awayPrompt: boolean;
  dismissAwayPrompt: () => void;
  /** Dialog "sua pausa passou do previsto — voltou?". */
  breakOverdue: boolean;
  /** Expediente (ponto): null = carregando; false = fora do expediente (nada conta). */
  onShift: boolean | null;
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
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

/**
 * Sem atividade aberta (linha de gap), decide se a pessoa está INTERAGINDO com
 * o sistema. NÃO muda a contagem — sem atividade vinculada todo segundo do gap
 * é ocioso — só a mensagem do badge (trabalhando sem vínculo x parado) e o
 * prompt que abre (vincular atividade x registrar pausa). Mesmos critérios do
 * ramo 'activity' (tela bloqueada e máquina suspensa = não interagindo).
 */
export function isGapWorking(opts: { idleFor: number; locked: boolean; deltaSec: number }): boolean {
  const suspended = opts.deltaSec >= 120; // gap grande entre ticks = PC dormiu
  return opts.idleFor < IDLE_THRESHOLD_MS && !opts.locked && !suspended;
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
  // Sempre visível DENTRO do app (a notificação do sistema depende de permissão
  // — sem ela o usuário ouvia o bip e não via mensagem nenhuma).
  try { toast.warning(title, { description: body, duration: 8000 }); } catch { /* fora do Toaster */ }
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
  const lockedRef = useRef<boolean>(false); // tela bloqueada (IdleDetector)
  const lockDetectorRef = useRef<boolean>(false);
  const [onShift, setOnShift] = useState<boolean | null>(null);
  const [awayPrompt, setAwayPrompt] = useState(false);
  const [breakOverdue, setBreakOverdue] = useState(false);
  const breakOverNotifiedRef = useRef<boolean>(false);
  const lastGapNudgeRef = useRef<number>(0);
  const shiftIdRef = useRef<string | null>(null);
  const ownerChRef = useRef<BroadcastChannel | null>(null);
  const otherOwnerRef = useRef<boolean>(false); // outra aba comanda o cronômetro

  // Detector de tela bloqueada (Chrome, requer permissão) — enquanto bloqueado,
  // o tempo conta como OCIOSO. Precisa ser chamado a partir de um gesto do usuário.
  const startLockDetector = useCallback(async () => {
    if (lockDetectorRef.current) return;
    try {
      type IdleDetectorLike = {
        screenState: 'locked' | 'unlocked' | null;
        addEventListener: (t: string, cb: () => void) => void;
        start: (opts: { threshold: number }) => Promise<void>;
      };
      const w = window as unknown as {
        IdleDetector?: { new (): IdleDetectorLike; requestPermission: () => Promise<string> };
      };
      if (!w.IdleDetector) return;
      const perm = await w.IdleDetector.requestPermission();
      if (perm !== 'granted') return;
      const det = new w.IdleDetector();
      det.addEventListener('change', () => {
        const locked = det.screenState === 'locked';
        lockedRef.current = locked;
        if (!locked) lastInteractionRef.current = Date.now(); // desbloqueou = voltou
      });
      await det.start({ threshold: 60000 });
      lockDetectorRef.current = true;
    } catch { /* sem suporte ou permissão negada — segue sem */ }
  }, []);
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

  // Solta o cronômetro desta aba em silêncio (outra aba/janela assumiu).
  const releaseSilently = useCallback(() => {
    otherOwnerRef.current = true;
    awaitingConfirmRef.current = false;
    setIdlePrompt(false); setLeavePrompt(false); setSwitchPrompt(false);
    sync(null);
  }, [sync]);

  // POSSE DETERMINÍSTICA via banco (funciona entre domínios e dispositivos):
  // entre as sessões 'running' deste usuário, a de started_at mais recente vence
  // (desempate por id). As demais cedem. Auto-corrige até sessões que já estavam
  // rodando antes. Retorna false se ESTA aba deve parar de contar.
  const ownershipBusyRef = useRef<boolean>(false);
  const assertOwnership = useCallback(async (): Promise<boolean> => {
    const e = entryRef.current;
    if (!e || ownershipBusyRef.current) return true;
    ownershipBusyRef.current = true;
    try {
      const { data: running } = await dbAny.from('activity_time_entries')
        .select('id, started_at')
        .eq('user_id', e.userId)
        .eq('status', 'running');
      const rows = (running as { id: string; started_at: string }[]) || [];
      const mine = rows.find(r => r.id === e.entryId);
      if (!mine) { releaseSilently(); return false; } // fui pausado por outra janela
      const yieldToNewer = rows.some(r =>
        r.id !== e.entryId &&
        (r.started_at > mine.started_at || (r.started_at === mine.started_at && r.id > e.entryId)),
      );
      if (yieldToNewer) {
        await dbAny.from('activity_time_entries')
          .update({ status: 'paused', ended_at: new Date().toISOString() }).eq('id', e.entryId);
        releaseSilently();
        return false;
      }
      const olders = rows.filter(r => r.id !== e.entryId).map(r => r.id);
      if (olders.length) {
        await dbAny.from('activity_time_entries')
          .update({ status: 'paused', ended_at: new Date().toISOString() }).in('id', olders);
      }
      return true;
    } catch { return true; } finally { ownershipBusyRef.current = false; }
  }, [releaseSilently]);

  const flush = useCallback(async (statusOverride?: 'running' | 'paused' | 'closed') => {
    const e = entryRef.current;
    if (!e) return;
    lastFlushRef.current = Date.now();
    try {
      if (!statusOverride) {
        const stillMine = await assertOwnership();
        if (!stillMine) return;
      }
      await dbAny.from('activity_time_entries').update({
        active_seconds: e.activeSeconds,
        idle_seconds: e.idleSeconds,
        ended_at: new Date().toISOString(),
        status: statusOverride ?? e.status,
      }).eq('id', e.entryId);
    } catch (err) {
      console.warn('[activity-timer] flush falhou:', err);
    }
  }, [assertOwnership]);

  // Assumir a posse: pausa TODAS as outras sessões rodando deste usuário
  // (outras abas/janelas/dispositivos param no próximo heartbeat, ≤30s).
  const pauseOtherSessions = useCallback(async (userId: string, keepId: string) => {
    try {
      await dbAny.from('activity_time_entries')
        .update({ status: 'paused', ended_at: new Date().toISOString() })
        .eq('user_id', userId).eq('status', 'running').neq('id', keepId);
    } catch { /* melhor esforço */ }
  }, []);

  // Soma todas as sessões de HOJE do membro, exceto a atual (contada ao vivo).
  const refreshDayBase = useCallback(async () => {
    const u = await getUser();
    if (!u) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    try {
      const { data } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds, break_type')
        .eq('user_id', u.userId)
        .gte('started_at', startOfDay.toISOString());
      const curId = entryRef.current?.entryId;
      let active = 0, idle = 0;
      for (const r of ((data as { id: string; active_seconds: number; idle_seconds: number; break_type: string | null }[]) || [])) {
        if (r.id === curId) continue; // a atual entra ao vivo
        active += r.active_seconds || 0;
        if (!r.break_type) idle += r.idle_seconds || 0; // pausa justificada não é ocioso
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

  // ---- Coordenação entre abas: só uma aba conta por vez ----
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(OWNER_CHANNEL);
    ownerChRef.current = ch;
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; tabId?: string } | null;
      if (!msg || msg.tabId === TAB_ID) return;
      if (msg.type === 'takeover') {
        // Outra aba assumiu: esta solta o cronômetro em silêncio (sem prompts/bips).
        otherOwnerRef.current = true;
        if (entryRef.current) { flush('paused'); }
        awaitingConfirmRef.current = false;
        setIdlePrompt(false); setLeavePrompt(false); setSwitchPrompt(false);
        sync(null);
      } else if (msg.type === 'ping') {
        if (entryRef.current) ch.postMessage({ type: 'owner-alive', tabId: TAB_ID });
      } else if (msg.type === 'owner-alive') {
        otherOwnerRef.current = true;
      }
    };
    ch.addEventListener('message', onMsg);
    ch.postMessage({ type: 'ping', tabId: TAB_ID });
    return () => { ch.removeEventListener('message', onMsg); ch.close(); ownerChRef.current = null; };
  }, [flush, sync]);

  const announceTakeover = useCallback(() => {
    otherOwnerRef.current = false;
    try { ownerChRef.current?.postMessage({ type: 'takeover', tabId: TAB_ID }); } catch { /* sem canal */ }
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

      if (e.kind === 'break') {
        // Pausa: conta o tempo SEM apito DURANTE a previsão de retorno.
        // Só avisa (uma vez) quando estoura o previsto.
        next.idleSeconds += deltaSec;
        const etaSec = next.estimateMinutes ? next.estimateMinutes * 60 : 0;
        if (etaSec > 0 && next.idleSeconds >= etaSec && !breakOverNotifiedRef.current) {
          breakOverNotifiedRef.current = true;
          setBreakOverdue(true);
          playAlarmSound();
          notifyDesktop('⏰ Sua pausa acabou', `A ${next.activityTitle.toLowerCase()} passou da previsão de ${next.estimateMinutes} min. Voltou ao trabalho?`);
        }
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      if (e.kind === 'gap') {
        // Sem atividade vinculada NADA conta como produtivo — sem uma atv
        // aberta não dá pra justificar o tempo pela natureza do trabalho.
        // Interação recente só muda a mensagem do badge e qual prompt abre.
        const gapWorking = isGapWorking({ idleFor, locked: lockedRef.current, deltaSec });
        next.idleSeconds += deltaSec;
        next.gapWorking = gapWorking; // o badge alterna "sem atividade" x "ocioso"

        // Nudge a cada 5 min de gap: trabalhando sem vínculo → seletor "qual
        // atividade você está fazendo?"; parado de fato → "vai se ausentar?".
        if (next.idleSeconds - lastGapNudgeRef.current >= 300) {
          lastGapNudgeRef.current = next.idleSeconds;
          if (gapWorking) {
            setSwitchPrompt(true);
            playAlarmSound();
            notifyDesktop('⏱️ Sem atividade vinculada', 'Esse tempo NÃO está contando como produtivo. Vincule a atividade que você está fazendo ou crie uma por voz.');
          } else {
            setAwayPrompt(true);
            playAlarmSound();
            notifyDesktop('⏰ Você está ocioso', `Ocioso há ${Math.round(next.idleSeconds / 60)} min. Vai se ausentar? Registre uma pausa ou retome uma atividade.`);
          }
        }
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      // kind === 'activity': segue contando mesmo com aba oculta.
      // Exceções que viram OCIOSO: aguardando confirmação, tela BLOQUEADA,
      // ou máquina SUSPENSA (gap grande entre ticks = PC dormiu/hibernou).
      const suspended = deltaSec >= 120;
      const isActive = !awaitingConfirmRef.current && !lockedRef.current && !suspended;
      if (isActive) next.activeSeconds += deltaSec;
      else next.idleSeconds += deltaSec;

      // Voltou da suspensão → o tempo parado foi pro ocioso; confirma se continua.
      if (suspended && !awaitingConfirmRef.current) {
        awaitingConfirmRef.current = true;
        setIdlePrompt(true);
        notifyDesktop('Cronômetro de atividade', `O computador ficou suspenso ${Math.round(deltaSec / 60)} min (contado como ocioso). Ainda está fazendo "${e.activityTitle}"?`);
      }

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

  // ---- Verificação de posse dedicada (rápida) — cede em ~8s ----
  useEffect(() => {
    const id = setInterval(() => { if (entryRef.current) assertOwnership(); }, 8000);
    return () => clearInterval(id);
  }, [assertOwnership]);

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
  // Só conta ocioso DENTRO do expediente (ponto aberto).
  const startGap = useCallback(async () => {
    if (!shiftIdRef.current) { sync(null); return; }
    const u = await getUser();
    if (!u) { sync(null); return; }
    await ensureExternalSession().catch(() => {});
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let entryId: string;
    let idleSeconds = 0;
    // active_seconds do gap: legado ("trabalho avulso" de antes da regra de
    // vínculo obrigatório). Hoje não cresce mais, mas precisa ser RESTAURADO ao
    // retomar — sem isso o próximo flush gravaria 0 e apagaria o histórico.
    let activeSeconds = 0;
    try {
      const { data: existing } = await dbAny.from('activity_time_entries')
        .select('id, idle_seconds, active_seconds')
        .eq('user_id', u.userId).is('activity_id', null)
        .gte('started_at', startOfDay.toISOString())
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        entryId = existing.id;
        idleSeconds = existing.idle_seconds || 0;
        activeSeconds = existing.active_seconds || 0;
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
    lastGapNudgeRef.current = idleSeconds; // não apita imediatamente ao retomar o gap
    sync({
      kind: 'gap', entryId, activityId: null, activityType: '', activityTitle: GAP_TITLE,
      leadName: null, userId: u.userId, userName: u.userName,
      activeSeconds, idleSeconds, status: 'running', estimateMinutes: null,
      gapWorking: true, // o gap começa logo após uma interação; o loop reavalia em 1s
    });
    announceTakeover();
    pauseOtherSessions(u.userId, entryId);
  }, [getUser, sync, announceTakeover, pauseOtherSessions]);

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
    // Detector de tela bloqueada (precisa de gesto do usuário — este clique serve).
    startLockDetector();

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

      // Bater ponto automático: abrir atividade sem expediente aberto registra a entrada.
      if (!shiftIdRef.current) {
        const { data: ws } = await dbAny.from('work_shifts').insert({
          user_id: u.userId, user_name: u.userName, started_at: new Date().toISOString(),
        }).select('id').single();
        if (ws) { shiftIdRef.current = (ws as { id: string }).id; setOnShift(true); }
      }

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
      announceTakeover();
      pauseOtherSessions(u.userId, entryId);

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } finally {
      busyRef.current = false;
    }
  }, [getUser, sync, flush, showTimer, rememberLast, startLockDetector, announceTakeover]);

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

  // Pausa justificada: fecha o que está rodando e abre a sessão de pausa.
  // etaMinutes = previsão de retorno (sem apito até estourar).
  const startBreak = useCallback(async (type: BreakType, note?: string, etaMinutes?: number) => {
    rememberLast();
    if (entryRef.current) await flush('paused');
    awaitingConfirmRef.current = false;
    breakOverNotifiedRef.current = false;
    setIdlePrompt(false); setLeavePrompt(false); setSwitchPrompt(false);
    setAwayPrompt(false); setBreakOverdue(false);

    await ensureExternalSession().catch(() => {});
    const u = await getUser();
    if (!u) { sync(null); return; }

    // Pausa também abre o expediente se ainda não bateu o ponto.
    if (!shiftIdRef.current) {
      const { data: ws } = await dbAny.from('work_shifts').insert({
        user_id: u.userId, user_name: u.userName, started_at: new Date().toISOString(),
      }).select('id').single();
      if (ws) { shiftIdRef.current = (ws as { id: string }).id; setOnShift(true); }
    }

    const eta = etaMinutes && etaMinutes > 0 ? Math.round(etaMinutes) : null;
    const { data, error } = await dbAny.from('activity_time_entries').insert({
      activity_id: null, activity_type: null,
      activity_title: BREAK_LABELS[type], lead_name: null,
      user_id: u.userId, user_name: u.userName,
      started_at: new Date().toISOString(), active_seconds: 0, idle_seconds: 0,
      status: 'running', break_type: type, break_note: note || null, estimated_minutes: eta,
    }).select('id').single();
    if (error || !data) { console.warn('[activity-timer] pausa falhou:', error); sync(null); return; }
    lastFlushRef.current = Date.now();
    sync({
      kind: 'break', entryId: (data as { id: string }).id, activityId: null,
      activityType: '', activityTitle: BREAK_LABELS[type], leadName: null,
      userId: u.userId, userName: u.userName,
      activeSeconds: 0, idleSeconds: 0, status: 'running', estimateMinutes: eta,
      breakType: type, breakNote: note || null,
    });
    announceTakeover();
    pauseOtherSessions(u.userId, (data as { id: string }).id);
  }, [rememberLast, flush, getUser, sync, announceTakeover, pauseOtherSessions]);

  const extendBreak = useCallback(async (minutes: number) => {
    const e = entryRef.current;
    if (e?.kind !== 'break') return;
    const eta = (e.estimateMinutes || Math.ceil(e.idleSeconds / 60)) + minutes;
    breakOverNotifiedRef.current = false;
    setBreakOverdue(false);
    sync({ ...e, estimateMinutes: eta });
    try {
      await dbAny.from('activity_time_entries').update({ estimated_minutes: eta }).eq('id', e.entryId);
    } catch { /* melhor esforço */ }
  }, [sync]);

  const dismissAwayPrompt = useCallback(() => setAwayPrompt(false), []);

  // Retorno da pausa → salva e volta a contar ociosidade entre atividades.
  const endBreak = useCallback(async () => {
    if (entryRef.current?.kind !== 'break') return;
    breakOverNotifiedRef.current = false;
    setBreakOverdue(false);
    await flush('paused');
    await startGap();
  }, [flush, startGap]);

  // ---- Expediente (ponto): entrada/saída ----
  const startShift = useCallback(async () => {
    if (shiftIdRef.current) return;
    await ensureExternalSession().catch(() => {});
    const u = await getUser();
    if (!u) { toast.error('Não foi possível registrar o ponto (sem usuário).'); return; }
    const { data, error } = await dbAny.from('work_shifts').insert({
      user_id: u.userId, user_name: u.userName, started_at: new Date().toISOString(),
    }).select('id').single();
    if (error || !data) { console.warn('[activity-timer] ponto falhou:', error); return; }
    shiftIdRef.current = (data as { id: string }).id;
    setOnShift(true);
    toast.success('Expediente iniciado. Bom trabalho!');
    await startGap();
  }, [getUser, startGap]);

  const endShift = useCallback(async () => {
    rememberLast();
    if (entryRef.current) await flush('paused');
    awaitingConfirmRef.current = false;
    setIdlePrompt(false); setLeavePrompt(false); setSwitchPrompt(false);
    sync(null);
    if (shiftIdRef.current) {
      try {
        await dbAny.from('work_shifts').update({ ended_at: new Date().toISOString() }).eq('id', shiftIdRef.current);
      } catch { /* melhor esforço */ }
    }
    shiftIdRef.current = null;
    setOnShift(false);
    toast.success('Expediente encerrado. Até logo!');
  }, [rememberLast, flush, sync]);

  // Ao abrir o app: recupera o ponto aberto de hoje e REIDRATA qualquer
  // sessão com status='running' no banco (atividade/pausa/gap). Antes um F5
  // resetava para "ocioso" e gerava falsa ociosidade.
  useEffect(() => {
    (async () => {
      const u = await getUser();
      if (!u) { setOnShift(false); return; }
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      try {
        const { data } = await dbAny.from('work_shifts').select('id')
          .eq('user_id', u.userId).is('ended_at', null)
          .gte('started_at', startOfDay.toISOString())
          .order('started_at', { ascending: false }).limit(1).maybeSingle();
        if (data) {
          shiftIdRef.current = (data as { id: string }).id;
          setOnShift(true);
        } else {
          setOnShift(false);
        }
      } catch { setOnShift(false); }

      // Reidrata a sessão running (activity > break > gap) para não parar no reload.
      try {
        const { data: running } = await dbAny.from('activity_time_entries')
          .select('id, activity_id, activity_type, activity_title, lead_name, active_seconds, idle_seconds, estimated_minutes, break_type, break_note, started_at')
          .eq('user_id', u.userId).eq('status', 'running')
          .order('started_at', { ascending: false }).limit(1).maybeSingle();
        type R = { id: string; activity_id: string | null; activity_type: string | null; activity_title: string | null; lead_name: string | null; active_seconds: number | null; idle_seconds: number | null; estimated_minutes: number | null; break_type: BreakType | null; break_note: string | null };
        const row = running as R | null;
        if (row && !entryRef.current && !otherOwnerRef.current) {
          const kind: TimerEntry['kind'] = row.activity_id ? 'activity' : (row.break_type ? 'break' : 'gap');
          lastFlushRef.current = Date.now();
          lastInteractionRef.current = Date.now();
          lastGapNudgeRef.current = row.idle_seconds || 0;
          const ref: TimerEntry = {
            kind,
            entryId: row.id,
            activityId: row.activity_id,
            activityType: row.activity_type || '',
            activityTitle: row.activity_title || (kind === 'gap' ? GAP_TITLE : 'Atividade'),
            leadName: row.lead_name,
            userId: u.userId,
            userName: u.userName,
            activeSeconds: row.active_seconds || 0,
            idleSeconds: row.idle_seconds || 0,
            status: 'running',
            estimateMinutes: row.estimated_minutes,
            breakType: row.break_type,
            breakNote: row.break_note,
          };
          sync(ref);
          if (kind === 'activity' && row.activity_id) {
            const la: TimerActivityRef = {
              id: row.activity_id,
              activity_type: row.activity_type,
              title: row.activity_title,
              lead_name: row.lead_name,
              estimated_minutes: row.estimated_minutes,
            };
            lastActivityRef.current = la;
            setLastActivity(la);
          }
          announceTakeover();
          return;
        }
      } catch { /* segue para gap */ }

      // Sem sessão rodando prévia: se em expediente, começa o gap.
      if (shiftIdRef.current) {
        setTimeout(() => {
          if (!entryRef.current && !otherOwnerRef.current) startGap();
        }, 1500);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    hideTimer, showTimer, setEstimate, managerAlert, dismissManagerAlert,
    startBreak, endBreak, extendBreak, awayPrompt, dismissAwayPrompt, breakOverdue,
    onShift, startShift, endShift, formatHMS,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivityTimer(): ActivityTimerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useActivityTimer deve ser usado dentro de ActivityTimerProvider');
  return ctx;
}

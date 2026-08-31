import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { playAlarmSound } from '@/lib/sounds';
import { isSoundEnabled } from '@/lib/soundSettings';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { areaFromLocation, type SystemArea } from '@/lib/systemAreas';

// activity_time_entries ainda não está nos types gerados — acesso destipado.
const dbAny = db as unknown as SupabaseClient;

/**
 * Cronômetro de atividades — banco de horas.
 *
 * Modelo:
 * - Auto-start ao ABRIR uma atividade. O tempo é ACUMULADO por atividade:
 *   reabrir a mesma atv retoma a contagem de onde parou (mesma linha no banco).
 * - Enquanto a atv está aberta, quem decide cada segundo é activityTickMode:
 *   • FORA DA ABA (outro programa/aba — PJe, Word, e-mail): conta ATIVO por até
 *     AWAY_GRACE_MS (45 min). Passada a carência, notificação + dialog "ainda
 *     está nessa atividade?" e o tempo vira ocioso REATRIBUÍVEL — confirmar ao
 *     voltar devolve o período (até RECLAIM_MAX_SEC) pro tempo ativo.
 *   • NA ABA sem tocar em nada por IDLE_THRESHOLD: a pessoa saiu do computador.
 *     Conta OCIOSO e NÃO volta pro ativo nem confirmando.
 *   • Tela BLOQUEADA: ocioso de verdade, sem volta.
 *   • MÁQUINA SUSPENSA: ocioso. Só é declarada suspensão quando o relógio
 *     MONOTÔNICO também parou (ver machineSuspended no loop) — aba estrangulada
 *     pelo navegador não é. Se havia previsão em andamento ou o app estava fora
 *     de foco, o tempo é REATRIBUÍVEL: confirmar devolve.
 *   • PREVISÃO declarada em andamento: enquanto ela cobrir, o trabalho fora da
 *     aba conta ativo além da carência (teto = a previsão). Estourar a
 *     previsão só AVISA: o cronômetro não para de contar por causa disso.
 * - "Não, era outra" fecha/salva e abre o seletor "qual atividade agora?".
 * - Ao SAIR da atv (fechar) → dialog "Continuar contando ou pausar?".
 * - CONCLUIR encerra o cronômetro da atv (igual pausar).
 * - O tempo ENTRE atividades (nenhuma aberta) cai na linha de gap
 *   (activity_id null). Aí valem DUAS contas distintas:
 *     • sem interação (parado, tela bloqueada, PC suspenso) → OCIOSO de verdade,
 *       em idle_seconds da linha de gap;
 *     • interagindo com o sistema → USO DO SISTEMA, contado por ÁREA do menu em
 *       system_usage_entries (WhatsApp, Leads, Processual, Financeiro...).
 *   Uso do sistema NÃO é tempo produtivo: não entra em active_seconds e não
 *   pontua no ranking — quem quer pontuar segue tendo que vincular atividade.
 *   Serve para o membro não ser marcado como ocioso enquanto trabalha e para a
 *   gestão ver onde o tempo sem vínculo está indo.
 * - Persiste no Externo (activity_time_entries), flush absoluto a cada 30s.
 */

const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min sem interação
/**
 * Trabalho FORA DA ABA (PJe, Word, e-mail, telefone) com a atividade aberta:
 * conta ATIVO por até 45 min sem precisar confirmar nada. Passado esse teto o
 * cronômetro pergunta "ainda está nessa atividade?" e o tempo vira ocioso
 * REATRIBUÍVEL — confirmar ao voltar devolve o período pro tempo ativo.
 * (Definida em 28/08/2026 com 10 min; ampliada em 31/08/2026 — redigir peça,
 * manifestação ou inicial no PJe/Word é bloco contínuo de 30 a 90 min fora do
 * sistema, e os 10 min transformavam trabalho real em ociosidade.)
 */
const AWAY_GRACE_MS = 45 * 60 * 1000;
/**
 * Teto do que uma ausência devolve ao ativo quando a pessoa confirma. Sem
 * teto, uma aba esquecida aberta a noite toda viraria 14h "produtivas" com
 * um clique. Acima disso o excedente fica como ocioso. 4h = uma manhã inteira
 * de PJe, que é o maior bloco legítimo que aparece nos dados.
 */
const RECLAIM_MAX_SEC = 4 * 3600;
/**
 * Buraco entre ticks a partir do qual se cogita máquina suspensa. Era 2 min:
 * qualquer estrangulamento de aba em segundo plano batia nele e o tempo virava
 * "computador suspenso" — ocioso morto, sem volta nem confirmando (queixa de
 * 31/08/2026, com print da notificação de "suspenso 6 min" enquanto a pessoa
 * redigia no PJe). Cogitar não basta: o relógio monotônico precisa ter parado
 * junto (ver machineSuspended no loop de contagem).
 */
const SUSPEND_JUMP_SEC = 10 * 60;
/**
 * Quanto o relógio de parede precisa ter andado A MAIS que o monotônico para a
 * suspensão ser dada como real. Aba estrangulada/congelada: os dois andam
 * igual (só o callback atrasou). Máquina dormindo: o monotônico congela.
 */
const SUSPEND_CLOCK_GAP_MS = 60 * 1000;
const FLUSH_INTERVAL_MS = 30 * 1000;
const GAP_TITLE = 'Ocioso (entre atividades)';
/** Gravação do uso por área (upsert absoluto), mesma cadência do cronômetro. */
const USAGE_FLUSH_MS = 30 * 1000;
/**
 * Cobrança de vínculo para quem está NAVEGANDO (não ocioso): a cada 15 min de
 * uso do sistema abre o seletor "qual atividade você está fazendo?".
 * Nenhum aviso do cronômetro apita por padrão: o som de cada um é opcional,
 * ligado em Configurações → Notificações → Sons do sistema (soundSettings.ts).
 */
const NAV_NUDGE_SEC = 15 * 60;
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

/**
 * Comando remoto da gestão sobre o cronômetro do membro (activity_timer_alerts.command):
 * - 'pause'     → encerra o que está rodando e deixa o membro OCIOSO (linha de gap);
 * - 'end_shift' → encerra o expediente (bate o ponto de saída).
 * Alerta sem comando (null) continua sendo só o chamado "por que está ocioso?".
 */
export type TimerCommand = 'pause' | 'end_shift';

export type BreakType = 'almoco' | 'intervalo' | 'compensacao' | 'cafe' | 'lanche' | 'descanso' | 'reuniao';
export const BREAK_LABELS: Record<BreakType, string> = {
  almoco: 'Almoço',
  intervalo: 'Intervalo',
  compensacao: 'Compensação de horas',
  cafe: 'Café',
  lanche: 'Lanche',
  descanso: 'Descanso',
  reuniao: 'Reunião',
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
  /** Segundos contados como ocioso que VOLTAM pro ativo se a pessoa confirmar
   *  que continuou na atividade: tempo fora da aba além da carência e tempo
   *  posterior ao estouro da previsão. Ocioso de verdade (parado na frente do
   *  sistema, tela bloqueada, PC suspenso) NÃO entra aqui. */
  reclaimableIdle?: number;
}

interface ActivityTimerCtx {
  current: TimerEntry | null;
  /** Última atividade pausada — permite retomar sem reabrir a atv. */
  lastActivity: TimerActivityRef | null;
  /** Retoma o cronômetro da última atividade pausada (acumula de onde parou). */
  resumeLast: () => Promise<void>;
  /**
   * Reassume o comando do cronômetro NESTA aba (quando outra aba/janela tinha
   * assumido, ou a contagem caiu por falha). Readota a sessão de hoje que estiver
   * rodando; sem nenhuma, retoma a última atividade ou volta pro gap.
   */
  reclaimTimer: () => Promise<void>;
  /** Totais do dia (do membro): produtivo (ativo) e ocioso, ao vivo. */
  dayTotals: { active: number; idle: number };
  /**
   * Uso do sistema sem atividade vinculada (3ª categoria). `seconds` é o tempo
   * de HOJE na área atual; `dayTotal`, a soma de todas as áreas do dia. Null
   * enquanto não houver nada contabilizado.
   */
  usage: { areaKey: string; areaLabel: string; seconds: number; dayTotal: number } | null;
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
  /** Alerta recebido da gestão ("por que está ocioso?") ou comando remoto (pausar/encerrar). */
  managerAlert: { from: string | null; message: string | null; command?: TimerCommand | null } | null;
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
  /**
   * Já bateu a saída HOJE (turno do dia com `ended_at` preenchido). Serve para o
   * porteiro (ShiftGate) liberar a consulta depois do expediente encerrado —
   * quem encerrou o dia não é bloqueado, só não tem nada cronometrado.
   */
  shiftEndedToday: boolean;
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
  formatHMS: (totalSeconds: number) => string;
}

const Ctx = createContext<ActivityTimerCtx | null>(null);

/**
 * Data de HOJE no calendário de Brasília (YYYY-MM-DD). Casa com o default de
 * work_date no banco ((now() at time zone 'America/Sao_Paulo')::date) e com o
 * "início do dia" que o cliente usa. É a chave de partição por dia do cronômetro.
 */
export function brasiliaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

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
 * o sistema. É o divisor de águas da contagem: true → o segundo vai para USO DO
 * SISTEMA (por área, em system_usage_entries); false → OCIOSO de verdade
 * (idle_seconds da linha de gap). Mesmos critérios do ramo 'activity' (tela
 * bloqueada e máquina suspensa = não interagindo).
 */
export function isGapWorking(opts: { idleFor: number; locked: boolean; deltaSec: number }): boolean {
  const suspended = opts.deltaSec >= 120; // gap grande entre ticks = PC dormiu
  return opts.idleFor < IDLE_THRESHOLD_MS && !opts.locked && !suspended;
}

/**
 * Com uma atividade ABERTA, decide o que fazer com o segundo que passou.
 *
 * - `count`       — 'active' (tempo produtivo) ou 'idle';
 * - `ask`         — arma a pergunta "ainda está nessa atividade?" (uma vez);
 * - `reclaimable` — esse ocioso VOLTA pro ativo se a pessoa confirmar.
 *
 * A regra de ouro: FORA DA ABA (outro programa, outra aba — PJe, Word, e-mail)
 * é trabalho até prova em contrário, com carência de AWAY_GRACE_MS contando
 * ativo direto; depois da carência o sistema pergunta, e o que confirmarem
 * volta pro ativo. Já ficar PARADO com o sistema na frente ou com a tela
 * bloqueada é ociosidade de verdade: conta ocioso e não volta.
 *
 * Duas correções de 31/08/2026, das queixas de tempo produtivo virando ocioso:
 * - a suspensão de máquina não passa mais por cima da previsão declarada nem
 *   da ausência: nesses dois casos o tempo fica REATRIBUÍVEL;
 * - a pergunta pendente (`awaitingConfirm`) não congela mais o cronômetro de
 *   quem está com o dedo no teclado NESTA aba. Ela serve pra classificar o
 *   tempo, não pra parar de contar enquanto ninguém clica no diálogo.
 */
export function activityTickMode(opts: {
  /** ms desde que o app perdeu foco/visibilidade; null = app em foco. */
  awayFor: number | null;
  /** ms desde a última interação (mouse/teclado/scroll) NESTA aba. */
  idleFor: number;
  locked: boolean;
  /** Salto grande entre ticks SEM 'freeze' do navegador = PC dormiu. */
  machineSuspended: boolean;
  /** Previsão declarada ainda cobrindo o tempo ativo. */
  withinEstimate: boolean;
  awaitingConfirm: boolean;
  /** Já existe ocioso reatribuível acumulado (previsão estourada, p. ex.). */
  reclaimArmed: boolean;
}): { count: 'active' | 'idle'; ask: boolean; reclaimable: boolean } {
  const away = opts.awayFor !== null;
  // Tela bloqueada: ocioso puro. Não pergunta — desbloquear já religa a contagem.
  if (opts.locked) return { count: 'idle', ask: false, reclaimable: false };
  // Máquina suspensa: ocioso, com uma pergunta ao voltar. Se havia previsão
  // declarada em andamento ou o app estava fora de foco (trabalho no PJe/Word),
  // o tempo é REATRIBUÍVEL — confirmar devolve. Sem isso, um falso positivo do
  // detector destruía trabalho real sem nenhum caminho de volta.
  if (opts.machineSuspended) {
    return { count: 'idle', ask: !opts.awaitingConfirm, reclaimable: away || opts.withinEstimate };
  }
  // Pergunta pendente: quem está mexendo NESTA aba segue ativo — a pergunta
  // classifica o tempo, não para o cronômetro. Parado ou fora da aba, ocioso.
  if (opts.awaitingConfirm) {
    if (!away && opts.idleFor < IDLE_THRESHOLD_MS) return { count: 'active', ask: false, reclaimable: false };
    return { count: 'idle', ask: false, reclaimable: away || opts.reclaimArmed };
  }
  if (away) {
    // Carência (ou previsão declarada cobrindo): trabalho fora da aba conta ativo.
    if ((opts.awayFor as number) < AWAY_GRACE_MS || opts.withinEstimate) {
      return { count: 'active', ask: false, reclaimable: false };
    }
    return { count: 'idle', ask: true, reclaimable: true };
  }
  // Na aba e sem tocar em nada: a pessoa saiu do computador.
  if (opts.idleFor >= IDLE_THRESHOLD_MS && !opts.withinEstimate) {
    return { count: 'idle', ask: true, reclaimable: false };
  }
  return { count: 'active', ask: false, reclaimable: false };
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
  // Começa RECOLHIDO (aba lateral): abrindo o sistema, o cronômetro não pode
  // nascer por cima do conteúdo. Expande em showTimer() — ao iniciar/trocar de
  // atividade — e recolhe no primeiro clique fora. (skill: ui-sem-sobreposicao)
  const [hidden, setHidden] = useState(true);
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
  // Momento em que o NAVEGADOR congelou esta aba (evento 'freeze' da Page
  // Lifecycle API). Distingue "aba congelada em segundo plano" (pessoa
  // trabalhando em outra aba, ex.: PJe) de "máquina suspensa" (PC dormiu) —
  // suspensão real não dispara 'freeze'.
  const frozeAtRef = useRef<number | null>(null);
  // Momento em que o app perdeu o foco/visibilidade (pessoa em outro programa
  // ou outra aba). null = app em foco. Alimentado por eventos E corrigido a
  // cada tick — evento sozinho não é confiável quando o navegador congela a aba.
  const awaySinceRef = useRef<number | null>(null);
  const [onShift, setOnShift] = useState<boolean | null>(null);
  const [shiftEndedToday, setShiftEndedToday] = useState(false);
  const [awayPrompt, setAwayPrompt] = useState(false);
  const [breakOverdue, setBreakOverdue] = useState(false);
  const breakOverNotifiedRef = useRef<boolean>(false);
  const lastGapNudgeRef = useRef<number>(0);
  // ---- Uso do sistema por área (3ª categoria: nem produtivo, nem ocioso) ----
  // `seconds` já inclui o acumulado de HOJE nessa área (carregado do banco em
  // loadUsageBase) — o flush grava valor ABSOLUTO, igual ao do cronômetro.
  const usageRef = useRef<{ key: string; label: string; seconds: number; loaded: boolean } | null>(null);
  const usageDayBaseRef = useRef<number>(0); // soma do dia nas OUTRAS áreas
  const usageFlushRef = useRef<number>(0);
  const usageBusyRef = useRef<boolean>(false);
  const navNudgeRef = useRef<number>(0);     // último nudge de "vincule a atividade"
  // Rede de segurança: se system_usage_entries não existir/não gravar (ex.: o
  // front publicado antes da migration no Externo), o tempo NÃO pode sumir —
  // volta a cair em idle_seconds, como era antes desta feature.
  const usageUnavailableRef = useRef<boolean>(false);
  const usageFailRef = useRef<number>(0);
  const [usage, setUsage] = useState<{ areaKey: string; areaLabel: string; seconds: number; dayTotal: number } | null>(null);
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
  const [managerAlert, setManagerAlert] = useState<{ from: string | null; message: string | null; command?: TimerCommand | null } | null>(null);
  const dismissManagerAlert = useCallback(() => setManagerAlert(null), []);
  // Ponte para o listener de realtime executar comandos da gestão sem recriar a
  // inscrição a cada render (as ações abaixo dependem de estado/refs do provider).
  const remoteRef = useRef<{ forceIdle: () => Promise<void>; endShift: () => Promise<void> } | null>(null);

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

  /**
   * Grava o tempo da área (upsert ABSOLUTO — mesma semântica do flush do
   * cronômetro). Só grava área já carregada: gravar antes de conhecer o
   * acumulado do dia sobrescreveria o total com um valor menor.
   */
  const flushUsage = useCallback(async (snapshot?: { key: string; label: string; seconds: number; loaded: boolean }) => {
    const u = userRef.current;
    const cur = snapshot || usageRef.current;
    if (!u || !cur || !cur.loaded || cur.seconds <= 0) return;
    usageFlushRef.current = Date.now();
    try {
      const { error } = await dbAny.from('system_usage_entries').upsert({
        user_id: u.userId,
        user_name: u.userName,
        work_date: brasiliaToday(),
        area_key: cur.key,
        area_label: cur.label,
        active_seconds: cur.seconds,
      }, { onConflict: 'user_id,work_date,area_key' });
      if (error) throw error;
      usageFailRef.current = 0;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      // 42P01 (relação inexistente) / PGRST205 (tabela fora do schema cache):
      // a migration não está aplicada — desliga a categoria na hora.
      if (code === '42P01' || code === 'PGRST205' || ++usageFailRef.current >= 2) {
        usageUnavailableRef.current = true;
        console.warn('[activity-timer] uso do sistema indisponível — o tempo sem atividade volta a contar como ocioso', err);
      } else {
        console.warn('[activity-timer] uso do sistema: gravação falhou', err);
      }
    }
  }, []);

  /** Carrega o acumulado de hoje da área (base do contador absoluto). */
  const loadUsageBase = useCallback(async (key: string) => {
    if (usageBusyRef.current) return;
    usageBusyRef.current = true;
    try {
      await ensureExternalSession().catch(() => {});
      const u = await getUser();
      if (!u) return;
      const { data } = await dbAny.from('system_usage_entries')
        .select('active_seconds')
        .eq('user_id', u.userId).eq('work_date', brasiliaToday()).eq('area_key', key)
        .maybeSingle();
      const base = (data as { active_seconds: number } | null)?.active_seconds || 0;
      const cur = usageRef.current;
      if (cur && cur.key === key && !cur.loaded) { cur.seconds += base; cur.loaded = true; }
    } catch {
      // Sem base (offline/RLS): marca como carregada para não travar a gravação —
      // o pior caso é o upsert regravar o dia a partir do que esta sessão contou.
      const cur = usageRef.current;
      if (cur && cur.key === key) cur.loaded = true;
    } finally {
      usageBusyRef.current = false;
    }
  }, [getUser]);

  /** Soma do dia nas OUTRAS áreas (a atual entra ao vivo, como em dayTotals). */
  const refreshUsageDay = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    try {
      const { data } = await dbAny.from('system_usage_entries')
        .select('area_key, active_seconds')
        .eq('user_id', u.userId).eq('work_date', brasiliaToday());
      const curKey = usageRef.current?.key;
      let total = 0;
      for (const r of ((data as { area_key: string; active_seconds: number }[]) || [])) {
        if (r.area_key === curKey) continue;
        total += r.active_seconds || 0;
      }
      usageDayBaseRef.current = total;
    } catch { /* mantém o valor atual */ }
  }, []);

  /**
   * Um tick de uso do sistema: acumula na área da URL atual. Trocar de área
   * fecha a anterior (flush) e abre a nova. Chamado só quando NÃO há atividade
   * aberta e há interação real.
   */
  const accumulateUsage = useCallback((area: SystemArea, deltaSec: number) => {
    const prev = usageRef.current;
    if (!prev || prev.key !== area.key) {
      if (prev) flushUsage({ ...prev });
      if (prev?.loaded) usageDayBaseRef.current += prev.seconds;
      usageRef.current = { key: area.key, label: area.label, seconds: 0, loaded: false };
      // Recalcula a base do dia depois que o flush da área anterior tiver
      // chegado ao banco (sem o atraso, o total exibido oscilaria pra baixo).
      setTimeout(() => { refreshUsageDay(); }, 3000);
    }
    const cur = usageRef.current!;
    cur.seconds += deltaSec;
    if (!cur.loaded) loadUsageBase(cur.key);
    setUsage({
      areaKey: cur.key, areaLabel: cur.label, seconds: cur.seconds,
      dayTotal: usageDayBaseRef.current + cur.seconds,
    });
    if (cur.loaded && Date.now() - usageFlushRef.current >= USAGE_FLUSH_MS) flushUsage();
  }, [flushUsage, loadUsageBase, refreshUsageDay]);

  const sync = useCallback((e: TimerEntry | null) => {
    entryRef.current = e;
    setCurrent(e ? { ...e } : null);
    // Diagnóstico da troca de atividade: rastreia cada mudança de estado do timer
    // (revela se a troca sincronizou a nova atv e se algo re-afirma a antiga).
    console.debug('[activity-timer] sync →', e ? `${e.kind}:${e.activityTitle}` : 'null', e?.activityId ?? '');
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
    try {
      const { data } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds, break_type')
        .eq('user_id', u.userId)
        .eq('work_date', brasiliaToday());
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
    refreshUsageDay();
    const id = setInterval(() => { refreshDayBase(); refreshUsageDay(); }, 60000);
    return () => clearInterval(id);
  }, [current?.entryId, refreshDayBase, refreshUsageDay]);

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

  // ---- Fora da aba: desde quando o app está sem foco/visibilidade ----
  // Os eventos marcam o INSTANTE exato da saída (o tick pode nem rodar depois,
  // se o navegador congelar a aba); o loop de contagem corrige o ref a cada
  // segundo, para o caso de algum evento não disparar.
  useEffect(() => {
    const enter = () => { if (awaySinceRef.current === null) awaySinceRef.current = Date.now(); };
    const leave = () => { awaySinceRef.current = null; lastInteractionRef.current = Date.now(); };
    const onVis = () => { if (document.visibilityState === 'hidden') enter(); else leave(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', enter);
    window.addEventListener('focus', leave);
    if (document.visibilityState === 'hidden' || !document.hasFocus()) enter();
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', enter);
      window.removeEventListener('focus', leave);
    };
  }, []);

  // ---- Loop de contagem (usa delta de wall-clock p/ sobreviver a throttling em abas ocultas) ----
  useEffect(() => {
    let lastTick = Date.now();
    // Relógio MONOTÔNICO em paralelo ao de parede: ele não anda enquanto a
    // máquina dorme, mas anda normalmente quando o navegador só estrangula ou
    // congela a aba. É o que separa suspensão real de aba em segundo plano.
    let lastPerf = performance.now();
    const id = setInterval(() => {
      const e = entryRef.current;
      const now = Date.now();
      const perfNow = performance.now();
      const prevTick = lastTick;
      const perfDelta = perfNow - lastPerf;
      const deltaSec = Math.max(0, Math.round((now - prevTick) / 1000));
      lastTick = now;
      lastPerf = perfNow;
      if (!e || e.status === 'paused' || deltaSec === 0) return;

      const idleFor = now - lastInteractionRef.current;
      const next: TimerEntry = { ...e };

      if (e.kind === 'break') {
        // Pausa: conta o tempo e só avisa (uma vez, sem som) quando estoura
        // o previsto.
        next.idleSeconds += deltaSec;
        const etaSec = next.estimateMinutes ? next.estimateMinutes * 60 : 0;
        if (etaSec > 0 && next.idleSeconds >= etaSec && !breakOverNotifiedRef.current) {
          breakOverNotifiedRef.current = true;
          setBreakOverdue(true);
          if (isSoundEnabled('timerBreakOverdue')) playAlarmSound();
          notifyDesktop('⏰ Sua pausa acabou', `A ${next.activityTitle.toLowerCase()} passou da previsão de ${next.estimateMinutes} min. Voltou ao trabalho?`);
        }
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      if (e.kind === 'gap') {
        // Sem atividade vinculada nada conta como PRODUTIVO — mas o tempo se
        // divide em dois: interagindo com o sistema vira USO DO SISTEMA (por
        // área, tabela própria); parado de fato vira OCIOSO (idle_seconds).
        const interacting = isGapWorking({ idleFor, locked: lockedRef.current, deltaSec });
        // Sem a tabela de uso (migration não aplicada), o badge volta a dizer
        // "ocioso" — a UI não pode anunciar uma contagem que não está rodando.
        const gapWorking = interacting && !usageUnavailableRef.current;
        next.gapWorking = gapWorking; // o badge alterna "usando X" x "ocioso"

        if (gapWorking) {
          const area = areaFromLocation(window.location.pathname, window.location.search);
          accumulateUsage(area, deltaSec);
          // Cobrança de vínculo a cada NAV_NUDGE_SEC de uso — sem apito: quem
          // está navegando está trabalhando, só não vinculou a atividade.
          // Contador próprio (segundos desde o último nudge): usar o acumulado
          // do dia dispararia a cobrança já no primeiro tick da retomada.
          navNudgeRef.current += deltaSec;
          if (navNudgeRef.current >= NAV_NUDGE_SEC) {
            navNudgeRef.current = 0;
            setSwitchPrompt(true);
            notifyDesktop(
              `⏱️ ${area.label} · sem atividade vinculada`,
              'Esse tempo está registrado como uso do sistema, mas NÃO conta como produtivo. Vincule a atividade que você está fazendo ou crie uma por voz.',
            );
          }
        } else {
          next.idleSeconds += deltaSec;
          navNudgeRef.current = 0; // parou de navegar: a próxima cobrança recomeça
          if (next.idleSeconds - lastGapNudgeRef.current >= 300) {
            lastGapNudgeRef.current = next.idleSeconds;
            if (interacting) {
              // Fallback (sem a tabela de uso): comportamento anterior — cobra
              // o vínculo, já que a pessoa está mexendo no sistema.
              setSwitchPrompt(true);
              notifyDesktop('⏱️ Sem atividade vinculada', 'Esse tempo NÃO está contando como produtivo. Vincule a atividade que você está fazendo ou crie uma por voz.');
            } else {
              // Ocioso de verdade: cobra a cada 5 min.
              setAwayPrompt(true);
              if (isSoundEnabled('timerIdle')) playAlarmSound();
              notifyDesktop('⏰ Você está ocioso', `Ocioso há ${Math.round(next.idleSeconds / 60)} min. Vai se ausentar? Registre uma pausa ou retome uma atividade.`);
            }
          }
        }
        sync(next);
        if (now - lastFlushRef.current >= FLUSH_INTERVAL_MS) flush();
        return;
      }

      // kind === 'activity': segue contando com a aba oculta. Quem manda é
      // activityTickMode — fora da aba conta ATIVO na carência (AWAY_GRACE_MS)
      // e vira ocioso REATRIBUÍVEL depois dela; parado na frente do sistema e
      // tela bloqueada continuam sendo ocioso de verdade.
      const bigJump = deltaSec >= SUSPEND_JUMP_SEC;
      // Salto grande com 'freeze' registrado no meio = a ABA foi congelada pelo
      // navegador (pessoa em outra aba), não a máquina suspensa. O evento é
      // Chrome/Edge e nem sempre dispara, por isso ele não é a única defesa.
      const tabFroze = bigJump && frozeAtRef.current !== null && frozeAtRef.current >= prevTick - 5000;
      // Consome o registro: no salto grande ele foi usado acima; fora disso, um
      // 'freeze' antigo (descongelou rápido) não pode contaminar uma suspensão
      // real futura.
      if (frozeAtRef.current !== null && (bigJump || frozeAtRef.current < prevTick - 5000)) {
        frozeAtRef.current = null;
      }
      // Prova de que a MÁQUINA dormiu: o relógio de parede andou muito mais que
      // o monotônico. Aba só estrangulada tem os dois andando junto — e aí isto
      // dá false, que é o lado seguro (o tempo cai na regra de ausência, que
      // devolve, em vez de virar ocioso morto).
      const clockStopped =
        now - prevTick - perfDelta >= SUSPEND_CLOCK_GAP_MS && perfDelta < (now - prevTick) / 2;
      const machineSuspended = bigJump && !tabFroze && clockStopped;
      const estSec = next.estimateMinutes && next.estimateMinutes > 0 ? next.estimateMinutes * 60 : 0;
      // Com PREVISÃO definida e ainda dentro dela, não perturba: a pergunta
      // "ainda está fazendo?" só vem quando a previsão acaba.
      const withinEstimate = estSec > 0 && next.activeSeconds < estSec;

      // Estado de ausência (o evento pode não ter disparado — aqui é a rede).
      const appFocused = document.visibilityState === 'visible' && document.hasFocus();
      if (appFocused) awaySinceRef.current = null;
      else if (awaySinceRef.current === null) awaySinceRef.current = now;
      const awaySince = awaySinceRef.current;

      const mode = activityTickMode({
        awayFor: awaySince === null ? null : now - awaySince,
        idleFor,
        locked: lockedRef.current,
        machineSuspended,
        withinEstimate,
        awaitingConfirm: awaitingConfirmRef.current,
        reclaimArmed: next.reclaimableIdle != null,
      });

      let activeSec = mode.count === 'active' ? deltaSec : 0;
      let idleSec = deltaSec - activeSec;
      let reclaimSec = mode.reclaimable ? idleSec : 0;
      // Aba congelada pelo navegador: o tick só volta lá na frente e o delta
      // inteiro chega de uma vez. O pedaço que caiu DENTRO da carência ainda é
      // ativo — sem isso, sair da aba por 2h zeraria a carência inteira.
      if (idleSec > 0 && mode.reclaimable && awaySince !== null) {
        const inGraceMs = Math.min(now, awaySince + AWAY_GRACE_MS) - Math.max(prevTick, awaySince);
        const inGrace = Math.max(0, Math.min(idleSec, Math.round(inGraceMs / 1000)));
        activeSec += inGrace; idleSec -= inGrace; reclaimSec -= inGrace;
      }
      // Teto da previsão declarada: o que passar dela não entra no ativo sem
      // confirmação (o estouro logo abaixo arma o prompt).
      if (activeSec > 0 && estSec > 0 && awaySince !== null) {
        const over = Math.max(0, next.activeSeconds + activeSec - estSec);
        if (over > 0) { activeSec -= over; idleSec += over; reclaimSec += over; }
      }
      next.activeSeconds += activeSec;
      next.idleSeconds += idleSec;
      if (reclaimSec > 0) {
        next.reclaimableIdle = Math.min((next.reclaimableIdle ?? 0) + reclaimSec, RECLAIM_MAX_SEC);
      }

      // Uma pergunta por ausência — o texto diz o que aconteceu.
      if (mode.ask && !awaitingConfirmRef.current) {
        awaitingConfirmRef.current = true;
        setIdlePrompt(true);
        if (machineSuspended) {
          notifyDesktop('Cronômetro de atividade', `O computador ficou suspenso ${Math.round(deltaSec / 60)} min (contado como ocioso). Ainda está fazendo "${e.activityTitle}"?`);
        } else if (awaySince !== null) {
          notifyDesktop('⏱️ Você está fora da aba', `Já são ${Math.round((now - awaySince) / 60000)} min fora do sistema. Se continuou em "${e.activityTitle}" (PJe, Word...), confirme ao voltar: esse tempo volta a contar como ativo.`);
        } else {
          if (isSoundEnabled('timerStillWorking')) playAlarmSound();
          notifyDesktop('Cronômetro de atividade', `Ainda está fazendo "${e.activityTitle}"? Confirme para continuar contando.`);
        }
      }

      // Gatilho de urgência da previsão (compara com o tempo ATIVO). Só arma a
      // confirmação se activityTickMode já não tiver armado neste mesmo tick —
      // overNotifiedRef garante uma notificação só.
      if (estSec > 0) {
        if (next.activeSeconds >= estSec) {
          if (!overNotifiedRef.current) {
            overNotifiedRef.current = true;
            nearNotifiedRef.current = true;
            if (isSoundEnabled('timerEstimateOverdue')) playAlarmSound();
            notifyDesktop('⏰ Previsão estourada', `"${e.activityTitle}" passou da previsão de ${next.estimateMinutes} min.`);
            // Estourar a previsão AVISA, não congela o cronômetro. Antes daqui
            // saía `awaitingConfirm = true`, e como pergunta pendente jogava
            // tudo em ocioso, quem levava mais tempo que o previsto parava de
            // acumular ativo até clicar num diálogo que podia nem ver — 102h de
            // ocioso em 3 semanas nasceram desse caminho. Previsão é estimativa,
            // não teto: quem continua trabalhando continua contando ativo.
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
  }, [sync, flush, accumulateUsage]);

  // ---- Alertas e comandos da gestão via realtime ----
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
        }, (payload: { new: { id: string; from_name: string | null; message: string | null; command?: string | null } }) => {
          const cmd = (payload.new.command as TimerCommand | null) || null;
          const who = payload.new.from_name || 'Gestão';
          setManagerAlert({ from: payload.new.from_name, message: payload.new.message, command: cmd });
          if (isSoundEnabled('managerAlert')) playAlarmSound();
          if (cmd === 'pause') {
            notifyDesktop('⏸️ Cronômetro pausado pela gestão', `${who} pausou seu cronômetro: você está OCIOSO. Retome uma atividade ou registre uma pausa.`);
            // A execução é local (o dono do cronômetro é o cliente do membro):
            // salva o tempo da sessão atual e cai na linha de gap (ocioso).
            remoteRef.current?.forceIdle().catch(() => {});
          } else if (cmd === 'end_shift') {
            notifyDesktop('🚪 Expediente encerrado pela gestão', `${who} encerrou seu expediente. O cronômetro parou de contar.`);
            remoteRef.current?.endShift().catch(() => {});
          } else {
            notifyDesktop('🚨 Chamado da gestão', `${who}: ${payload.new.message || 'Por que você está ocioso?'}`);
          }
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

  // ---- Flush ao esconder a aba + registro de congela do navegador ----
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      if (entryRef.current) flush();
      flushUsage(); // o tempo de uso da área também não pode ficar só na memória
    };
    // 'freeze' (Page Lifecycle, Chrome/Edge): o navegador vai congelar a aba em
    // segundo plano. Registra o momento (o loop usa pra diferenciar de PC
    // suspenso) e persiste o estado antes de os timers pararem.
    const onFreeze = () => { frozeAtRef.current = Date.now(); if (entryRef.current) flush(); flushUsage(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('freeze', onFreeze);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('freeze', onFreeze);
    };
  }, [flush, flushUsage]);

  // Inicia (ou retoma) o rastreador de ociosidade entre atividades.
  // Só conta ocioso DENTRO do expediente (ponto aberto).
  const startGap = useCallback(async () => {
    if (!shiftIdRef.current) { sync(null); return; }
    const u = await getUser();
    if (!u) { sync(null); return; }
    await ensureExternalSession().catch(() => {});
    const today = brasiliaToday();
    let entryId: string;
    let idleSeconds = 0;
    // active_seconds do gap: legado ("trabalho avulso" de antes da regra de
    // vínculo obrigatório). Hoje não cresce mais, mas precisa ser RESTAURADO ao
    // retomar — sem isso o próximo flush gravaria 0 e apagaria o histórico.
    let activeSeconds = 0;
    try {
      const { data: existing } = await dbAny.from('activity_time_entries')
        .select('id, idle_seconds, active_seconds')
        .eq('user_id', u.userId).is('activity_id', null).is('break_type', null)
        .eq('work_date', today)
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        entryId = existing.id;
        idleSeconds = existing.idle_seconds || 0;
        activeSeconds = existing.active_seconds || 0;
        // started_at renovado: é o desempate de posse (assertOwnership). Sem
        // renovar, uma linha 'running' esquecida em outra janela seria "mais
        // nova" que esta e roubaria o comando no próximo heartbeat.
        const nowIso = new Date().toISOString();
        await dbAny.from('activity_time_entries')
          .update({ status: 'running', started_at: nowIso, ended_at: nowIso }).eq('id', entryId);
      } else {
        const { data, error } = await dbAny.from('activity_time_entries').insert({
          activity_id: null, activity_type: null, activity_title: GAP_TITLE, lead_name: null,
          user_id: u.userId, user_name: u.userName,
          started_at: new Date().toISOString(), active_seconds: 0, idle_seconds: 0, status: 'running',
          work_date: today,
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

  /**
   * Pausa REMOTA (gestão): encerra o que estiver rodando — atividade, pausa
   * justificada ou o próprio gap — salvando o tempo, e deixa o membro na linha
   * de ociosidade. Diferente do finalizeToGap, cai no gap venha de onde vier
   * (o gestor pausa justamente quem está em atividade/pausa sem estar ali).
   */
  const forceIdle = useCallback(async () => {
    rememberLast();
    if (entryRef.current) await flush('paused');
    awaitingConfirmRef.current = false;
    breakOverNotifiedRef.current = false;
    setIdlePrompt(false); setLeavePrompt(false); setSwitchPrompt(false);
    setAwayPrompt(false); setBreakOverdue(false);
    await startGap(); // sem expediente aberto, startGap já resolve para sync(null)
  }, [rememberLast, flush, startGap]);

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
    if (busyRef.current) { console.warn('[activity-timer] troca ignorada: operação anterior ainda em andamento (busy)'); return; }
    busyRef.current = true;
    try {
      console.debug('[activity-timer] iniciando troca para', activity.id, activity.title);
      // Encerra o que estava rodando (outra atv ou o gap) salvando o tempo.
      rememberLast();
      if (entryRef.current) await flush('paused');

      try { await ensureExternalSession(); } catch (e) { console.error('[activity-timer] sessão externa falhou (o insert pode ser bloqueado por RLS):', e); }
      const u = await getUser();
      if (!u) { console.error('[activity-timer] sem usuário — timer não iniciado'); toast.error('Não consegui trocar de atividade: sessão sem usuário. Recarregue a página.'); sync(null); return; }

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
      // Retomada por DIA: só reaproveita a linha desta atv se for de HOJE. Num dia
      // novo cria linha zerada (work_date = hoje) em vez de retomar o acumulado de
      // dias anteriores — é isto que evita a atv aparecer com "5h" logo de manhã.
      const today = brasiliaToday();
      const { data: rows } = await dbAny.from('activity_time_entries')
        .select('id, active_seconds, idle_seconds, started_at, estimated_minutes')
        .eq('activity_id', activity.id).eq('user_id', u.userId).eq('work_date', today)
        .order('active_seconds', { ascending: false })
        .limit(10);
      const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

      if (existing) {
        entryId = existing.id;
        activeSeconds = existing.active_seconds || 0;
        idleSeconds = existing.idle_seconds || 0;
        if (existing.estimated_minutes != null) estimateMinutes = existing.estimated_minutes;
        // started_at renovado — ver startGap: quem retoma passa a ser a sessão
        // mais nova e não perde a posse para uma linha rodando esquecida.
        const nowIso = new Date().toISOString();
        await dbAny.from('activity_time_entries')
          .update({ status: 'running', started_at: nowIso, ended_at: nowIso }).eq('id', entryId);
      } else {
        const { data, error } = await dbAny.from('activity_time_entries').insert({
          activity_id: activity.id,
          activity_type: activity.activity_type || null,
          activity_title: activity.title || null,
          lead_name: activity.lead_name || null,
          user_id: u.userId, user_name: u.userName,
          started_at: new Date().toISOString(), active_seconds: 0, idle_seconds: 0, status: 'running',
          estimated_minutes: estimateMinutes, work_date: today,
        }).select('id').single();
        if (error || !data) {
          console.error('[activity-timer] insert falhou:', error);
          toast.error(`Não consegui trocar de atividade: ${error?.message || 'falha ao salvar o tempo (verifique a conexão/sessão)'}`);
          return;
        }
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
    } catch (err) {
      console.error('[activity-timer] troca de atividade falhou:', err);
      toast.error(`Não consegui trocar de atividade: ${(err as Error)?.message || 'erro inesperado'}`);
    } finally {
      busyRef.current = false;
    }
  }, [getUser, sync, flush, showTimer, rememberLast, startLockDetector, announceTakeover]);

  const resumeLast = useCallback(async () => {
    if (lastActivityRef.current) await startTimer(lastActivityRef.current);
  }, [startTimer]);

  /**
   * Reassume o comando do cronômetro NESTA aba.
   *
   * Quando outra aba/janela assume (announceTakeover / assertOwnership), esta
   * solta o cronômetro com sync(null) — e o overlay ficava sem NADA na tela,
   * sem contar e sem botão, até um F5. Era a queixa "o cronômetro fica
   * desaparecendo": bastava abrir o sistema numa segunda aba para a primeira
   * ficar muda. Quem está com o foco é quem está trabalhando, então esta aba
   * readota a sessão de hoje que estiver rodando (renovando started_at, o
   * desempate de posse) ou recomeça a contagem.
   */
  const reclaimBusyRef = useRef<boolean>(false);
  const reclaimTimer = useCallback(async () => {
    if (entryRef.current || busyRef.current || reclaimBusyRef.current) return;
    if (!shiftIdRef.current) return; // fora do expediente o botão é "Iniciar expediente"
    reclaimBusyRef.current = true;
    try {
      await ensureExternalSession().catch(() => {});
      const u = await getUser();
      if (!u) return;
      otherOwnerRef.current = false;

      type Row = {
        id: string; activity_id: string | null; activity_type: string | null; activity_title: string | null;
        lead_name: string | null; active_seconds: number | null; idle_seconds: number | null;
        estimated_minutes: number | null; break_type: BreakType | null; break_note: string | null;
      };
      let row: Row | null = null;
      try {
        const { data } = await dbAny.from('activity_time_entries')
          .select('id, activity_id, activity_type, activity_title, lead_name, active_seconds, idle_seconds, estimated_minutes, break_type, break_note')
          .eq('user_id', u.userId).eq('status', 'running').eq('work_date', brasiliaToday())
          .order('started_at', { ascending: false }).limit(1).maybeSingle();
        row = (data as Row | null) ?? null;
      } catch { /* sem linha adotável — cai no fallback abaixo */ }

      if (row) {
        const nowIso = new Date().toISOString();
        try {
          await dbAny.from('activity_time_entries')
            .update({ status: 'running', started_at: nowIso, ended_at: nowIso }).eq('id', row.id);
        } catch { /* melhor esforço */ }
        const kind: TimerEntry['kind'] = row.activity_id ? 'activity' : (row.break_type ? 'break' : 'gap');
        const activeSeconds = row.active_seconds || 0;
        const idleSeconds = row.idle_seconds || 0;
        const estSec = row.estimated_minutes ? row.estimated_minutes * 60 : 0;
        // Não re-apita o que esta sessão já avisou antes de soltar o cronômetro.
        overNotifiedRef.current = estSec > 0 && activeSeconds >= estSec;
        nearNotifiedRef.current = estSec > 0 && activeSeconds >= estSec * 0.8;
        breakOverNotifiedRef.current = kind === 'break' && estSec > 0 && idleSeconds >= estSec;
        awaitingConfirmRef.current = false;
        lastInteractionRef.current = Date.now();
        lastFlushRef.current = Date.now();
        lastGapNudgeRef.current = idleSeconds;
        sync({
          kind,
          entryId: row.id,
          activityId: row.activity_id,
          activityType: row.activity_type || '',
          activityTitle: row.activity_title || (kind === 'gap' ? GAP_TITLE : 'Atividade'),
          leadName: row.lead_name,
          userId: u.userId,
          userName: u.userName,
          activeSeconds, idleSeconds,
          status: 'running',
          estimateMinutes: row.estimated_minutes,
          breakType: row.break_type,
          breakNote: row.break_note,
        });
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
        pauseOtherSessions(u.userId, row.id);
        return;
      }

      if (lastActivityRef.current) { await startTimer(lastActivityRef.current); return; }
      await startGap();
    } finally {
      reclaimBusyRef.current = false;
    }
  }, [getUser, sync, announceTakeover, pauseOtherSessions, startTimer, startGap]);

  /**
   * Autocura: a aba com FOCO é a que comanda. Se esta ficou sem cronômetro com
   * o expediente aberto, ela reassume sozinha ao ganhar o foco. O `hasFocus`
   * evita disputa entre duas janelas visíveis lado a lado (só uma tem foco por
   * vez) — sem ele as duas ficariam se roubando o cronômetro.
   */
  useEffect(() => {
    if (current || onShift !== true) return;
    let cancelled = false;
    const tryReclaim = () => {
      if (cancelled || typeof document === 'undefined' || !document.hasFocus()) return;
      reclaimTimer().catch(() => {});
    };
    // Espera a reidratação inicial (que também restaura a sessão) antes de agir.
    const t = setTimeout(tryReclaim, 3000);
    window.addEventListener('focus', tryReclaim);
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener('focus', tryReclaim);
    };
    // `!!current` (e não `current`) para o efeito não remontar a cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!current, onShift, reclaimTimer]);

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
    // Reatribuição: o ocioso marcado como reatribuível (tempo fora da aba além
    // da carência, ou posterior ao estouro da previsão) volta a ser ATIVO
    // quando a pessoa confirma que seguiu na atividade (ex.: no PJe).
    const e = entryRef.current;
    if (e?.kind === 'activity' && e.reclaimableIdle != null) {
      const reclaimed = Math.min(e.reclaimableIdle, e.idleSeconds);
      sync({
        ...e,
        activeSeconds: e.activeSeconds + reclaimed,
        idleSeconds: e.idleSeconds - reclaimed,
        reclaimableIdle: undefined,
      });
      if (reclaimed > 0) flush();
    }
    awaitingConfirmRef.current = false;
    lastInteractionRef.current = Date.now();
    setIdlePrompt(false);
  }, [sync, flush]);

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
      work_date: brasiliaToday(),
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
    setShiftEndedToday(false);
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
    setShiftEndedToday(true);
    toast.success('Expediente encerrado. Até logo!');
  }, [rememberLast, flush, sync]);

  // Mantém a ponte do listener de realtime apontando para as versões atuais.
  useEffect(() => { remoteRef.current = { forceIdle, endShift }; }, [forceIdle, endShift]);

  /**
   * Assume a sessão com status='running' do banco (atividade/pausa/gap) nesta
   * aba. Usada no reload (não parar por causa de um F5) e na tomada de posse
   * por foco. `force` ignora o fato de outra aba ter se anunciado dona — é
   * exatamente o caso de quem acabou de clicar nesta aba.
   * Retorna true se esta aba passou a comandar o cronômetro.
   */
  const hydrateRunning = useCallback(async (force = false): Promise<boolean> => {
    const u = await getUser();
    if (!u) return false;
    try {
      const { data: running } = await dbAny.from('activity_time_entries')
        .select('id, activity_id, activity_type, activity_title, lead_name, active_seconds, idle_seconds, estimated_minutes, break_type, break_note, started_at, work_date')
        .eq('user_id', u.userId).eq('status', 'running')
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      type R = { id: string; activity_id: string | null; activity_type: string | null; activity_title: string | null; lead_name: string | null; active_seconds: number | null; idle_seconds: number | null; estimated_minutes: number | null; break_type: BreakType | null; break_note: string | null; work_date: string | null };
      const row = running as R | null;
      // Sessão 'running' de um dia anterior (a pessoa não fechou o cronômetro):
      // não retoma acumulando no dia velho — pausa e deixa o expediente de hoje
      // começar limpo no gap. Sem isto, o tempo de ontem vazaria pro dia de hoje.
      if (row && row.work_date && row.work_date !== brasiliaToday()) {
        try {
          await dbAny.from('activity_time_entries')
            .update({ status: 'paused', ended_at: new Date().toISOString() }).eq('id', row.id);
        } catch { /* melhor esforço */ }
        return false;
      }
      if (!row || entryRef.current || (otherOwnerRef.current && !force)) return false;

      const kind: TimerEntry['kind'] = row.activity_id ? 'activity' : (row.break_type ? 'break' : 'gap');
      lastFlushRef.current = Date.now();
      lastInteractionRef.current = Date.now();
      lastGapNudgeRef.current = row.idle_seconds || 0;
      sync({
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
      });
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
      return true;
    } catch {
      return false;
    }
  }, [getUser, sync, announceTakeover]);

  /**
   * POSSE SEGUE O FOCO. Só uma aba comanda o cronômetro; antes, a posse ficava
   * presa na aba que iniciou a atividade — as outras abas do sistema ficavam
   * SEM cronômetro na tela (nem badge) enquanto a aba esquecida seguia
   * contando. Agora, ao voltar o foco para uma aba sem posse, ela avisa as
   * demais (que salvam e soltam), espera o flush e assume a sessão do banco.
   */
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const claim = () => {
      if (document.visibilityState !== 'visible') return;
      if (entryRef.current || !otherOwnerRef.current) return; // já sou dono
      if (pending) return;
      announceTakeover(); // as outras abas flushiam e soltam
      pending = setTimeout(async () => {
        pending = null;
        if (entryRef.current || document.visibilityState !== 'visible') return;
        const took = await hydrateRunning(true);
        // Nada rodando no banco (a outra aba fechou a sessão): se o expediente
        // está aberto, esta aba reabre a linha de ociosidade.
        if (!took && !entryRef.current && shiftIdRef.current) startGap();
      }, 1200); // dá tempo do flush('paused') da aba anterior chegar ao banco
    };
    document.addEventListener('visibilitychange', claim);
    window.addEventListener('focus', claim);
    return () => {
      if (pending) clearTimeout(pending);
      document.removeEventListener('visibilitychange', claim);
      window.removeEventListener('focus', claim);
    };
  }, [announceTakeover, hydrateRunning, startGap]);

  // Ao abrir o app: recupera o ponto aberto de hoje e REIDRATA qualquer
  // sessão com status='running' no banco (atividade/pausa/gap). Antes um F5
  // resetava para "ocioso" e gerava falsa ociosidade.
  useEffect(() => {
    (async () => {
      const u = await getUser();
      if (!u) { setOnShift(false); return; }
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      // Último turno de HOJE: se ainda está aberto, o expediente está em curso;
      // se já tem saída batida, o dia foi encerrado (libera consulta no gate).
      try {
        const { data } = await dbAny.from('work_shifts').select('id, ended_at')
          .eq('user_id', u.userId)
          .gte('started_at', startOfDay.toISOString())
          .order('started_at', { ascending: false }).limit(1).maybeSingle();
        const shift = data as { id: string; ended_at: string | null } | null;
        if (shift && !shift.ended_at) {
          shiftIdRef.current = shift.id;
          setOnShift(true);
        } else {
          setOnShift(false);
          setShiftEndedToday(!!shift);
        }
      } catch { setOnShift(false); }

      // Reidrata a sessão running (activity > break > gap) para não parar no reload.
      if (await hydrateRunning()) return;

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
      // A previsão também mora na atividade (migration 20260812120000): ajustar
      // no relógio tem que valer para as próximas sessões e para o formulário,
      // senão amanhã a atividade volta com a previsão antiga.
      if (e.activityId) {
        await dbAny.from('lead_activities')
          .update({ estimated_minutes: value }).eq('id', e.activityId);
      }
    } catch (err) {
      console.warn('[activity-timer] setEstimate falhou:', err);
    }
  }, [sync]);

  const dayTotals = {
    active: dayBase.active + (current?.activeSeconds || 0),
    idle: dayBase.idle + (current?.idleSeconds || 0),
  };

  const value: ActivityTimerCtx = {
    current, lastActivity, resumeLast, reclaimTimer, dayTotals, usage, hidden, idlePrompt, leavePrompt, switchPrompt,
    startTimer, requestLeave, keepRunning, pauseAndClose, stopTimerFor,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch,
    hideTimer, showTimer, setEstimate, managerAlert, dismissManagerAlert,
    startBreak, endBreak, extendBreak, awayPrompt, dismissAwayPrompt, breakOverdue,
    onShift, shiftEndedToday, startShift, endShift, formatHMS,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivityTimer(): ActivityTimerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useActivityTimer deve ser usado dentro de ActivityTimerProvider');
  return ctx;
}

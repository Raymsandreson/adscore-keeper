import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { ArrowLeftRight, Clock, Coffee, GripVertical, Hourglass, Maximize2, Mic, Minimize2, Pause, Play, Search, Timer as TimerIcon, Users, UtensilsCrossed } from 'lucide-react';
import { TeamTimersPanel } from '@/components/activities/TeamTimersPanel';
import { db } from '@/integrations/supabase';

// Aba lateral com a atividade cronometrada (carregada sob demanda ao clicar no cronômetro).
const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then((m) => ({ default: m.ActivityFullSheet }))
);
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActivityTimer, formatHMS, BREAK_LABELS, QUICK_PAUSES, type BreakType } from '@/contexts/ActivityTimerContext';
import { useWhatsAppUmbrellaWatchdog } from '@/hooks/useWhatsAppTimeTracker';

// Registro rápido por voz ("o que estou fazendo") — carregado sob demanda.
const QuickVoiceActivityDialog = lazy(() =>
  import('@/components/activities/QuickVoiceActivityDialog').then((m) => ({ default: m.QuickVoiceActivityDialog }))
);

/** Botão de microfone que abre o registro rápido de atividade por voz. */
function VoiceActivityButton({ className, onClick, label }: { className?: string; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={className}
      title="Dizer por voz o que você está fazendo (cria uma atividade)"
    >
      <Mic className="h-3.5 w-3.5" />
      {label && <span className="text-[11px] font-medium">{label}</span>}
    </button>
  );
}

/** Botão que abre o seletor de atividade sob demanda (trocar/escolher a atividade atual, sem abrir o menu). */
function SwitchActivityButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={className}
      title="Trocar de atividade — escolher qual você está fazendo agora, sem abrir o menu"
    >
      <ArrowLeftRight className="h-3.5 w-3.5" />
    </button>
  );
}

/** Escolha de pausa: rápidas (café/lanche/descanso com previsão) + longas. */
function PauseChooser({
  onStart, onEndShift, onDone,
}: {
  onStart: (t: BreakType, note?: string, eta?: number) => void;
  onEndShift?: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'intervalo' | 'compensacao'>('menu');
  const [note, setNote] = useState('');
  const start = (t: BreakType, n?: string, eta?: number) => { onStart(t, n, eta); onDone(); };

  if (mode !== 'menu') {
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium">
          {mode === 'intervalo' ? 'Justificativa do intervalo *' : 'Acordo de compensação (opcional)'}
        </div>
        <Input
          autoFocus value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={mode === 'intervalo' ? 'Ex.: médico, resolver algo pessoal…' : 'Ex.: compensando hora extra de 15/07'}
          className="h-8 text-xs"
        />
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMode('menu')}>Voltar</Button>
          <Button size="sm" className="h-7 text-xs" disabled={mode === 'intervalo' && !note.trim()}
            onClick={() => start(mode, note.trim() || undefined)}>
            Iniciar pausa
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">Pausa rápida (previsão de retorno)</div>
      {QUICK_PAUSES.map((p) => (
        <div key={p.type} className="flex items-center justify-between gap-2">
          <span className="text-sm">{p.emoji} {BREAK_LABELS[p.type]}</span>
          <div className="flex gap-1">
            {p.etas.map((m) => (
              <button key={m} type="button" onClick={() => start(p.type, undefined, m)}
                className="px-2 py-0.5 rounded text-xs border hover:bg-accent tabular-nums">
                {m}m
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-muted-foreground pt-0.5">Vai demorar mais? Use Intervalo ou Almoço.</div>
      <div className="border-t pt-1.5 space-y-1">
        <button type="button" onClick={() => start('almoco')}
          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent">🍽️ Saída para almoço</button>
        <button type="button" onClick={() => setMode('intervalo')}
          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent">⏸️ Intervalo (justificar)</button>
        <button type="button" onClick={() => setMode('compensacao')}
          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent">🔁 Compensação de banco de horas</button>
        {onEndShift && (
          <button type="button" onClick={() => { onEndShift(); onDone(); }}
            className="w-full text-left text-sm px-2 py-1.5 rounded border-t mt-1 pt-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40">
            🏁 Encerrar expediente (saída)
          </button>
        )}
      </div>
    </div>
  );
}

/** Botão de pausa no badge (abre o PauseChooser num popover). */
function BreakMenu({ className, onStart, onEndShift }: { className?: string; onStart: (t: BreakType, note?: string, eta?: number) => void; onEndShift?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={className}
          title="Registrar pausa (café, lanche, descanso, almoço, intervalo…)"
        >
          <UtensilsCrossed className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end" side="top" className="w-64 p-2 z-[9999]"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <PauseChooser onStart={onStart} onEndShift={onEndShift} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

const ESTIMATE_CHIPS = [15, 30, 45, 60, 90, 120];

/** Segmento de previsão dentro do badge: define/edita e mostra faltam / +além (vermelho). */
function EstimateControl({
  estimateMinutes, activeSeconds, onSet,
}: {
  estimateMinutes: number | null;
  activeSeconds: number;
  onSet: (m: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const estSec = estimateMinutes ? estimateMinutes * 60 : 0;
  const over = estimateMinutes ? activeSeconds - estSec : 0;
  const near = !!estimateMinutes && over < 0 && -over <= estSec * 0.2;

  let label = 'prever';
  let cls = 'text-muted-foreground';
  if (estimateMinutes && over >= 0) { label = `+${formatHMS(over)}`; cls = 'text-red-600 dark:text-red-400 font-semibold'; }
  else if (estimateMinutes) { label = `faltam ${formatHMS(-over)}`; cls = near ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'; }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center gap-1 text-xs border-l pl-2 ml-0.5 hover:opacity-80 ${cls}`}
          title="Previsão de tempo (clique para definir)"
        >
          <Hourglass className="h-3 w-3" />
          <span className="tabular-nums">{label}{estimateMinutes ? ` · ${estimateMinutes}m` : ''}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2 z-[9999]" onPointerDown={(e) => e.stopPropagation()}>
        <div className="text-xs font-medium mb-1.5">Previsão de tempo</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {ESTIMATE_CHIPS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { onSet(m); setOpen(false); }}
              className={`px-2 py-1 rounded text-xs border hover:bg-accent ${estimateMinutes === m ? 'bg-primary text-primary-foreground border-primary' : ''}`}
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="number" min={1} value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="min" className="h-8 text-xs"
          />
          <Button size="sm" className="h-8" onClick={() => { const n = parseInt(custom, 10); if (n > 0) { onSet(n); setOpen(false); setCustom(''); } }}>
            OK
          </Button>
        </div>
        {estimateMinutes != null && (
          <button type="button" onClick={() => { onSet(null); setOpen(false); }} className="mt-2 text-xs text-muted-foreground hover:text-destructive">
            Remover previsão
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const POS_STORAGE_KEY = 'activity-timer-badge-pos';

function useDraggablePosition() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignora */ }
    return null;
  });
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLElement | null>(null);

  const clamp = (x: number, y: number) => {
    const el = elRef.current;
    const w = el?.offsetWidth ?? 160;
    const h = el?.offsetHeight ?? 40;
    const maxX = window.innerWidth - w - 4;
    const maxY = window.innerHeight - h - 4;
    return { x: Math.max(4, Math.min(x, maxX)), y: Math.max(4, Math.min(y, maxY)) };
  };

  // Cola na borda vertical (esquerda/direita) mais próxima do centro do badge.
  // Assim o cronômetro flutuante nunca descansa no meio do conteúdo — fica só nas
  // margens, sem cobrir títulos/campos. (skill: ui-sem-sobreposicao)
  const snapToEdge = (x: number, y: number) => {
    const el = elRef.current;
    const w = el?.offsetWidth ?? 160;
    const c = clamp(x, y);
    const center = c.x + w / 2;
    const snappedX = center < window.innerWidth / 2 ? 4 : Math.max(4, window.innerWidth - w - 4);
    return { x: snappedX, y: c.y };
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    elRef.current = el;
    const rect = el.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    draggingRef.current = true;
    movedRef.current = false;
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const nx = e.clientX - offsetRef.current.x;
    const ny = e.clientY - offsetRef.current.y;
    if (!movedRef.current) {
      const dx = Math.abs(e.movementX);
      const dy = Math.abs(e.movementY);
      if (dx + dy > 3) movedRef.current = true;
    }
    setPos(clamp(nx, ny));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (movedRef.current) {
      const snapped = pos ? snapToEdge(pos.x, pos.y) : pos;
      if (snapped) setPos(snapped);
      try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(snapped)); } catch { /* ignora */ }
    }
  }, [pos]);

  // Reajusta se a janela encolher
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Corrige posição salva antiga que tenha ficado no meio do conteúdo:
  // ao montar, puxa o badge para a borda mais próxima. (skill: ui-sem-sobreposicao)
  useEffect(() => {
    setPos((p) => (p ? snapToEdge(p.x, p.y) : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wasDragged = () => movedRef.current;
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : { left: 16, bottom: 16 };

  return { style, onPointerDown, onPointerMove, onPointerUp, wasDragged, setElRef: (el: HTMLElement | null) => { elRef.current = el; } };
}

/** Botão que expande o painel "Time agora" a partir do badge do cronômetro. */
function TeamPanelButton({ className, onOpenActivity }: { className?: string; onOpenActivity: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={className}
          title="Ver o que o time está fazendo agora"
        >
          <Users className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      {/* stopPropagation nos pointer events: o conteúdo é um portal React DENTRO
          do badge arrastável — sem isso, o pointerdown "sobe" até o badge, que faz
          setPointerCapture (drag) e sequestra o clique (botões ficam mortos).
          Mesmo padrão do popover da previsão (EstimateControl), que funciona. */}
      <PopoverContent
        align="end"
        side="top"
        collisionPadding={8}
        className="p-0 w-auto overflow-hidden z-[9999]"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {open && (
          <TeamTimersPanel
            onOpenActivity={(id) => { setOpen(false); onOpenActivity(id); }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Linha de totais do dia (produtivo x ocioso) no topo do badge. */
function DayTotalsRow({ active, idle }: { active: number; idle: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[11px] leading-none border-b pb-1 mb-0.5">
      <span className="text-muted-foreground uppercase tracking-wide">Hoje</span>
      <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-bold tabular-nums" title="Tempo produtivo do dia">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{formatHMS(active)}
      </span>
      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300 font-bold tabular-nums" title="Tempo ocioso do dia">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />{formatHMS(idle)}
      </span>
    </div>
  );
}

/**
 * UI global do cronômetro:
 * - Badge flutuante arrastável (posição salva no localStorage).
 * - Dialog de ociosidade, prompt continuar/pausar, seletor de troca.
 */
export function ActivityTimerOverlay() {
  const {
    current, lastActivity, resumeLast, dayTotals, hidden, idlePrompt, leavePrompt, switchPrompt,
    keepRunning, pauseAndClose, hideTimer, showTimer, setEstimate, managerAlert, dismissManagerAlert,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch, startBreak, endBreak,
    extendBreak, awayPrompt, dismissAwayPrompt, breakOverdue,
    onShift, startShift, endShift, startTimer,
  } = useActivityTimer();

  // Pausa a guarda-chuva "Atendimento WhatsApp" após 5 min sem enviar mensagem
  // (mesmo com o usuário mexendo no sistema) — volta ao estado ocioso.
  useWhatsAppUmbrellaWatchdog();

  const over = current?.kind === 'activity' && current.estimateMinutes
    ? current.activeSeconds - current.estimateMinutes * 60
    : -1;
  const isOver = over >= 0;
  // Gap com interação recente: a pessoa mexe no sistema mas SEM atividade
  // vinculada — o tempo conta como ocioso do mesmo jeito; só muda a mensagem
  // (cobrar o vínculo em vez de perguntar se vai se ausentar).
  const gapWorking = current?.kind === 'gap' && current.gapWorking !== false;

  // Tick só para re-renderizar o badge a cada segundo.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const drag = useDraggablePosition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Seletor de troca de atividade aberto sob demanda (botão ⇄ no badge).
  const [switchOpen, setSwitchOpen] = useState(false);
  // Atv de um MEMBRO aberta pelo painel Time agora — sheet fora do badge
  // (dentro dele o drag sequestraria os cliques via pointer capture).
  const [teamViewActivityId, setTeamViewActivityId] = useState<string | null>(null);
  const timedActivityId = current?.kind === 'activity' ? current.activityId : null;

  return (
    <>
      {/* Fora do expediente: só o botão de bater o ponto (nada conta, nada bipa) */}
      {onShift === false && !current && (
        <button
          type="button"
          onClick={startShift}
          className="fixed bottom-4 left-4 z-[9990] flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-50/95 dark:bg-emerald-950/60 px-3 py-2 shadow-lg backdrop-blur text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
          title="Registrar entrada — o cronômetro e o ocioso só contam com o expediente aberto"
        >
          <Play className="h-4 w-4" />
          Iniciar expediente
        </button>
      )}

      {/* Minimizado: o cronômetro nunca some — fica só o relógio; clique expande */}
      {current && hidden && (() => {
        const seconds = current.kind === 'activity' ? current.activeSeconds : current.idleSeconds;
        const palette = current.kind === 'activity'
          ? `border bg-background/95 ${isOver ? 'text-red-600 dark:text-red-400' : ''}`
          : current.kind === 'gap'
            ? 'border border-amber-300/50 bg-amber-50/95 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200'
            : 'border border-sky-300/60 bg-sky-50/95 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200';
        // Clique fica no contêiner (não num botão interno): o drag faz
        // setPointerCapture no pointerdown e o click é reentregue ao próprio
        // contêiner — botão interno nunca receberia o clique.
        return (
          <div
            ref={drag.setElRef}
            style={drag.style}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onClick={() => { if (!drag.wasDragged()) showTimer(); }}
            className={`fixed z-[9990] flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-lg backdrop-blur touch-none select-none cursor-pointer hover:opacity-90 ${palette}`}
            title="Cronômetro minimizado · clique para expandir · arraste para mover"
          >
            {current.kind === 'activity' && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            {current.kind === 'gap' && (gapWorking
              ? <Clock className="h-3 w-3" />
              : <Coffee className="h-3 w-3" />)}
            {current.kind === 'break' && <UtensilsCrossed className="h-3 w-3" />}
            <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums font-semibold">
              {formatHMS(seconds)}
              <Maximize2 className="h-3 w-3 opacity-60" />
            </span>
          </div>
        );
      })()}

      {current && current.kind === 'activity' && !hidden && (
        <div
          ref={drag.setElRef}
          style={drag.style}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          className="fixed z-[9990] flex flex-col gap-0.5 rounded-2xl border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur touch-none select-none cursor-grab active:cursor-grabbing"
          title="Arraste para mover · clique no tempo para abrir a atividade"
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} />
          <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            type="button"
            onClick={(e) => { if (drag.wasDragged()) { e.preventDefault(); e.stopPropagation(); return; } setSheetOpen(true); }}
            className="flex items-center gap-1.5 hover:opacity-80"
            title="Abrir a atividade que está sendo cronometrada"
          >
            <span className={`font-mono text-sm tabular-nums font-semibold ${isOver ? 'text-red-600 dark:text-red-400' : ''}`}>
              {formatHMS(current.activeSeconds)}
            </span>
            <span className="max-w-[140px] truncate text-xs text-muted-foreground hidden sm:inline">
              {current.activityTitle}
            </span>
          </button>
          <EstimateControl
            estimateMinutes={current.estimateMinutes}
            activeSeconds={current.activeSeconds}
            onSet={setEstimate}
          />
          <SwitchActivityButton
            className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground"
            onClick={() => setSwitchOpen(true)}
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); pauseAndClose(); }}
            className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground"
            title="Pausar e salvar o tempo"
          >
            <Pause className="h-3.5 w-3.5" />
          </button>
          <BreakMenu className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground" onStart={startBreak} onEndShift={endShift} />
          <VoiceActivityButton className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground" onClick={() => setVoiceOpen(true)} />
          <TeamPanelButton className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground" onOpenActivity={setTeamViewActivityId} />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); hideTimer(); }}
            className="rounded-full p-1 hover:bg-accent hover:text-foreground text-muted-foreground"
            title="Minimizar cronômetro (deixa só o relógio)"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      )}

      {/* Aba lateral: atividade sendo cronometrada (abre ao clicar no tempo) */}
      {timedActivityId && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            activityId={timedActivityId}
          />
        </Suspense>
      )}

      {/* Aba lateral: atividade de um membro aberta pelo painel Time agora */}
      {teamViewActivityId && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={!!teamViewActivityId}
            onOpenChange={(o) => { if (!o) setTeamViewActivityId(null); }}
            activityId={teamViewActivityId}
          />
        </Suspense>
      )}

      {current && current.kind === 'gap' && !hidden && (
        <div
          ref={drag.setElRef}
          style={drag.style}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          className="fixed z-[9990] flex flex-col gap-0.5 rounded-2xl border border-amber-300/50 bg-amber-50/95 dark:bg-amber-950/60 px-2 py-1.5 shadow-lg backdrop-blur touch-none select-none cursor-grab active:cursor-grabbing"
          title={gapWorking
            ? 'Arraste para mover · sem atividade vinculada — o tempo NÃO conta como produtivo; vincule uma atividade'
            : 'Arraste para mover · tempo ocioso entre atividades'}
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} />
          <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-amber-700/50 dark:text-amber-300/50" />
          {gapWorking ? (
            <>
              <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
              <span className="font-mono text-sm tabular-nums font-bold text-amber-800 dark:text-amber-200">
                {formatHMS(current.idleSeconds)}
              </span>
              <span className="text-xs font-medium text-amber-800 dark:text-amber-200 hidden sm:inline">sem atividade · não conta</span>
            </>
          ) : (
            <>
              <Coffee className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
              <span className="font-mono text-sm tabular-nums font-bold text-amber-800 dark:text-amber-200">
                {formatHMS(current.idleSeconds)}
              </span>
              <span className="text-xs font-medium text-amber-800 dark:text-amber-200 hidden sm:inline">ocioso</span>
            </>
          )}
          {lastActivity && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); resumeLast(); }}
              className="ml-1 flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
              title={`Recomeçar o cronômetro de: ${lastActivity.title || 'última atividade'}`}
            >
              <Play className="h-3 w-3" />
              <span className="max-w-[110px] truncate hidden sm:inline">{lastActivity.title || 'Retomar'}</span>
              <span className="sm:hidden">Retomar</span>
            </button>
          )}
          <BreakMenu className="ml-1 rounded-full p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300" onStart={startBreak} onEndShift={endShift} />
          <VoiceActivityButton
            className="ml-1 flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60"
            onClick={() => setVoiceOpen(true)}
            label="O que faço?"
          />
          <SwitchActivityButton
            className="ml-1 rounded-full p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300"
            onClick={() => setSwitchOpen(true)}
          />
          <TeamPanelButton className="rounded-full p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300" onOpenActivity={setTeamViewActivityId} />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); hideTimer(); }}
            className="rounded-full p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300"
            title="Minimizar cronômetro (deixa só o relógio)"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      )}


      {current && current.kind === 'break' && !hidden && (
        <div
          ref={drag.setElRef}
          style={drag.style}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          className="fixed z-[9990] flex flex-col gap-0.5 rounded-2xl border border-sky-300/60 bg-sky-50/95 dark:bg-sky-950/60 px-2 py-1.5 shadow-lg backdrop-blur touch-none select-none cursor-grab active:cursor-grabbing"
          title={`Pausa: ${current.activityTitle}${current.breakNote ? ` — ${current.breakNote}` : ''}`}
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} />
          <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-sky-700/50 dark:text-sky-300/50" />
          <UtensilsCrossed className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
          {(() => {
            const eta = current.estimateMinutes || 0;
            const over = eta > 0 && current.idleSeconds >= eta * 60;
            return (
              <span className={`font-mono text-sm tabular-nums font-bold ${over ? 'text-red-600 dark:text-red-400' : 'text-sky-800 dark:text-sky-200'}`}>
                {formatHMS(current.idleSeconds)}{eta > 0 ? ` / ${eta}m` : ''}
              </span>
            );
          })()}
          <span className="text-xs font-medium text-sky-800 dark:text-sky-200 hidden sm:inline">
            {current.activityTitle}
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); endBreak(); }}
            className="ml-1 flex items-center gap-1 rounded-full border border-sky-400/60 bg-white dark:bg-sky-900/60 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-800/60"
            title="Encerrar a pausa e voltar"
          >
            <Play className="h-3 w-3" />
            {current.breakType === 'almoco' ? 'Retorno do almoço' : 'Retornar'}
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); hideTimer(); }}
            className="rounded-full p-1 hover:bg-sky-200/50 dark:hover:bg-sky-800/50 text-sky-700 dark:text-sky-300"
            title="Minimizar cronômetro (deixa só o relógio)"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      )}

      {/* Ociosidade */}
      <Dialog open={idlePrompt} onOpenChange={(o) => { if (!o) confirmStillWorking(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TimerIcon className="h-5 w-5 text-amber-500" /> Ainda está nessa atividade?
            </DialogTitle>
            <DialogDescription>
              Sem interação há alguns minutos. A atividade <b>{current?.activityTitle}</b> ainda é a que você está fazendo agora?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={rejectStillWorking}>
              Não, era outra
            </Button>
            <Button onClick={confirmStillWorking}>
              Sim, continuar contando
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sair da atividade → continuar ou pausar */}
      <Dialog open={leavePrompt} onOpenChange={(o) => { if (!o) keepRunning(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> Você saiu da atividade
            </DialogTitle>
            <DialogDescription>
              Continuar cronometrando <b>{current?.activityTitle}</b> em segundo plano, ou pausar e salvar o tempo agora?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={pauseAndClose} className="gap-1">
              <Pause className="h-4 w-4" /> Pausar e salvar
            </Button>
            <Button onClick={keepRunning}>Continuar contando</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alerta da gestão: "por que está ocioso?" */}
      <Dialog open={!!managerAlert} onOpenChange={(o) => { if (!o) dismissManagerAlert(); }}>
        <DialogContent className="sm:max-w-md border-red-300 dark:border-red-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              🚨 Chamado da gestão
            </DialogTitle>
            <DialogDescription>
              <b>{managerAlert?.from || 'Gestão'}</b>: {managerAlert?.message || 'Por que você está ocioso? Retome uma atividade ou avise o que está fazendo.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => { dismissManagerAlert(); setVoiceOpen(true); }}>
              <Mic className="h-4 w-4" /> Dizer o que estou fazendo
            </Button>
            <Button onClick={dismissManagerAlert}>Entendi, vou retomar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ocioso: vai se ausentar? → registrar pausa (com previsão) ou retomar */}
      <Dialog open={awayPrompt} onOpenChange={(o) => { if (!o) dismissAwayPrompt(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-5 w-5 text-amber-500" /> Você está ocioso
            </DialogTitle>
            <DialogDescription>
              Vai se ausentar? Registre uma pausa com previsão de retorno — assim o cronômetro para de avisar até você voltar. Ou retome uma atividade.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-2">
            <PauseChooser onStart={startBreak} onDone={dismissAwayPrompt} />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="secondary" className="gap-1.5" onClick={() => { dismissAwayPrompt(); setVoiceOpen(true); }}>
              <Mic className="h-4 w-4" /> Dizer o que estou fazendo
            </Button>
            <Button variant="outline" onClick={dismissAwayPrompt}>Estou aqui, vou retomar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pausa passou do previsto → voltou? / mais tempo / virar intervalo */}
      <Dialog open={breakOverdue} onOpenChange={() => { /* fica até responder */ }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              ⏰ Sua pausa passou do previsto
            </DialogTitle>
            <DialogDescription>
              A pausa <b>{current?.activityTitle}</b> passou da previsão de retorno. Voltou ao trabalho ou precisa de mais tempo?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => extendBreak(5)}>+5 min</Button>
            <Button variant="outline" onClick={() => extendBreak(10)}>+10 min</Button>
            <Button variant="outline" onClick={() => startBreak('intervalo')}>Virar intervalo</Button>
            <Button onClick={endBreak}>Voltei ao trabalho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seletor de atividade "agora" — abre sozinho por ociosidade (switchPrompt)
          ou sob demanda pelo botão ⇄ no badge (switchOpen). */}
      <SwitchActivityDialog
        open={switchPrompt || switchOpen}
        onPick={async (a) => { setSwitchOpen(false); await switchTo(a); }}
        onClose={() => { setSwitchOpen(false); dismissSwitch(); }}
      />

      {/* Registro rápido por voz — "o que você está fazendo" (documenta o dia).
          Ao criar, inicia o cronômetro na atividade nova e abre a ficha dela. */}
      {voiceOpen && (
        <Suspense fallback={null}>
          <QuickVoiceActivityDialog
            open={voiceOpen}
            onOpenChange={setVoiceOpen}
            onCreated={async (a) => {
              await startTimer({ id: a.id, title: a.title, activity_type: a.activity_type, lead_name: a.lead_name });
              setSheetOpen(true);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

interface PickRow { id: string; title: string; activity_type: string | null; lead_name: string | null; }

function SwitchActivityDialog({
  open, onPick, onClose,
}: {
  open: boolean;
  onPick: (a: PickRow | null) => void | Promise<void>;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setTerm(''); setRows([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      let q = db
        .from('lead_activities')
        .select('id, title, activity_type, lead_name')
        .is('deleted_at', null)
        .neq('status', 'concluida')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (term.trim()) q = q.ilike('title', `%${term.trim()}%`);
      const { data } = await q;
      setRows((data as PickRow[]) || []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [term, open]);

  const hint = useMemo(() => (term ? 'Resultados' : 'Atividades recentes'), [term]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Qual atividade você está fazendo agora?</DialogTitle>
          <DialogDescription>
            Selecione para o cronômetro continuar fiel ao seu trabalho. Você também pode fechar sem escolher.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar atividade pelo assunto…"
            className="pl-8"
          />
        </div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mt-1">{hint}</div>
        <div className="max-h-72 overflow-y-auto -mx-2 px-2 divide-y">
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Carregando…</div>}
          {!loading && rows.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Nada encontrado.</div>
          )}
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r)}
              className="w-full text-left py-2 hover:bg-accent rounded px-2 transition-colors"
            >
              <div className="text-sm font-medium truncate">{r.title}</div>
              <div className="text-xs text-muted-foreground truncate">
                {[r.activity_type, r.lead_name].filter(Boolean).join(' · ') || '—'}
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onPick(null)}>Não registrar agora</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Clock, Coffee, GripVertical, Hourglass, Mic, Minimize2, Pause, Play, Search, Timer as TimerIcon, Users, UtensilsCrossed } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TeamTimersPanel } from '@/components/activities/TeamTimersPanel';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';

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
import { useFinanceUmbrellaWatchdog } from '@/hooks/useFinanceTimeTracker';

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

/** Escolha de pausa: rápidas (café/lanche/descanso com previsão) + longas (reunião/almoço/intervalo). */
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
      <div className="text-[10px] text-muted-foreground pt-0.5">Vai demorar mais? Use Reunião, Intervalo ou Almoço.</div>
      <div className="border-t pt-1.5 space-y-1">
        <button type="button" onClick={() => start('reuniao')}
          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent">🤝 Entrando em reunião</button>
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
          title="Registrar pausa (café, lanche, descanso, reunião, almoço, intervalo…)"
        >
          <UtensilsCrossed className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end" side="top" className="w-64 p-2 z-[9999]"
        collisionPadding={{ top: 8, right: 8, bottom: 8, left: contentLeftEdge() }}
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
      <PopoverContent
        align="end"
        className="w-56 p-2 z-[9999]"
        collisionPadding={{ top: 8, right: 8, bottom: 8, left: contentLeftEdge() }}
        onPointerDown={(e) => e.stopPropagation()}
      >
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

/** Folga entre o badge e a borda da área livre. */
const EDGE_GUTTER = 8;

/**
 * Borda esquerda da área livre = borda direita do MENU LATERAL.
 * O menu é `fixed z-10` e o badge é `fixed z-[9990]`: colar em `left: 4` punha o
 * cronômetro POR CIMA dos itens do menu (Contatos, Chat…). Medimos a cada uso
 * porque o menu muda de largura (16rem ↔ 3rem no modo ícone) e some no mobile.
 * O menu mobile (Sheet, `data-mobile`) é ignorado — é temporário e cobre a tela
 * inteira. (skill: ui-sem-sobreposicao)
 */
function contentLeftEdge(): number {
  if (typeof document === 'undefined') return EDGE_GUTTER;
  let edge = EDGE_GUTTER;
  const el = document.querySelector('[data-sidebar="sidebar"]:not([data-mobile])');
  if (el) {
    const r = el.getBoundingClientRect();
    // Offcanvas/escondido: o menu sai da tela (right <= 0) e não atrapalha.
    if (r.width > 0 && r.right > 0) edge = Math.round(r.right) + EDGE_GUTTER;
  }
  // Sheet/diálogo ANCORADO na borda esquerda (ex.: a atividade aberta ao lado do
  // Relatório de Atividades) é parede como o menu: a aba mora depois dele, senão
  // cai por cima do conteúdo e dos botões do cabeçalho (fechar, Tela cheia).
  // Só conta o que encosta na borda (left <= 1): diálogo centralizado não empurra
  // a aba pro meio da tela. (skill: ui-sem-sobreposicao)
  for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
    const r = d.getBoundingClientRect();
    if (r.width > 0 && r.left <= 1 && r.right > edge) edge = Math.round(r.right) + EDGE_GUTTER;
  }
  return edge;
}

/**
 * Posição da aba do cronômetro — arrastável nos DOIS eixos.
 *
 * O X já foi travado na borda do conteúdo (só o Y se movia), para o cronômetro
 * nunca descansar por cima do menu lateral. Só que ele passou a ficar preso em
 * cima da coluna da esquerda das telas (a lista de conversas do WhatsApp, por
 * exemplo) sem jeito de tirar dali: subir e descer não resolve quando a coluna
 * inteira é útil. Agora o X anda também, com a borda do conteúdo como LIMITE
 * ESQUERDO (`contentLeftEdge`) — some a prisão sem voltar a cobrir o menu.
 * (skill: ui-sem-sobreposicao)
 */
function useDraggablePosition() {
  const [pos, setPos] = useState<{ x: number | null; y: number | null }>(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          x: typeof p?.x === 'number' ? p.x : null,
          y: typeof p?.y === 'number' ? p.y : null,
        };
      }
    } catch { /* ignora */ }
    return { x: null, y: null };
  });
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLElement | null>(null);

  const clampY = (v: number) => {
    const h = elRef.current?.offsetHeight ?? 40;
    return Math.max(EDGE_GUTTER, Math.min(v, window.innerHeight - h - EDGE_GUTTER));
  };
  // Piso = borda do conteúdo (o menu lateral é parede). Teto = borda direita da
  // janela menos a largura do badge, para ele não sair pela direita.
  const clampX = (v: number) => {
    const w = elRef.current?.offsetWidth ?? 160;
    const min = contentLeftEdge();
    return Math.max(min, Math.min(v, Math.max(min, window.innerWidth - w - EDGE_GUTTER)));
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    elRef.current = el;
    const r = el.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    draggingRef.current = true;
    movedRef.current = false;
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    if (!movedRef.current && Math.abs(e.movementX) + Math.abs(e.movementY) > 3) movedRef.current = true;
    setPos({
      x: clampX(e.clientX - offsetRef.current.x),
      y: clampY(e.clientY - offsetRef.current.y),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (movedRef.current) {
      try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignora */ }
    }
  }, [pos]);

  // Reajusta se a janela encolher (ou o menu lateral mudar de largura).
  useEffect(() => {
    const onResize = () => setPos((p) => ({
      x: p.x == null ? p.x : clampX(p.x),
      y: p.y == null ? p.y : clampY(p.y),
    }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O ref só chega depois da 1ª posição: reclampa com o tamanho real (os
  // fallbacks deixariam a aba estourando as bordas de baixo/direita).
  const setElRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    if (el) setPos((p) => ({
      x: p.x == null ? p.x : clampX(p.x),
      y: p.y == null ? p.y : clampY(p.y),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wasDragged = () => movedRef.current;
  // Reclampa na leitura: com o menu expandido/recolhido entre uma sessão e
  // outra, um x salvo pode ter ficado atrás do menu.
  const edge = contentLeftEdge();
  const left = pos.x == null ? edge : Math.max(edge, pos.x);
  // Encostado na borda do conteúdo, o badge é a "aba" que sai do menu (canto
  // esquerdo reto); solto no meio da tela vira um cartão arredondado.
  const docked = left <= edge + 2;
  // Sem posição salva: rodapé da área livre, já depois do menu lateral.
  const style: React.CSSProperties = pos.y == null
    ? { left, bottom: 16, top: 'auto', right: 'auto' }
    : { left, top: pos.y, bottom: 'auto', right: 'auto' };

  return { style, docked, onPointerDown, onPointerMove, onPointerUp, wasDragged, setElRef };
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
        // left = borda do conteúdo: sem isso o painel (w-80) escorrega por cima do
        // menu lateral quando o badge está colado à esquerda. (skill: ui-sem-sobreposicao)
        collisionPadding={{ top: 8, right: 8, bottom: 8, left: contentLeftEdge() }}
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
function DayTotalsRow({ active, idle, usage }: { active: number; idle: number; usage?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[11px] leading-none border-b pb-1 mb-0.5">
      <span className="text-muted-foreground uppercase tracking-wide">Hoje</span>
      <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-bold tabular-nums" title="Tempo produtivo do dia">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{formatHMS(active)}
      </span>
      {!!usage && usage > 0 && (
        <span className="flex items-center gap-1 text-indigo-700 dark:text-indigo-300 font-bold tabular-nums" title="Uso do sistema (sem atividade vinculada) — não conta como produtivo">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />{formatHMS(usage)}
        </span>
      )}
      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300 font-bold tabular-nums" title="Tempo ocioso do dia (parado)">
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
    current, lastActivity, resumeLast, reclaimTimer, dayTotals, usage, hidden, idlePrompt, leavePrompt, switchPrompt,
    keepRunning, pauseAndClose, hideTimer, showTimer, setEstimate, managerAlert, dismissManagerAlert,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch, startBreak, endBreak,
    extendBreak, awayPrompt, dismissAwayPrompt, breakOverdue,
    onShift, startShift, endShift, startTimer,
  } = useActivityTimer();

  // Pausa a guarda-chuva "Atendimento WhatsApp" após 5 min sem enviar mensagem
  // (mesmo com o usuário mexendo no sistema) — volta ao estado ocioso.
  useWhatsAppUmbrellaWatchdog();
  // Mesma coisa para "Controle Financeiro": mantém o bridge do tracker vivo e
  // pausa a guarda-chuva após 5 min sem nenhum registro no financeiro.
  useFinanceUmbrellaWatchdog();

  const over = current?.kind === 'activity' && current.estimateMinutes
    ? current.activeSeconds - current.estimateMinutes * 60
    : -1;
  const isOver = over >= 0;
  // Gap com interação recente: a pessoa mexe no sistema mas SEM atividade
  // vinculada. O tempo NÃO é ocioso — vai para "uso do sistema" por área
  // (não conta como produtivo); o badge mostra a área e cobra o vínculo.
  const gapWorking = current?.kind === 'gap' && current.gapWorking !== false;
  // Paleta do badge sem atividade: índigo enquanto é uso do sistema (a pessoa
  // está trabalhando), âmbar quando é ociosidade de verdade.
  const gapIconBtn = gapWorking
    ? 'rounded-full p-1 hover:bg-indigo-200/50 dark:hover:bg-indigo-800/50 text-indigo-700 dark:text-indigo-300'
    : 'rounded-full p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300';
  const gapPillBtn = gapWorking
    ? 'ml-1 flex items-center gap-1 rounded-full border border-indigo-300/60 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60'
    : 'ml-1 flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60';

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

  // Cronômetro = ABA LATERAL colada na borda do conteúdo (logo depois do menu),
  // controlada por `hidden`:
  //   hidden=true  → aba fina em pé (só o tempo na vertical) — ocupa ~26px
  //   hidden=false → o cronômetro desliza da aba para a DIREITA, com os controles
  // Recolhida, a aba não cobre nada; aberto, ele recolhe sozinho no primeiro
  // clique fora. Foi o que substituiu o badge flutuante que cobria os botões dos
  // cards em qualquer posição de scroll. (skill: ui-sem-sobreposicao)
  // Portala o badge para o body: preso dentro de <main> (SidebarLayout) ele fica
  // num contexto de empilhamento e qualquer Dialog (portalado como irmão do #root)
  // pinta por cima, mesmo com z menor. Fora, no body, o z-[9990] vence o z-50 do
  // Dialog e o cronômetro fica SEMPRE por cima. (skill: ui-sem-sobreposicao)
  const dock = (el: ReactNode) => (typeof document !== 'undefined' ? createPortal(el, document.body) : el);
  // pointer-events-auto: Dialog/Sheet modal do Radix seta pointer-events:none no
  // body inteiro; sem religar aqui, os badges portalados ficam inclicáveis com um
  // modal aberto. stopPropagation no pointerdown: senão o toque no badge chega ao
  // document e o Radix fecha o dialog em uso como "clique fora" (o drag não
  // depende do bubbling — usa pointer capture no próprio elemento).
  const floatWrap = 'pointer-events-auto fixed z-[9990] shadow-lg backdrop-blur touch-none ';
  const grab = 'cursor-grab active:cursor-grabbing';
  // Aberto, o painel entra deslizando da aba para a direita.
  const slideIn = 'animate-in slide-in-from-left-4 fade-in-0 duration-200 ';
  // data-timer-badge: marca tudo que é do cronômetro para o clique-fora não
  // recolher quando o clique foi nele mesmo.
  const dragAttrs = {
    ref: drag.setElRef,
    style: drag.style,
    'data-timer-badge': '',
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { e.stopPropagation(); drag.onPointerDown(e); },
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
  };

  // Clique fora recolhe a aba. Ignora o próprio cronômetro, os popovers dele
  // (portalados pelo Radix) e diálogos/abas que ele abriu — senão escolher uma
  // pausa ou abrir a ficha fecharia o painel no meio do caminho.
  useEffect(() => {
    if (hidden || !current) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      if (t.closest('[data-timer-badge]')) return;
      if (t.closest('[data-radix-popper-content-wrapper]')) return;
      if (t.closest('[role="dialog"]')) return;
      hideTimer();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [hidden, current, hideTimer]);

  return (
    <>
      {/* Fora do expediente: só o botão de bater o ponto (nada conta, nada bipa).
          Arrastável como os badges do cronômetro — fixo no canto ele cobria o menu
          lateral (Configurações/Arquivados). Clique só dispara se não houve drag. */}
      {onShift === false && !current && dock(
        <button
          type="button"
          {...dragAttrs}
          onClick={() => { if (!drag.wasDragged()) startShift(); }}
          className={`${floatWrap}flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-50/95 dark:bg-emerald-950/60 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 select-none ${grab}`}
          title="Registrar entrada — arraste para mover · o cronômetro e o ocioso só contam com o expediente aberto"
        >
          <Play className="h-4 w-4" />
          Iniciar expediente
        </button>
      )}

      {/* Expediente ABERTO mas sem sessão nesta aba (outra janela assumiu, ou a
          contagem caiu): antes não era renderizado NADA — o cronômetro
          simplesmente sumia da tela e só voltava com F5. Agora fica esta aba de
          retomada, que reassume a contagem aqui. (skill: ui-sem-sobreposicao) */}
      {onShift === true && !current && dock(
        <button
          type="button"
          {...dragAttrs}
          onClick={() => { if (!drag.wasDragged()) reclaimTimer(); }}
          className={`${floatWrap}flex items-center gap-1.5 ${drag.docked ? 'rounded-l-none rounded-r-xl border-l-0' : 'rounded-xl'} border border-amber-300/60 bg-amber-50/95 dark:bg-amber-950/60 px-2 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60 select-none ${grab}`}
          title="Cronômetro parado nesta aba (outra janela assumiu ou a contagem caiu) — clique para retomar aqui · arraste para mover"
        >
          <Play className="h-3.5 w-3.5" />
          Retomar cronômetro
        </button>
      )}

      {/* Recolhido: aba fina em pé colada na borda do conteúdo. Mostra só o tempo
          na vertical — clique desliza o cronômetro pra direita; arrastar sobe/desce
          a aba. Recolhida ela não cobre conteúdo. (skill: ui-sem-sobreposicao) */}
      {current && hidden && (() => {
        // Navegando sem atividade: a aba fina mostra o tempo de USO da área
        // (índigo), não o ocioso — que nesse caso nem está correndo.
        // `usage &&` em vez de `usage?.seconds || 0`: enquanto a área de uso não
        // carregou (loadUsageBase é assíncrono, e no teste nem existe), o `|| 0`
        // fazia a aba mostrar 00:00 — cronômetro zerado na tela é pior que
        // mostrar o ocioso. Sem uso carregado, cai no comportamento anterior.
        const seconds = current.kind === 'activity'
          ? current.activeSeconds
          : (gapWorking && usage ? usage.seconds : current.idleSeconds);
        const palette = current.kind === 'activity'
          ? `border bg-background/95 ${isOver ? 'text-red-600 dark:text-red-400' : ''}`
          : current.kind === 'gap'
            ? (gapWorking
              ? 'border border-indigo-300/50 bg-indigo-50/95 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200'
              : 'border border-amber-300/50 bg-amber-50/95 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200')
            : 'border border-sky-300/60 bg-sky-50/95 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200';
        // Clique fica no contêiner (não num botão interno): o drag faz
        // setPointerCapture no pointerdown e o click é reentregue ao próprio
        // contêiner — botão interno nunca receberia o clique.
        return dock(
          <div
            {...dragAttrs}
            onClick={() => { if (!drag.wasDragged()) showTimer(); }}
            className={`${floatWrap}flex flex-col items-center gap-1.5 ${drag.docked ? 'rounded-l-none rounded-r-xl border-l-0' : 'rounded-xl'} px-1 py-2.5 select-none cursor-pointer hover:opacity-90 ${palette}`}
            title="Cronômetro · clique para abrir · arraste para mover (qualquer direção)"
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
            <span className="font-mono text-[11px] tabular-nums font-semibold [writing-mode:vertical-rl]">
              {formatHMS(seconds)}
            </span>
            <ChevronRight className="h-3 w-3 opacity-60" />
          </div>
        );
      })()}

      {current && current.kind === 'activity' && !hidden && dock(
        <div
          {...dragAttrs}
          className={`${floatWrap}${slideIn}flex flex-col gap-0.5 rounded-2xl border bg-background/95 px-2 py-1.5 select-none ${grab}`}
          title="Arraste para mover · clique no tempo para abrir a atividade"
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} usage={usage?.dayTotal} />
          <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            type="button"
            // stopPropagation no pointerdown: sem isso o pointerdown sobe pro
            // contêiner arrastável, que faz setPointerCapture e reentrega o click
            // ao próprio contêiner — o botão nunca receberia o clique e a aba
            // lateral não abria. Mesmo padrão dos outros botões do badge.
            onPointerDown={(e) => e.stopPropagation()}
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
            title="Recolher para a aba lateral"
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

      {current && current.kind === 'gap' && !hidden && dock(
        <div
          {...dragAttrs}
          className={`${floatWrap}${slideIn}flex flex-col gap-0.5 rounded-2xl border ${gapWorking ? 'border-indigo-300/50 bg-indigo-50/95 dark:bg-indigo-950/60' : 'border-amber-300/50 bg-amber-50/95 dark:bg-amber-950/60'} px-2 py-1.5 select-none ${grab}`}
          title={gapWorking
            ? `Uso do sistema em ${usage?.areaLabel || 'tela'} — registrado, mas NÃO conta como produtivo; vincule uma atividade`
            : 'Tempo ocioso entre atividades'}
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} usage={usage?.dayTotal} />
          <div className="flex items-center gap-1.5">
          <GripVertical className={`h-3.5 w-3.5 ${gapWorking ? 'text-indigo-700/50 dark:text-indigo-300/50' : 'text-amber-700/50 dark:text-amber-300/50'}`} />
          {gapWorking ? (
            <>
              <Clock className="h-3.5 w-3.5 text-indigo-700 dark:text-indigo-300" />
              <span className="font-mono text-sm tabular-nums font-bold text-indigo-800 dark:text-indigo-200">
                {formatHMS(usage?.seconds || 0)}
              </span>
              <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200 hidden sm:inline">
                {usage?.areaLabel || 'Sistema'} · não conta
              </span>
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
          <BreakMenu className={`ml-1 ${gapIconBtn}`} onStart={startBreak} onEndShift={endShift} />
          <VoiceActivityButton
            className={`${gapPillBtn} text-[11px] font-medium`}
            onClick={() => setVoiceOpen(true)}
            label="O que faço?"
          />
          <SwitchActivityButton
            className={`ml-1 ${gapIconBtn}`}
            onClick={() => setSwitchOpen(true)}
          />
          <TeamPanelButton className={gapIconBtn} onOpenActivity={setTeamViewActivityId} />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); hideTimer(); }}
            className={gapIconBtn}
            title="Recolher para a aba lateral"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      )}


      {current && current.kind === 'break' && !hidden && dock(
        <div
          {...dragAttrs}
          className={`${floatWrap}${slideIn}flex flex-col gap-0.5 rounded-2xl border border-sky-300/60 bg-sky-50/95 dark:bg-sky-950/60 px-2 py-1.5 select-none ${grab}`}
          title={`Pausa: ${current.activityTitle}${current.breakNote ? ` — ${current.breakNote}` : ''}`}
        >
          <DayTotalsRow active={dayTotals.active} idle={dayTotals.idle} usage={usage?.dayTotal} />
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
            {current.breakType === 'almoco' ? 'Retorno do almoço'
              : current.breakType === 'reuniao' ? 'Fim da reunião'
              : 'Retornar'}
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); hideTimer(); }}
            className="rounded-full p-1 hover:bg-sky-200/50 dark:hover:bg-sky-800/50 text-sky-700 dark:text-sky-300"
            title="Recolher para a aba lateral"
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
              {current?.kind === 'activity' && current.overdueIdle != null ? (
                <>
                  A previsão de <b>{current.activityTitle}</b> estourou
                  {current.overdueIdle > 0 ? <> há <b>{Math.max(1, Math.round(current.overdueIdle / 60))} min</b></> : null}.
                  Se você continuou nela (no PJe, por exemplo), confirme — esse período volta a contar como tempo ativo.
                </>
              ) : (
                <>Sem interação há alguns minutos. A atividade <b>{current?.activityTitle}</b> ainda é a que você está fazendo agora?</>
              )}
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

      {/* Gestão: chamado "por que está ocioso?" ou comando (pausar / encerrar expediente) */}
      <Dialog open={!!managerAlert} onOpenChange={(o) => { if (!o) dismissManagerAlert(); }}>
        <DialogContent className={`sm:max-w-md ${managerAlert?.command === 'pause' ? 'border-amber-300 dark:border-amber-800' : 'border-red-300 dark:border-red-800'}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${managerAlert?.command === 'pause' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
              {managerAlert?.command === 'pause' && '⏸️ Cronômetro pausado pela gestão'}
              {managerAlert?.command === 'end_shift' && '🚪 Expediente encerrado pela gestão'}
              {!managerAlert?.command && '🚨 Chamado da gestão'}
            </DialogTitle>
            <DialogDescription>
              <b>{managerAlert?.from || 'Gestão'}</b>: {managerAlert?.message || 'Por que você está ocioso? Retome uma atividade ou avise o que está fazendo.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            {managerAlert?.command !== 'end_shift' && (
              <Button variant="outline" className="gap-1.5" onClick={() => { dismissManagerAlert(); setVoiceOpen(true); }}>
                <Mic className="h-4 w-4" /> Dizer o que estou fazendo
              </Button>
            )}
            <Button onClick={dismissManagerAlert}>
              {managerAlert?.command === 'end_shift' ? 'Entendi' : 'Entendi, vou retomar'}
            </Button>
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

interface PickRow {
  id: string;
  title: string;
  activity_type: string | null;
  lead_name: string | null;
  status?: string | null;
  priority?: string | null;
  deadline?: string | null;
  notification_date?: string | null;
  meeting_at?: string | null;
  callback_at?: string | null;
}

/** Data-chave de "quando fazer": reunião/retorno (têm hora marcada) > prazo > lembrete. */
function keyDate(r: PickRow): Date | null {
  const raw = r.meeting_at || r.callback_at || r.deadline || r.notification_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

type Bucket = { key: string; label: string; rows: PickRow[] };

/** Agrupa pendentes por faixa de prazo relativa a hoje (o "minicalendário"). */
function bucketize(rows: PickRow[]): Bucket[] {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;
  const startTomorrow = startToday + dayMs;
  const startAfterTomorrow = startToday + 2 * dayMs;
  // Fim da semana (domingo 23:59) a partir de hoje.
  const endOfWeek = startToday + (7 - now.getDay()) * dayMs;

  const defs: Array<{ key: string; label: string; test: (t: number | null) => boolean }> = [
    { key: 'atrasadas', label: '⚠️ Atrasadas', test: (t) => t !== null && t < startToday },
    { key: 'hoje', label: 'Hoje', test: (t) => t !== null && t >= startToday && t < startTomorrow },
    { key: 'amanha', label: 'Amanhã', test: (t) => t !== null && t >= startTomorrow && t < startAfterTomorrow },
    { key: 'semana', label: 'Esta semana', test: (t) => t !== null && t >= startAfterTomorrow && t <= endOfWeek },
    { key: 'depois', label: 'Depois', test: (t) => t !== null && t > endOfWeek },
    { key: 'sem-prazo', label: 'Sem prazo', test: (t) => t === null },
  ];

  const buckets: Bucket[] = defs.map((d) => ({ key: d.key, label: d.label, rows: [] }));
  for (const r of rows) {
    const t = keyDate(r)?.getTime() ?? null;
    const def = defs.find((d) => d.test(t))!;
    buckets.find((b) => b.key === def.key)!.rows.push(r);
  }
  // Ordena dentro de cada faixa: por data-chave asc; "Sem prazo" mantém a ordem recebida.
  for (const b of buckets) {
    if (b.key === 'sem-prazo') continue;
    b.rows.sort((a, c) => (keyDate(a)!.getTime()) - (keyDate(c)!.getTime()));
  }
  return buckets.filter((b) => b.rows.length > 0);
}

function fmtWhen(d: Date | null): string | null {
  if (!d) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.getHours() || d.getMinutes()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
  if (sameDay) return time ? `hoje ${time}` : 'hoje';
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return time ? `${date} ${time}` : date;
}

function PickButton({ r, onPick }: { r: PickRow; onPick: (a: PickRow) => void }) {
  const when = fmtWhen(keyDate(r));
  const overdue = (() => { const d = keyDate(r); return d ? d.getTime() < Date.now() : false; })();
  return (
    <button
      type="button"
      onClick={() => onPick(r)}
      className="w-full text-left py-2 hover:bg-accent rounded px-2 transition-colors flex items-start justify-between gap-2"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{r.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {[r.activity_type, r.lead_name].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      {when && (
        <span className={`shrink-0 text-[11px] tabular-nums mt-0.5 ${overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
          {when}
        </span>
      )}
    </button>
  );
}

const WEEK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/**
 * Mini calendário mensal das pendentes — mesmo visual da tela de Atividades
 * (grid seg→dom, contagem por dia, hoje com anel, dia selecionado destacado).
 * Reaproveita a data-chave (keyDate) de cada pendente já carregada; clicar num
 * dia filtra a lista. Não faz query nova — só lê as `rows` que o diálogo já tem.
 */
function MiniMonthCalendar({
  month, onMonthChange, rows, selectedDay, onSelectDay,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  rows: PickRow[];
  selectedDay: string | null;
  onSelectDay: (dateKey: string | null) => void;
}) {
  const days = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }),
    [month],
  );
  const countByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const d = keyDate(r);
      if (!d) continue;
      const k = format(d, 'yyyy-MM-dd');
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [rows]);

  return (
    <div className="rounded-lg border bg-card/50 px-2 py-1.5">
      <div className="flex items-center justify-between mb-1">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMonthChange(subMonths(month, 1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-semibold capitalize">
          {format(month, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="text-[10px] font-medium text-muted-foreground py-0.5">{d}</div>
        ))}
        {/* Preenche até a 1ª coluna cair na segunda-feira (getDay 1). */}
        {Array.from({ length: (days[0]?.getDay() || 7) - 1 }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const count = countByDate[dateKey] || 0;
          const isSelected = selectedDay === dateKey;
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDay(isSelected ? null : dateKey)}
              className={cn(
                'relative p-0.5 rounded-md text-xs transition-colors',
                isToday(day) && 'ring-1 ring-primary font-bold',
                isSelected && 'bg-primary text-primary-foreground',
                !isSelected && count > 0 && 'bg-muted/60 hover:bg-muted',
                !isSelected && count === 0 && 'hover:bg-muted/30',
              )}
              title={count > 0 ? `${count} pendente${count > 1 ? 's' : ''}` : undefined}
            >
              <div className="text-center leading-tight">{format(day, 'd')}</div>
              {count > 0 && (
                <div className="flex justify-center leading-none">
                  <span className={cn('text-[8px] font-bold leading-none', isSelected ? 'text-primary-foreground/80' : 'text-destructive')}>
                    {count}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwitchActivityDialog({
  open, onPick, onClose,
}: {
  open: boolean;
  onPick: (a: PickRow | null) => void | Promise<void>;
  onClose: () => void;
}) {
  const { user } = useAuthContext();
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Estado do mini calendário: mês exibido + dia selecionado (filtra a lista).
  const [calMonth, setCalMonth] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setTerm(''); setRows([]); setSelectedDay(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      // RLS de lead_activities exige auth.uid() IS NOT NULL. Sem a sessão anônima
      // do Externo estabelecida, a query volta 0 linhas e o diálogo dizia "nenhuma
      // pendente" mesmo com atividades atribuídas. Garante a sessão antes.
      try { await ensureExternalSession(); } catch { /* RLS pode negar; segue */ }

      // Filtro pelo ASSESSOR RESPONSÁVEL PELA ATIVIDADE (não o do processo/lead nem
      // o pool sem dono). assigned_to guarda o ext_uuid; incluímos também o user.id
      // (cloud) por robustez caso o remap não esteja quente. Co-assessores casam
      // via assigned_to_ids. Nas pendentes, todo nome vem junto com o UUID — então
      // filtrar por UUID cobre 100% sem precisar casar por nome.
      const myExt = await remapToExternal(user?.id || null);
      const mine = Array.from(new Set([myExt, user?.id].filter(Boolean))) as string[];

      let q = db
        .from('lead_activities')
        // NÃO pedir callback_at aqui: a coluna ainda não foi aplicada no Externo
        // (migration 20260721120000 pendente) e o PostgREST erra a query inteira,
        // zerando a lista ("Nenhuma atividade pendente"). keyDate já cai pra
        // meeting_at/deadline/notification_date. Voltar a incluir após aplicar a migration.
        .select('id, title, activity_type, lead_name, status, priority, deadline, notification_date, meeting_at')
        .is('deleted_at', null)
        .neq('status', 'concluida');
      if (mine.length) q = q.or(`assigned_to.in.(${mine.join(',')}),assigned_to_ids.ov.{${mine.join(',')}}`);
      if (term.trim()) q = q.ilike('title', `%${term.trim()}%`);
      q = q.order('updated_at', { ascending: false }).limit(50);
      const { data, error } = await q;
      // Não engolir o erro: uma coluna inexistente no select zera a lista em
      // silêncio (foi assim que callback_at escondeu todas as pendentes).
      if (error) console.warn('[SwitchActivityDialog] falha ao carregar pendentes:', error.message);
      setRows(((data as unknown) as PickRow[]) || []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [term, open, user?.id]);

  // Sem busca → agrupa por prazo (minicalendário). Com busca → lista plana de resultados.
  const buckets = useMemo(() => (term.trim() ? [] : bucketize(rows)), [rows, term]);

  // Dia selecionado no calendário → só as pendentes daquele dia (ordenadas por hora).
  const dayRows = useMemo(() => {
    if (!selectedDay) return [];
    return rows
      .filter((r) => { const d = keyDate(r); return !!d && format(d, 'yyyy-MM-dd') === selectedDay; })
      .sort((a, b) => (keyDate(a)?.getTime() ?? 0) - (keyDate(b)?.getTime() ?? 0));
  }, [rows, selectedDay]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Qual atividade você está fazendo agora?</DialogTitle>
          <DialogDescription>
            Suas atividades pendentes, organizadas por prazo. Escolha uma para o cronômetro trocar — sem sair para a tela de Atividades.
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

        {/* Mini calendário das pendentes (só sem busca — igual aos grupos por prazo).
            Clicar num dia filtra a lista abaixo para aquele dia. */}
        {!term.trim() && (
          <MiniMonthCalendar
            month={calMonth}
            onMonthChange={setCalMonth}
            rows={rows}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        )}

        <div className="max-h-80 overflow-y-auto -mx-2 px-2">
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Carregando…</div>}
          {!loading && rows.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {term.trim() ? 'Nada encontrado.' : 'Nenhuma atividade pendente.'}
            </div>
          )}

          {/* Busca ativa: lista plana */}
          {!loading && term.trim() && (
            <div className="divide-y">
              {rows.map((r) => <PickButton key={r.id} r={r} onPick={onPick} />)}
            </div>
          )}

          {/* Sem busca + dia selecionado: só as pendentes daquele dia */}
          {!loading && !term.trim() && selectedDay && (
            <div>
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {format(new Date(`${selectedDay}T00:00:00`), "EEE, dd 'de' MMM", { locale: ptBR })}
                  <span className="opacity-60"> · {dayRows.length}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-[11px] text-primary hover:underline"
                >
                  ver todas
                </button>
              </div>
              {dayRows.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Nenhuma pendente nesse dia.</div>
              ) : (
                <div className="divide-y">
                  {dayRows.map((r) => <PickButton key={r.id} r={r} onPick={onPick} />)}
                </div>
              )}
            </div>
          )}

          {/* Sem busca e sem dia: grupos por prazo */}
          {!loading && !term.trim() && !selectedDay && buckets.map((b) => (
            <div key={b.key} className="mb-1">
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {b.label} <span className="opacity-60">· {b.rows.length}</span>
              </div>
              <div className="divide-y">
                {b.rows.map((r) => <PickButton key={r.id} r={r} onPick={onPick} />)}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onPick(null)}>Não registrar agora</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

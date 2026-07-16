import { useEffect, useMemo, useState } from 'react';
import { Clock, Coffee, Pause, Search, Timer as TimerIcon } from 'lucide-react';
import { db } from '@/integrations/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActivityTimer, formatHMS } from '@/contexts/ActivityTimerContext';

/**
 * UI global do cronômetro:
 * - Badge flutuante (visível em qualquer página) enquanto uma atv é cronometrada.
 * - Dialog de ociosidade ("ainda está fazendo X?").
 * - Dialog "continuar ou pausar" ao sair da atividade.
 * - Seletor "qual atividade agora?" após responder "Não" na ociosidade.
 */
export function ActivityTimerOverlay() {
  const {
    current, idlePrompt, leavePrompt, switchPrompt,
    requestLeave, keepRunning, pauseAndClose,
    confirmStillWorking, rejectStillWorking, switchTo, dismissSwitch,
  } = useActivityTimer();

  // Tick só para re-renderizar o badge a cada segundo.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {current && current.kind === 'activity' && (
        <button
          type="button"
          onClick={requestLeave}
          className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur hover:bg-accent transition-colors"
          title="Cronômetro em andamento — clique para pausar/continuar"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm tabular-nums font-semibold">
            {formatHMS(current.activeSeconds)}
          </span>
          <span className="max-w-[160px] truncate text-xs text-muted-foreground hidden sm:inline">
            {current.activityTitle}
          </span>
        </button>
      )}

      {current && current.kind === 'gap' && (
        <div
          className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full border border-amber-300/50 bg-amber-50/95 dark:bg-amber-950/60 px-3 py-2 shadow-lg backdrop-blur"
          title="Tempo ocioso entre atividades — abra uma atividade para retomar a contagem"
        >
          <Coffee className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="font-mono text-sm tabular-nums font-semibold text-amber-700 dark:text-amber-300">
            {formatHMS(current.idleSeconds)}
          </span>
          <span className="text-xs text-amber-700/80 dark:text-amber-300/80 hidden sm:inline">ocioso</span>
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

      {/* Seletor de atividade "agora" */}
      <SwitchActivityDialog open={switchPrompt} onPick={switchTo} onClose={dismissSwitch} />
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

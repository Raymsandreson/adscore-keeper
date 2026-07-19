import { useState, useEffect, useCallback, useRef } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { format, parseISO, startOfDay, differenceInCalendarDays } from 'date-fns';
import { Clock, RotateCcw, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';

// Check-in do dia: mostrado ao iniciar o expediente. Cobra os feedbacks pendentes
// (reabre enquanto houver, com opção de adiar — sem travar o app) e lista as
// atividades observadas que precisam de atenção (atrasadas / hoje / reagendadas).

const SNOOZE_MIN = 60; // adiar reabre o check-in depois de 1h

interface PendingFeedback {
  id: string;
  title: string;
  assigned_to_name: string | null;
  lead_name: string | null;
  case_title: string | null;
  process_title: string | null;
}

type AttentionKind = 'atrasada' | 'hoje' | 'reagendada';

interface AttentionActivity {
  id: string;
  title: string;
  status: string | null;
  deadline: string | null;
  assigned_to_name: string | null;
  lead_name: string | null;
  case_title: string | null;
  process_title: string | null;
  kind: AttentionKind;
}

interface Props {
  /** Abre o painel de Feedbacks já existente (onde a avaliação é feita). */
  onEvaluate: () => void;
}

// Linhas cruas vindas do banco (Externo), só com os campos que usamos.
interface FbRaw {
  id: string; title: string;
  assigned_to: string | null; assigned_to_name: string | null; created_by: string | null;
  observer_ids: string[] | null;
  lead_name: string | null; case_title: string | null; process_title: string | null;
}
interface ActRaw {
  id: string; title: string; status: string | null; deadline: string | null;
  assigned_to: string | null; assigned_to_name: string | null; observer_ids: string[] | null;
  lead_name: string | null; case_title: string | null; process_title: string | null;
}

const contextLabel = (r: { lead_name: string | null; case_title: string | null; process_title: string | null; title: string }) =>
  r.lead_name || r.case_title || r.process_title || r.title;

const KIND_META: Record<AttentionKind, { label: string; className: string }> = {
  atrasada:   { label: 'Atrasada',   className: 'border-red-300 text-red-700 dark:text-red-400' },
  hoje:       { label: 'Hoje',       className: 'border-amber-300 text-amber-700 dark:text-amber-400' },
  reagendada: { label: 'Reagendada', className: 'border-purple-300 text-purple-700 dark:text-purple-400' },
};

export function DailyCheckin({ onEvaluate }: Props) {
  const { user } = useAuthContext();
  const { onShift } = useActivityTimer();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedbacks, setFeedbacks] = useState<PendingFeedback[]>([]);
  const [attention, setAttention] = useState<AttentionActivity[]>([]);
  const snoozeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevShift = useRef<boolean | null>(null);

  const lsKey = (k: string) => `checkin:${k}:${user?.id || 'anon'}`;
  const todayKey = () => format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async (): Promise<number> => {
    if (!user?.id) return 0;
    setLoading(true);
    try {
      await ensureExternalSession();
      await ensureRemapCache();
      const id = (await remapToExternal(user.id)) as string | null;
      if (!id) { setFeedbacks([]); setAttention([]); return 0; }

      // Bloco 1 — feedbacks a avaliar (pendentes), exceto os que eu mesmo executei.
      const { data: fbData } = await db
        .from('lead_activities')
        .select('id, title, assigned_to, assigned_to_name, created_by, observer_ids, lead_name, case_title, process_title')
        .not('feedback', 'is', null)
        .neq('feedback', '')
        .is('deleted_at', null)
        .is('feedback_outcome', null)
        .or(`observer_ids.cs.{${id}},created_by.eq.${id}`)
        .order('updated_at', { ascending: false })
        .limit(200);
      const fb = ((fbData || []) as FbRaw[]).filter(r => r.assigned_to !== id);

      // Bloco 2 — atividades que observo, não concluídas, atrasadas / hoje / reagendadas.
      const { data: actData } = await db
        .from('lead_activities')
        .select('id, title, status, deadline, assigned_to, assigned_to_name, observer_ids, lead_name, case_title, process_title')
        .is('deleted_at', null)
        .neq('status', 'concluida')
        .or(`observer_ids.cs.{${id}}`)
        .order('deadline', { ascending: true })
        .limit(200);
      const today = startOfDay(new Date());
      const att = ((actData || []) as ActRaw[])
        .filter(r => r.assigned_to !== id)
        .map((r): AttentionActivity | null => {
          let kind: AttentionKind | null = null;
          if (r.status === 'reagendada') {
            kind = 'reagendada';
          } else if (r.deadline) {
            try {
              const diff = differenceInCalendarDays(startOfDay(parseISO(r.deadline)), today);
              if (diff < 0) kind = 'atrasada';
              else if (diff === 0) kind = 'hoje';
            } catch { /* deadline inválido: ignora */ }
          }
          return kind ? { ...r, kind } : null;
        })
        .filter((r): r is AttentionActivity => r !== null);

      setFeedbacks(fb.map(r => ({
        id: r.id, title: r.title, assigned_to_name: r.assigned_to_name,
        lead_name: r.lead_name, case_title: r.case_title, process_title: r.process_title,
      })));
      setAttention(att);
      return fb.length;
    } catch (e) {
      console.error('[DailyCheckin] load error:', e);
      return 0;
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const scheduleSnoozeReopen = useCallback((untilTs: number) => {
    if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
    const delay = Math.max(0, untilTs - Date.now());
    snoozeTimer.current = setTimeout(() => { void maybeOpen(); }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decide se abre o check-in. A cobrança é só dos feedbacks pendentes.
  const maybeOpen = useCallback(async () => {
    const fbCount = await load();
    if (fbCount <= 0) return;                         // nada a cobrar
    if (localStorage.getItem(lsKey('done')) === todayKey()) return; // já concluído hoje
    const snooze = Number(localStorage.getItem(lsKey('snooze')) || 0);
    if (Date.now() < snooze) { scheduleSnoozeReopen(snooze); return; } // adiado
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, scheduleSnoozeReopen]);

  // Gatilho 1: montagem (expediente já aberto ao entrar na página).
  useEffect(() => { void maybeOpen(); }, [maybeOpen]);

  // Gatilho 2: ao bater o ponto (Iniciar expediente) — início do dia.
  useEffect(() => {
    if (onShift === true && prevShift.current !== true) void maybeOpen();
    prevShift.current = onShift;
  }, [onShift, maybeOpen]);

  useEffect(() => () => { if (snoozeTimer.current) clearTimeout(snoozeTimer.current); }, []);

  const snooze = () => {
    const until = Date.now() + SNOOZE_MIN * 60_000;
    localStorage.setItem(lsKey('snooze'), String(until));
    scheduleSnoozeReopen(until);
    setOpen(false);
  };

  const markDone = () => {
    localStorage.setItem(lsKey('done'), todayKey());
    localStorage.removeItem(lsKey('snooze'));
    setOpen(false);
  };

  // Fechar pelo X/Esc conta como adiar (mantém a insistência); se já zerou os
  // feedbacks, conta como concluído e não incomoda mais hoje.
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      if (feedbacks.length === 0) markDone();
      else snooze();
      return;
    }
    setOpen(v);
  };

  const goEvaluate = () => { onEvaluate(); setOpen(false); };

  const hasFeedbacks = feedbacks.length > 0;
  const badgeCount = feedbacks.length;

  return (
    <>
      {/* Badge insistente: reabre o check-in enquanto houver feedback pendente. */}
      {!open && hasFeedbacks && (
        <button
          type="button"
          onClick={() => { void load(); setOpen(true); }}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-2.5 text-sm font-semibold hover:brightness-110 active:scale-95 transition"
          title="Feedbacks pendentes para avaliar"
        >
          <AlertTriangle className="h-4 w-4" />
          {badgeCount} a avaliar
        </button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg p-0 gap-0 max-h-[85dvh] flex flex-col">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              ☀️ Check-in do dia
              <span className="text-xs font-normal text-muted-foreground">{format(new Date(), 'dd/MM/yyyy')}</span>
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-5">
              {/* Bloco 1 — feedbacks a avaliar */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">📥 Feedbacks a avaliar</span>
                  <Badge variant="outline" className={cn('text-[11px]', hasFeedbacks ? 'border-primary text-primary' : 'border-green-300 text-green-700 dark:text-green-400')}>
                    {feedbacks.length}
                  </Badge>
                </div>
                {hasFeedbacks ? (
                  <div className="space-y-1.5">
                    {feedbacks.slice(0, 8).map(f => (
                      <div key={f.id} className="rounded-md border px-3 py-2 text-xs">
                        <p className="font-medium truncate" title={f.title}>{f.title}</p>
                        <p className="text-muted-foreground truncate">
                          Retorno de {f.assigned_to_name || 'responsável'} · {contextLabel(f)}
                        </p>
                      </div>
                    ))}
                    {feedbacks.length > 8 && (
                      <p className="text-[11px] text-muted-foreground pl-1">+{feedbacks.length - 8} outro(s)…</p>
                    )}
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Nenhum feedback pendente. 👏
                  </p>
                )}
              </section>

              {/* Bloco 2 — atividades observadas que precisam de atenção */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">⏰ Atividades que você observa</span>
                  <Badge variant="outline" className="text-[11px] border-slate-300">{attention.length}</Badge>
                </div>
                {attention.length > 0 ? (
                  <div className="space-y-1.5">
                    {attention.slice(0, 12).map(a => (
                      <div key={a.id} className="rounded-md border px-3 py-2 text-xs flex items-start gap-2">
                        <Badge variant="outline" className={cn('text-[10px] shrink-0', KIND_META[a.kind].className)}>
                          {KIND_META[a.kind].label}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate" title={a.title}>{a.title}</p>
                          <p className="text-muted-foreground truncate flex items-center gap-1">
                            {a.assigned_to_name || 'sem responsável'} · {contextLabel(a)}
                            {a.deadline && (
                              <span className="inline-flex items-center gap-0.5">
                                · <Clock className="h-3 w-3" /> {(() => { try { return format(parseISO(a.deadline), 'dd/MM'); } catch { return ''; } })()}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                    {attention.length > 12 && (
                      <p className="text-[11px] text-muted-foreground pl-1">+{attention.length - 12} outra(s)…</p>
                    )}
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Nada atrasado ou reagendado. ✅
                  </p>
                )}
              </section>
            </div>
          </ScrollArea>

          <DialogFooter className="px-4 py-3 border-t shrink-0 flex-row justify-end gap-2 sm:justify-end">
            {hasFeedbacks ? (
              <>
                <Button variant="ghost" size="sm" onClick={snooze} className="gap-1" disabled={loading}>
                  <RotateCcw className="h-3.5 w-3.5" /> Adiar 1h
                </Button>
                <Button size="sm" onClick={goEvaluate} className="gap-1" disabled={loading}>
                  Avaliar feedbacks <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={markDone} className="gap-1" disabled={loading}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Concluir check-in
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

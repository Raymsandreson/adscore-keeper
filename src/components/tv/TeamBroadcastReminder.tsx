import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X, Clock } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useTeamLeadership } from '@/hooks/useTeamLeadership';
import type { BroadcastPeriod } from './TeamBroadcastDialog';

const TeamBroadcastDialog = lazy(() => import('./TeamBroadcastDialog'));

// Lembrete pro gestor/diretoria logado: às 11h e às 16h, um popup convida a
// disparar a "mensagem pra todos" do time. Aparece 1x por horário/dia (por
// usuário, via localStorage). Só nudge — quem decide e revisa é o gestor.

const SLOTS = [11, 16] as const; // horas (Brasília, hora local do device)
const WINDOW_MIN = 90;           // janela após o horário pra ainda mostrar
const CHECK_MS = 60_000;
const STORAGE_KEY = 'team_broadcast_reminder_v1';

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD local
}
function slotKey(userId: string, hour: number): string {
  return `${todayKey()}:${hour}:${userId}`;
}
function isDismissed(userId: string, hour: number): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return !!raw[slotKey(userId, hour)];
  } catch { return false; }
}
function markDismissed(userId: string, hour: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    raw[slotKey(userId, hour)] = true;
    // Poda chaves de outros dias pra não crescer sem fim.
    const keep = todayKey();
    const pruned: Record<string, boolean> = {};
    for (const k of Object.keys(raw)) if (k.startsWith(keep)) pruned[k] = raw[k];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch { /* noop */ }
}

/** Horário-alvo ativo agora (11 ou 16) ainda não dispensado; senão null. */
function activeSlot(userId: string): number | null {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const h of SLOTS) {
    const start = h * 60;
    if (mins >= start && mins < start + WINDOW_MIN && !isDismissed(userId, h)) return h;
  }
  return null;
}

export default function TeamBroadcastReminder() {
  const { user } = useAuthContext();
  const { canBroadcast, managedTeams, isDirector, loading } = useTeamLeadership();
  const [slot, setSlot] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const evaluate = useCallback(() => {
    if (!user?.id || !canBroadcast) { setSlot(null); return; }
    setSlot(activeSlot(user.id));
  }, [user?.id, canBroadcast]);

  useEffect(() => {
    if (loading) return;
    evaluate();
    const id = setInterval(evaluate, CHECK_MS);
    return () => clearInterval(id);
  }, [evaluate, loading]);

  // Time-alvo do disparo: 1º time gerenciado; diretoria sem time cai no grupo gerencial.
  const target = managedTeams[0]
    ? { teamId: managedTeams[0].id, grupo: null as string | null, teamName: managedTeams[0].name }
    : isDirector
      ? { teamId: null as string | null, grupo: 'gerencial', teamName: 'Gerencial e Diretoria' }
      : null;

  const dismiss = () => {
    if (user?.id && slot != null) markDismissed(user.id, slot);
    setSlot(null);
  };
  const openNow = () => setOpen(true);
  const closeDialog = () => {
    setOpen(false);
    // Ao abrir/disparar, considera o lembrete atendido no horário.
    if (user?.id && slot != null) markDismissed(user.id, slot);
    setSlot(null);
  };

  if (!user?.id || !canBroadcast || !target) return null;

  return (
    <>
      {slot != null && !open && createPortal(
        <div className="fixed bottom-4 right-4 z-[55] w-[min(92vw,22rem)] animate-in slide-in-from-bottom-4 fade-in">
          <div className="overflow-hidden rounded-2xl border border-amber-400/40 bg-slate-900 text-white shadow-2xl">
            <div className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/20">
                <Flag className="h-5 w-5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  <Clock className="h-3.5 w-3.5" /> Lembrete das {slot}h
                </div>
                <p className="mt-1 text-sm font-bold leading-snug">Hora de dar um gás no time 🏁</p>
                <p className="mt-0.5 text-xs text-white/60">
                  Envie o resumo de desempenho de hoje pra todo mundo de <b className="text-white/80">{target.teamName}</b> de uma vez.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={openNow}
                    className="rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-black text-slate-900 transition hover:bg-amber-300">
                    Enviar agora
                  </button>
                  <button onClick={dismiss}
                    className="rounded-full px-3 py-1.5 text-xs font-bold text-white/50 transition hover:text-white">
                    Depois
                  </button>
                </div>
              </div>
              <button onClick={dismiss} className="rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white" title="Dispensar">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {open && (
        <Suspense fallback={null}>
          <TeamBroadcastDialog
            teamId={target.teamId}
            grupo={target.grupo}
            teamName={target.teamName}
            period={'hoje' as BroadcastPeriod}
            onClose={closeDialog}
          />
        </Suspense>
      )}
    </>
  );
}

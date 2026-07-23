import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X, Clock } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useTeamLeadership } from '@/hooks/useTeamLeadership';
import type { BroadcastPeriod } from './TeamBroadcastDialog';
import { pendingSlot, snooze, SNOOZE_MIN, CLOSE_SNOOZE_MIN } from '@/lib/teamBroadcastReminder';

const TeamBroadcastDialog = lazy(() => import('./TeamBroadcastDialog'));

// Lembrete pro gestor/diretoria logado: às 11h e às 16h, um popup convida a
// disparar a "mensagem pra todos" do time. Fica PENDURADO até ele disparar de
// fato (helper marca o envio) — "Depois" só adia (soneca). Persiste a reload.

const CHECK_MS = 60_000;

export default function TeamBroadcastReminder() {
  const { user } = useAuthContext();
  const { canBroadcast, managedTeams, isDirector, loading } = useTeamLeadership();
  const [slot, setSlot] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  // Marcado true quando o disparo do dialog conclui com sucesso; evita re-soneca ao fechar.
  const sentRef = useRef(false);

  const evaluate = useCallback(() => {
    if (!user?.id || !canBroadcast) { setSlot(null); return; }
    setSlot(pendingSlot(user.id));
  }, [user?.id, canBroadcast]);

  useEffect(() => {
    if (loading) return;
    evaluate();
    const id = setInterval(evaluate, CHECK_MS);
    return () => clearInterval(id);
  }, [evaluate, loading]);

  // Reavalia quando a aba volta ao foco (soneca pode ter expirado com a aba oculta).
  useEffect(() => {
    const onFocus = () => evaluate();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [evaluate]);

  // Time-alvo do disparo: 1º time gerenciado; diretoria sem time cai no grupo gerencial.
  const target = managedTeams[0]
    ? { teamId: managedTeams[0].id, grupo: null as string | null, teamName: managedTeams[0].name }
    : isDirector
      ? { teamId: null as string | null, grupo: 'gerencial', teamName: 'Gerencial e Diretoria' }
      : null;

  // "Depois" — adia (soneca), NÃO conta como enviado; volta a aparecer depois.
  const later = () => {
    if (user?.id && slot != null) snooze(user.id, slot, SNOOZE_MIN);
    setSlot(null);
  };
  const openNow = () => { sentRef.current = false; setOpen(true); };
  const closeDialog = () => {
    setOpen(false);
    // Enviou de fato → o helper já marcou; some. Fechou sem enviar → soneca curta e reaparece.
    if (!sentRef.current && user?.id && slot != null) snooze(user.id, slot, CLOSE_SNOOZE_MIN);
    evaluate();
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
                  <Clock className="h-3.5 w-3.5" /> Lembrete das {slot}h · pendente
                </div>
                <p className="mt-1 text-sm font-bold leading-snug">Hora de dar um gás no time 🏁</p>
                <p className="mt-0.5 text-xs text-white/60">
                  Você ainda não enviou o resumo de hoje pra <b className="text-white/80">{target.teamName}</b>. Mande pra todos de uma vez.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={openNow}
                    className="rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-black text-slate-900 transition hover:bg-amber-300">
                    Enviar agora
                  </button>
                  <button onClick={later}
                    className="rounded-full px-3 py-1.5 text-xs font-bold text-white/50 transition hover:text-white">
                    Depois ({SNOOZE_MIN}min)
                  </button>
                </div>
              </div>
              <button onClick={later} className="rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white" title={`Adiar ${SNOOZE_MIN} min`}>
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
            onSent={() => { sentRef.current = true; }}
            onClose={closeDialog}
          />
        </Suspense>
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AlarmClock, ArrowLeftRight, CheckCircle2, Coffee, Hourglass, ListChecks, LogOut, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useTeamLeadership } from '@/hooks/useTeamLeadership';

/**
 * Porteiro do expediente (ponto).
 *
 * Sem expediente aberto o sistema NÃO é utilizável: uma tela cheia bloqueia
 * tudo e mostra o POP de início de expediente. O único caminho para dentro é
 * bater o ponto (startShift), que já abre a contagem do dia no cronômetro.
 *
 * Quem NÃO é bloqueado:
 * - visitante sem sessão (senão a própria tela de login ficaria travada);
 * - diretoria (org_directors, via useTeamLeadership);
 * - quem JÁ ENCERROU o expediente hoje (saída batida) — depois do expediente a
 *   pessoa pode voltar só para consultar; nada é cronometrado e o cronômetro
 *   flutuante segue oferecendo "Iniciar expediente" se ela for retomar;
 * - telão /tv/atividades e páginas públicas (booking, revisar, avaliar…) —
 *   ficam fora do SidebarLayout, onde este componente é montado;
 * - as rotas de SHIFT_FREE_PATHS (ver abaixo).
 *
 * Enquanto o ponto ou a liderança ainda estão carregando, nada é bloqueado —
 * evita um flash de tela cheia em quem tem passe livre.
 */

/**
 * Rotas liberadas mesmo sem ponto batido.
 *
 * Procuração é trabalho pontual e fora de hora: o operador recebe o link
 * `/gerar-procuracao?phone=…` (disparado pela etiqueta, ver
 * railway-server/src/functions/prepare-label-document-trigger.ts) e precisa
 * mandar o documento pra assinatura na hora, sem abrir expediente só pra isso.
 * O gate continua valendo pro resto do sistema — sair desta rota trava de novo.
 */
const SHIFT_FREE_PATHS = ['/gerar-procuracao'];

export function ShiftGate() {
  const { user, loading: authLoading } = useAuthContext();
  const { onShift, shiftEndedToday, startShift } = useActivityTimer();
  const { isDirector, loading: leadershipLoading } = useTeamLeadership();
  const { pathname } = useLocation();
  const [starting, setStarting] = useState(false);

  const shiftFree = SHIFT_FREE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const blocked =
    !!user && !authLoading && !leadershipLoading && !isDirector &&
    onShift === false && !shiftEndedToday && !shiftFree;

  // Trava o scroll do documento enquanto a tela está bloqueada.
  useEffect(() => {
    if (!blocked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [blocked]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try { await startShift(); } finally { setStarting(false); }
  }, [startShift]);

  if (!blocked) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    // z acima do cronômetro flutuante (z-[9990]) e dos diálogos do Radix:
    // enquanto o ponto não é batido, nada do sistema fica alcançável.
    <div className="fixed inset-0 z-[9995] overflow-y-auto bg-background/98 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 px-4 py-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlarmClock className="h-6 w-6 shrink-0" />
            <h1 className="text-xl font-bold sm:text-2xl">Expediente não iniciado</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            O sistema só abre com o ponto batido. Fora do expediente nada é
            cronometrado — nem tempo produtivo, nem ocioso, nem pausas — e o seu
            dia ficaria sem registro nenhum.
          </p>
        </header>

        <PopCard onStart={handleStart} starting={starting} />

        <footer className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {user.email}
          </span>
          <SignOutButton />
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const POP_STEPS: { icon: typeof Play; title: string; detail: string }[] = [
  {
    icon: Play,
    title: 'Bata o ponto (entrada)',
    detail:
      'Clique em "Iniciar expediente" abaixo. A partir daí o cronômetro passa a registrar o seu dia e o sistema é liberado.',
  },
  {
    icon: ListChecks,
    title: 'Revise as suas pendentes',
    detail:
      'Comece pelas atrasadas e pelas de hoje. O seletor "Qual atividade você está fazendo agora?" mostra tudo agrupado por prazo.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Vincule a atividade que vai fazer',
    detail:
      'Tempo sem atividade vinculada NÃO conta como produtivo. Sempre que trocar de tarefa, troque também no cronômetro (botão ⇄) ou registre por voz.',
  },
  {
    icon: Hourglass,
    title: 'Defina a previsão de tempo',
    detail:
      'Previsão definida deixa o cronômetro contar como ativo mesmo com você fora da aba (PJe, por exemplo) até o tempo previsto acabar.',
  },
  {
    icon: Coffee,
    title: 'Registre as pausas',
    detail:
      'Café, lanche, almoço, intervalo ou compensação — todas pelo menu de pausa do cronômetro. Pausa registrada não vira ociosidade.',
  },
  {
    icon: CheckCircle2,
    title: 'Encerre o expediente na saída',
    detail:
      'No fim do dia use "Encerrar expediente (saída)", no mesmo menu de pausa. Sem isso o dia fica aberto e o registro sai errado.',
  },
];

function PopCard({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          POP
        </span>
        <h2 className="mt-2 text-base font-semibold sm:text-lg">Início de expediente</h2>
        <p className="text-xs text-muted-foreground">
          Procedimento padrão para abrir o dia. Faça na ordem.
        </p>
      </div>

      <ol className="space-y-3">
        {POP_STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-bold tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {step.title}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        size="lg"
        className="mt-5 w-full gap-2"
        onClick={onStart}
        disabled={starting}
        title="Registrar entrada e liberar o sistema"
      >
        <Play className="h-4 w-4" />
        {starting ? 'Registrando entrada…' : 'Iniciar expediente'}
      </Button>
    </section>
  );
}

/** Saída da conta — único caminho alternativo (ex.: logou na máquina errada). */
function SignOutButton() {
  const { signOut } = useAuthContext();
  return (
    <button
      type="button"
      onClick={() => { signOut(); }}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
      title="Sair da conta"
    >
      <LogOut className="h-3.5 w-3.5" />
      Sair da conta
    </button>
  );
}

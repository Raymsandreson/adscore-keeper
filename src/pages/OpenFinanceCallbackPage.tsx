// Retorno do banco após a autorização do consentimento (Open Finance / Celcoin).
//
// O banco devolve o titular para cá. Esta tela é de passagem: confirma o estado
// do consentimento, dispara a primeira sincronização e devolve a pessoa
// exatamente de onde ela saiu (guardado em sessionStorage antes do redirect).
// Nada aqui é ponto de chegada — ninguém deve terminar a jornada nesta página.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  useCelcoinOpenFinance,
  popCelcoinReturnTo,
  popCelcoinPendingConsent,
} from '@/hooks/useCelcoinOpenFinance';

type Phase = 'checking' | 'syncing' | 'done' | 'error';

export default function OpenFinanceCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { checkConsent, syncTransactions } = useCelcoinOpenFinance();

  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState('Confirmando a autorização com o banco…');
  // StrictMode monta duas vezes em dev; sem isto o sync dispararia em dobro.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const returnTo = popCelcoinReturnTo();
    // A Celcoin devolve o interactionId na URL; o consentimento em si foi guardado
    // antes do redirect, porque nem toda transmissora repassa o consentId de volta.
    const consentId = searchParams.get('consentId') || popCelcoinPendingConsent();

    if (!consentId) {
      setPhase('error');
      setMessage('Não foi possível identificar o consentimento no retorno do banco.');
      return;
    }

    (async () => {
      try {
        const status = await checkConsent(consentId);
        const consentStatus = status?.consent_status;

        if (consentStatus !== 'AUTHORISED') {
          setPhase('error');
          setMessage(
            consentStatus === 'REJECTED'
              ? 'A autorização foi recusada ou cancelada no banco.'
              : `O banco ainda não confirmou a autorização (${consentStatus || 'sem status'}).`,
          );
          return;
        }

        if (!user?.id) {
          setPhase('error');
          setMessage('Autorização confirmada, mas a sessão expirou. Entre novamente e sincronize.');
          return;
        }

        setPhase('syncing');
        setMessage('Autorização confirmada. Puxando o extrato…');

        // A primeira leitura costuma vir vazia por ingestão assíncrona — o handler
        // já retenta internamente, então aqui é só aguardar.
        const result = await syncTransactions({ userId: user.id, consentId });
        const total = (result?.bank_transactions || 0) + (result?.credit_card_transactions || 0);

        setPhase('done');
        setMessage(total > 0 ? `${total} lançamento(s) importado(s).` : 'Conta conectada. Nenhum lançamento novo.');
        toast.success('Conta conectada por Open Finance');
      } catch (err) {
        setPhase('error');
        setMessage(err instanceof Error ? err.message : 'Erro ao concluir a conexão.');
      } finally {
        // Some daqui de qualquer jeito: sucesso ou erro, o lugar da pessoa é a
        // tela de onde ela saiu, com o toast contando o que aconteceu.
        setTimeout(() => navigate(returnTo, { replace: true }), 2200);
      }
    })();
  }, [searchParams, checkConsent, syncTransactions, user?.id, navigate]);

  const Icon = phase === 'done' ? CheckCircle2 : phase === 'error' ? AlertTriangle : Loader2;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <Icon
        className={`h-10 w-10 ${
          phase === 'done'
            ? 'text-emerald-600'
            : phase === 'error'
              ? 'text-amber-600'
              : 'animate-spin text-muted-foreground'
        }`}
      />
      <div className="space-y-1">
        <h1 className="text-lg font-medium">
          {phase === 'error' ? 'Não foi possível concluir' : 'Conectando sua conta'}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      <p className="text-xs text-muted-foreground">Levando você de volta…</p>
    </div>
  );
}

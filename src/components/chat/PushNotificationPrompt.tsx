import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Bell, X, Loader2, Share } from 'lucide-react';
import { isPwaBannerVisible, subscribeToPwaBanner } from '@/lib/pwaBannerVisibility';

const SNOOZE_KEY = 'push-prompt-snoozed-until';
const SNOOZE_DAYS = 7;

/** O modal de instalação só se declara depois de montado: no iPhone ele espera o
 *  efeito que detecta o iOS, no Android espera o evento `beforeinstallprompt`.
 *  Sem esta espera a faixa aparecia e era derrubada um instante depois, sem dar
 *  tempo de tocar em nada. */
const SETTLE_MS = 2000;

/** Soneca em vez de "nunca mais": quem dispensa uma vez no celular voltava a
 *  nunca receber nada, e era exatamente esse o problema a resolver. */
function snoozedNow() {
  const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
  return Number.isFinite(until) && until > Date.now();
}

/**
 * Faixa global no topo que convida a ativar as notificações nativas. Aparece
 * quando dá pra ativar e ainda não está ativo — inclusive quando a permissão já
 * foi concedida em OUTRO aparelho mas este não tem assinatura (celular novo, ou
 * service worker apagado por um force-refresh). No iPhone convida a instalar na
 * tela inicial, único caminho pelo qual o iOS entrega Web Push.
 *
 * Uma vez na tela, a faixa NÃO se fecha sozinha: só sai por toque da pessoa ou
 * quando a assinatura entra de fato. Fechar sozinha é o mesmo que não existir.
 */
export function PushNotificationPrompt() {
  const push = usePushNotifications();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => snoozedNow());
  const [pwaBanner, setPwaBanner] = useState(() => isPwaBannerVisible());
  const [settled, setSettled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => subscribeToPwaBanner(setPwaBanner), []);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);

  // iPhone/iPad fora da tela inicial: o caminho é instalar, não "ativar".
  const install = push.needsInstall;
  const eligible = install
    || (push.supported && push.checked && push.permission !== 'denied');

  // Porta de mão única: abre quando dá, e daí em diante ignora o modal de
  // instalação. Enquanto o modal estiver na tela ela nem chega a abrir, então
  // não há sobreposição — e também não há mais o pisca-esconde.
  useEffect(() => {
    if (settled && !pwaBanner && eligible) setVisible(true);
  }, [settled, pwaBanner, eligible]);

  if (dismissed) return null;
  if (push.subscribed) return null;
  if (!visible) return null;

  const close = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
    setDismissed(true);
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-1rem)] max-w-md">
      <div className="flex items-center gap-2 rounded-xl border bg-card shadow-lg px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          {install ? <Share className="h-4 w-4 text-primary" /> : <Bell className="h-4 w-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-tight">
            {install ? 'Instale para receber notificações' : 'Ativar notificações'}
          </p>
          <p className="text-[11px] text-muted-foreground leading-tight truncate">
            {install
              ? 'No iPhone, o alerta só chega com o app na tela inicial.'
              : 'Receba alertas do chat da equipe mesmo com o app fechado.'}
          </p>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs shrink-0"
          disabled={push.busy}
          onClick={install ? () => navigate('/install') : push.enable}
        >
          {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (install ? 'Instalar' : 'Ativar')}
        </Button>
        <button
          onClick={close}
          className="shrink-0 text-muted-foreground hover:text-foreground p-1"
          title={`Lembrar depois (volta em ${SNOOZE_DAYS} dias; dá pra ativar em Configurações → Notificações)`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

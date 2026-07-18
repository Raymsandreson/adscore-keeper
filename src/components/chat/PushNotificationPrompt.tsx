import { useState } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Bell, X, Loader2 } from 'lucide-react';

const DISMISS_KEY = 'push-prompt-dismissed';

/**
 * Faixa global no topo que convida a ativar as notificações nativas. Aparece só
 * quando é possível ativar (suportado, permissão ainda não decidida, não assinado)
 * e o usuário não dispensou. Some sozinha após ativar. Montada no App.
 */
export function PushNotificationPrompt() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  if (dismissed) return null;
  if (!push.supported) return null;
  if (push.permission !== 'default') return null; // já concedeu ou bloqueou
  if (push.subscribed) return null;

  const close = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-1rem)] max-w-md">
      <div className="flex items-center gap-2 rounded-xl border bg-card shadow-lg px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-tight">Ativar notificações</p>
          <p className="text-[11px] text-muted-foreground leading-tight truncate">
            Receba alertas do chat da equipe mesmo com a aba fechada.
          </p>
        </div>
        <Button size="sm" className="h-7 text-xs shrink-0" disabled={push.busy} onClick={push.enable}>
          {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ativar'}
        </Button>
        <button
          onClick={close}
          className="shrink-0 text-muted-foreground hover:text-foreground p-1"
          title="Dispensar (dá pra ativar depois em Configurações → Notificações)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

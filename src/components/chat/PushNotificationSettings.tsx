import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Bell, BellRing, BellOff, Loader2 } from 'lucide-react';

/**
 * Cartão de configuração do Web Push (notificação nativa no dispositivo).
 * Ativar/desativar por dispositivo — usado na aba Notificações das Configurações.
 */
export function PushNotificationSettings() {
  const push = usePushNotifications();

  const statusText = !push.supported
    ? 'Não suportado neste navegador/dispositivo (ou aberto no preview do Lovable).'
    : push.permission === 'denied'
      ? 'Bloqueado no navegador. Libere a permissão de notificações do site para ativar.'
      : push.subscribed
        ? 'Ativadas neste dispositivo.'
        : 'Desativadas neste dispositivo.';

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Notificações no dispositivo (Web Push)</h3>
          <p className="text-xs text-muted-foreground">
            Receba alertas do chat da equipe no celular/notebook mesmo com a aba do WhatsJUD fechada.
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{statusText}</p>

      <div className="flex gap-2">
        {push.supported && push.subscribed ? (
          <Button variant="outline" size="sm" disabled={push.busy} onClick={push.disable} className="gap-1.5">
            {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
            Desativar neste dispositivo
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!push.supported || push.busy || push.permission === 'denied'}
            onClick={push.enable}
            className="gap-1.5"
          >
            {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
            Ativar notificações
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        A ativação é por dispositivo. No iPhone, é preciso instalar o WhatsJUD na tela inicial
        (Compartilhar → Adicionar à Tela de Início) para receber as notificações.
      </p>
    </div>
  );
}

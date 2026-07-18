import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';
import { Bell, BellRing, BellOff, Loader2, Send, AlertCircle } from 'lucide-react';

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

      <div className="flex flex-wrap gap-2">
        {push.supported && push.subscribed ? (
          <>
            <Button variant="outline" size="sm" disabled={push.busy} onClick={push.testNotification} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> Enviar teste
            </Button>
            <Button variant="outline" size="sm" disabled={push.busy} onClick={push.disable} className="gap-1.5">
              {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
              Desativar neste dispositivo
            </Button>
          </>
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

      {/* Guia: notificação ativada no app mas o SO pode estar bloqueando. */}
      {push.supported && push.subscribed && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/30 p-2.5">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Ativou mas não recebe? Verifique o sistema:</p>
            <p><b>Windows:</b> Configurações → Sistema → Notificações → ligue o <b>Google Chrome</b> (ou seu navegador) e desligue o <b>Assistente de foco</b>.</p>
            <p><b>Celular Android:</b> Ajustes → Apps → Chrome → Notificações ativadas.</p>
            <p><b>iPhone:</b> instale o WhatsJUD na tela inicial (Compartilhar → Adicionar à Tela de Início) — só assim o iOS entrega push.</p>
            <p>Use o <b>“Enviar teste”</b> acima para confirmar.</p>
          </div>
        </div>
      )}
    </div>
  );
}

import { toast } from 'sonner';

// Evento global para abrir o dialog de reconexão a partir de qualquer toast/erro.
export const WHATSAPP_RECONNECT_EVENT = 'whatsapp:open-reconnect';

export interface WhatsAppReconnectEventDetail {
  instanceId?: string;
  instanceName?: string;
}

export function requestWhatsAppReconnect(detail: WhatsAppReconnectEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WHATSAPP_RECONNECT_EVENT, { detail }));
}

// Detecta resposta de envio falho por instância desconectada.
// A edge function externa pode devolver error_code === 'INSTANCE_DISCONNECTED'
// ou, no caso de sessão caída de vez (UazAPI), error_code 'SEND_FAILED' com a
// mensagem crua "WhatsApp disconnected" / "session is not reconnectable".
export function isInstanceDisconnectedError(
  data: { error_code?: string; error?: string } | null | undefined,
): boolean {
  if (!data) return false;
  if (data.error_code === 'INSTANCE_DISCONNECTED') return true;
  return /disconnect|not reconnectable|not connected/i.test(String(data.error || ''));
}

// Toast amigável com atalho de Reconectar (em vez do erro técnico cru da UazAPI).
export function showInstanceDisconnectedToast(instanceId?: string, instanceName?: string) {
  toast.error(
    `Instância ${instanceName || ''} desconectada. Reconecte o WhatsApp para enviar.`.trim(),
    {
      duration: 10000,
      action: {
        label: 'Reconectar',
        onClick: () => requestWhatsAppReconnect({ instanceId, instanceName }),
      },
    },
  );
}

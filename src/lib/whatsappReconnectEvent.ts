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

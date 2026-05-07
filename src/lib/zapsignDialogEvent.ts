// Event bus for opening the ZapSign document dialog from anywhere
// without depending on the WhatsAppChat component lifecycle.

export interface ZapSignOpenPayload {
  phone: string;
  contactName?: string;
  contactId?: string;
  leadId?: string;
  legalCaseId?: string;
  instanceName?: string;
  messages?: Array<{
    direction: string;
    message_text: string | null;
    media_url?: string | null;
    media_type?: string | null;
    created_at?: string;
    timestamp?: string;
  }>;
  leadData?: any;
  contactData?: any;
  onSendMessage?: (msg: string) => Promise<any>;
}

const EVENT_NAME = 'zapsign:open';

export function openZapSignDialog(payload: ZapSignOpenPayload) {
  window.dispatchEvent(new CustomEvent<ZapSignOpenPayload>(EVENT_NAME, { detail: payload }));
}

export function onZapSignOpen(handler: (payload: ZapSignOpenPayload) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<ZapSignOpenPayload>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

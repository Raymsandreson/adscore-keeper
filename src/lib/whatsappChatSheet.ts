/**
 * Intent global "abrir esta conversa do WhatsApp".
 *
 * Mesma ideia do teamChatPanelEvents: quem dispara (clique na notificação do
 * sistema, popup interno) não precisa saber onde a conversa vai aparecer. Quem
 * escuta é o WhatsAppChatSheetHost, montado uma vez no layout.
 */
export interface WhatsAppChatSheetIntent {
  /** Telefone do contato OU JID do grupo, como está gravado na mensagem. */
  phone: string;
  /**
   * Instância que recebeu a mensagem. Mensagem de grupo existe numa linha por
   * instância da casa que participa dele — sem isso a abertura pode cair na
   * instância errada.
   */
  instanceName?: string | null;
  /** Nome do contato ou do grupo, para o cabeçalho não abrir vazio. */
  contactName?: string | null;
  /**
   * Por onde a conversa entra. 'top' é o padrão de quem veio de NOTIFICAÇÃO:
   * mantém a pilha de popups (top-center) à vista acima do painel. Quem clica
   * de dentro de uma lista (menções, relatório) pede 'bottom' — painel de baixo
   * pra cima, que é o padrão do sistema.
   */
  direction?: 'top' | 'bottom';
  nonce: string;
}

const OPEN_EVENT = 'whatsapp-chat-sheet:open';

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openWhatsAppChatSheet(intent: Omit<WhatsAppChatSheetIntent, 'nonce'>) {
  if (typeof window === 'undefined' || !intent.phone) return;

  const detail: WhatsAppChatSheetIntent = { ...intent, nonce: createIntentId() };
  window.dispatchEvent(new CustomEvent<WhatsAppChatSheetIntent>(OPEN_EVENT, { detail }));
}

export function subscribeToWhatsAppChatSheet(handler: (intent: WhatsAppChatSheetIntent) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WhatsAppChatSheetIntent>).detail;
    if (detail) handler(detail);
  };

  window.addEventListener(OPEN_EVENT, listener as EventListener);
  return () => window.removeEventListener(OPEN_EVENT, listener as EventListener);
}

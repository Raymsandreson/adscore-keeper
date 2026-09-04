/**
 * Contexto do "responder no privado" vindo de outro chat (grupo, ficha ou
 * conversa do WhatsApp). O cabeçalho entra no content na hora de enviar — aqui
 * ele só alimenta a tarja acima do campo de digitação.
 */
export interface TeamChatContextReply {
  /** Linha "↩️ Em resposta no …" já montada (teamChatMessageContext). */
  header: string;
  /** Onde a mensagem foi escrita: "grupo Financeiro", "chat interno de X". */
  scopeLabel: string;
  /** Quem escreveu a mensagem original. */
  senderName?: string | null;
  /** Trecho citado, para a tarja. */
  excerpt: string;
}

export interface TeamChatOpenIntent {
  /** Conversa a abrir. Vazio quando o pedido é a tela de "Nova Conversa". */
  conversationId?: string;
  draft?: string;
  focusComposer?: boolean;
  contextReply?: TeamChatContextReply;
  /** Abre o seletor de pessoa/grupo em vez de uma conversa existente. */
  newChat?: boolean;
  nonce: string;
}

const TEAM_CHAT_OPEN_EVENT = 'team-chat:open-conversation';

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openTeamChatConversation(intent: Omit<TeamChatOpenIntent, 'nonce'>) {
  if (typeof window === 'undefined') return;

  const detail: TeamChatOpenIntent = {
    ...intent,
    nonce: createIntentId(),
  };

  window.dispatchEvent(new CustomEvent<TeamChatOpenIntent>(TEAM_CHAT_OPEN_EVENT, { detail }));
}

/**
 * Abre o Chat da Equipe já na tela de "Nova Conversa" (pessoa ou grupo). É o
 * caminho de quem está nas menções e quer falar com alguém que ainda não te
 * marcou — o painel de menções não tem lista de conversas própria.
 */
export function openTeamChatNewConversation() {
  openTeamChatConversation({ newChat: true });
}

export function subscribeToTeamChatConversation(handler: (intent: TeamChatOpenIntent) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<TeamChatOpenIntent>;
    if (customEvent.detail) {
      handler(customEvent.detail);
    }
  };

  window.addEventListener(TEAM_CHAT_OPEN_EVENT, listener as EventListener);

  return () => {
    window.removeEventListener(TEAM_CHAT_OPEN_EVENT, listener as EventListener);
  };
}
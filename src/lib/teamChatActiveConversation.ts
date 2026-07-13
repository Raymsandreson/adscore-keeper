// Rastreia qual conversa do Chat da Equipe está aberta na tela,
// pra suprimir popups de notificação da conversa que o usuário já está vendo.

type Listener = (conversationId: string | null) => void;

let activeConversationId: string | null = null;
const listeners = new Set<Listener>();

export function setActiveTeamChatConversation(conversationId: string | null) {
  activeConversationId = conversationId;
  listeners.forEach((listener) => listener(conversationId));
}

export function getActiveTeamChatConversation() {
  return activeConversationId;
}

export function subscribeActiveTeamChatConversation(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

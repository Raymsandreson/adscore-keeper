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

// Mesma ideia para o chat de ficha (atividade, lead, processo, contato, POP):
// quem está com aquele chat aberto não precisa de popup do que já está vendo.
// Chave = `${entity_type}:${entity_id}`.
let activeEntityKey: string | null = null;

export function setActiveTeamChatEntity(key: string | null) {
  activeEntityKey = key;
}

export function getActiveTeamChatEntity() {
  return activeEntityKey;
}

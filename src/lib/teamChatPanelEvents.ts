export interface TeamChatOpenIntent {
  conversationId: string;
  draft?: string;
  focusComposer?: boolean;
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
/**
 * Intent global "abrir a configuração deste agente".
 *
 * Mesma ideia do whatsappChatSheet: quem dispara (menu da conversa, cabeçalho do
 * chat, popup do aviso) não precisa carregar a tela de configuração junto — só
 * pede. Quem escuta é o AgentConfigSheetHost, montado uma vez no App.
 *
 * Existe porque configurar um agente obrigava a sair da conversa, ir em
 * Configurações → Agentes IA e procurar o agente na lista — com a conversa que
 * motivou o ajuste já fora da tela.
 */
export interface AgentConfigSheetIntent {
  /** Agente a abrir já em edição. Sem isto, abre a lista. */
  agentId?: string | null;
  nonce: string;
}

const OPEN_EVENT = 'agent-config-sheet:open';

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function abrirConfigDoAgente(intent: Omit<AgentConfigSheetIntent, 'nonce'> = {}) {
  if (typeof window === 'undefined') return;
  const detail: AgentConfigSheetIntent = { ...intent, nonce: createIntentId() };
  window.dispatchEvent(new CustomEvent<AgentConfigSheetIntent>(OPEN_EVENT, { detail }));
}

export function subscribeToAgentConfigSheet(handler: (intent: AgentConfigSheetIntent) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AgentConfigSheetIntent>).detail;
    if (detail) handler(detail);
  };

  window.addEventListener(OPEN_EVENT, listener as EventListener);
  return () => window.removeEventListener(OPEN_EVENT, listener as EventListener);
}

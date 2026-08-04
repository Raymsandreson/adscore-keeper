/**
 * Canal para mandar uma citação para o chat interno da equipe.
 *
 * Serve o fluxo "quero discutir ESTA mensagem com a equipe": a origem (ex.: uma
 * bolha do WhatsApp) manda o trecho já formatado e o TeamChatPanel da entidade
 * correspondente cola no rascunho.
 *
 * O intent fica pendente até alguém consumir porque o painel costuma estar
 * fechado na hora do clique — quem abre é o próprio clique, e o painel só monta
 * depois. Sem isso o evento se perderia.
 */
export interface TeamChatQuoteIntent {
  entityType: string;
  entityId: string;
  /** Texto já pronto para o rascunho (com "> " em cada linha). */
  text: string;
  nonce: string;
}

const TEAM_CHAT_QUOTE_EVENT = 'team-chat:quote';
const pending = new Map<string, TeamChatQuoteIntent>();

const keyOf = (entityType: string, entityId: string) => `${entityType}::${entityId}`;

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function quoteInTeamChat(intent: Omit<TeamChatQuoteIntent, 'nonce'>) {
  if (typeof window === 'undefined') return;
  const detail: TeamChatQuoteIntent = { ...intent, nonce: createIntentId() };
  pending.set(keyOf(detail.entityType, detail.entityId), detail);
  window.dispatchEvent(new CustomEvent<TeamChatQuoteIntent>(TEAM_CHAT_QUOTE_EVENT, { detail }));
}

/** Pega (e descarta) a citação que chegou antes do painel montar. */
export function consumePendingTeamChatQuote(entityType: string, entityId: string) {
  const k = keyOf(entityType, entityId);
  const intent = pending.get(k);
  if (intent) pending.delete(k);
  return intent ?? null;
}

export function subscribeToTeamChatQuote(
  entityType: string,
  entityId: string,
  handler: (intent: TeamChatQuoteIntent) => void
) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TeamChatQuoteIntent>).detail;
    if (!detail || detail.entityType !== entityType || detail.entityId !== entityId) return;
    pending.delete(keyOf(entityType, entityId));
    handler(detail);
  };

  window.addEventListener(TEAM_CHAT_QUOTE_EVENT, listener as EventListener);
  return () => window.removeEventListener(TEAM_CHAT_QUOTE_EVENT, listener as EventListener);
}

/** Formata mensagens citadas no padrão do rascunho ("> autor · hora: texto"). */
export function formatQuotedMessages(
  items: Array<{ who: string; when?: string; text: string }>,
  maxCharsPerMessage = 400
) {
  return items
    .filter(i => i.text?.trim())
    .map(i => {
      const raw = i.text.trim();
      const body = raw.length > maxCharsPerMessage ? `${raw.slice(0, maxCharsPerMessage)}…` : raw;
      const head = `${i.who}${i.when ? ` · ${i.when}` : ''}`;
      return [`> ${head}:`, ...body.split('\n').map(l => `> ${l}`)].join('\n');
    })
    .join('\n>\n');
}

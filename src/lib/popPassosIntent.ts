/**
 * Intent global "abrir os passos do POP aqui do lado".
 *
 * Mesma ideia do `movimentacaoSheet` e do `whatsappChatSheet`: quem dispara
 * (a atividade recém-criada, um atalho de lista) não precisa montar a ficha
 * inteira só pra chegar na aba lateral dos passos. Quem escuta é o
 * `PopPassosAoCriarHost`, montado uma vez no App — e ele abre a MESMA aba
 * lateral da barra de progresso (mesma marcação, mesmo log, mesmas regras),
 * sem tirar a pessoa de onde ela está.
 *
 * Por que existe: atividade criada com POP saía sem ninguém dizer se algum
 * passo já tinha sido dado, e o POP ficava parado na fase errada até alguém
 * lembrar. Agora a criação pergunta (pedido do usuário, 14/09/2026).
 */
export interface PopPassosIntent {
  leadId: string;
  /** Board do POP/funil que mede esta atividade. Sem ele não há o que abrir. */
  boardId: string;
  processId?: string | null;
  activityId?: string | null;
  /**
   * true: o host PERGUNTA antes ("já foi dado algum passo?") e só abre os
   * passos se a pessoa disser que sim. false: abre direto.
   */
  perguntar?: boolean;
  /** Assunto da atividade — só pra pergunta não sair genérica. */
  atividadeTitulo?: string | null;
  nonce: string;
}

const OPEN_EVENT = 'pop-passos:open';

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function abrirPassosDoPop(intent: Omit<PopPassosIntent, 'nonce'>) {
  // Sem lead ou sem board não existe POP pra abrir — e um painel vazio seria
  // pior que o clique não fazer nada.
  if (typeof window === 'undefined' || !intent.leadId || !intent.boardId) return;

  const detail: PopPassosIntent = { ...intent, nonce: createIntentId() };
  window.dispatchEvent(new CustomEvent<PopPassosIntent>(OPEN_EVENT, { detail }));
}

export function subscribeToPopPassos(handler: (intent: PopPassosIntent) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PopPassosIntent>).detail;
    if (detail) handler(detail);
  };

  window.addEventListener(OPEN_EVENT, listener as EventListener);
  return () => window.removeEventListener(OPEN_EVENT, listener as EventListener);
}

/**
 * Intent global "abrir esta movimentação do processo".
 *
 * Mesma ideia do whatsappChatSheet: quem dispara (clique na notificação do
 * sistema, popup interno, card do sino) não precisa saber onde a movimentação
 * vai aparecer. Quem escuta é o MovimentacaoSheetHost, montado uma vez no
 * layout — e ele abre o painel DE BAIXO PRA CIMA por cima da tela atual, em vez
 * de mandar a pessoa para o kanban do lead (o que a URL da notificação fazia
 * até 01/09/2026).
 */
export interface MovimentacaoSheetIntent {
  /**
   * `lead_processes.id` — o processo cujas movimentações o painel mostra. Pode
   * vir null quando só o id da movimentação é conhecido (aviso antigo, link
   * copiado): o host resolve o processo pela própria linha antes de abrir.
   */
  processId?: string | null;
  /** A movimentação que gerou o aviso: entra destacada na lista. */
  updateId?: string | null;
  /** Título/CNJ para o cabeçalho não abrir vazio enquanto a lista carrega. */
  processLabel?: string | null;
  nonce: string;
}

const OPEN_EVENT = 'movimentacao-sheet:open';

function createIntentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function abrirMovimentacaoSheet(intent: Omit<MovimentacaoSheetIntent, 'nonce'>) {
  // Sem processo E sem movimentação não há o que abrir — e um painel vazio
  // seria pior que o clique não fazer nada.
  if (typeof window === 'undefined' || (!intent.processId && !intent.updateId)) return;

  const detail: MovimentacaoSheetIntent = { ...intent, nonce: createIntentId() };
  window.dispatchEvent(new CustomEvent<MovimentacaoSheetIntent>(OPEN_EVENT, { detail }));
}

export function subscribeToMovimentacaoSheet(handler: (intent: MovimentacaoSheetIntent) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<MovimentacaoSheetIntent>).detail;
    if (detail) handler(detail);
  };

  window.addEventListener(OPEN_EVENT, listener as EventListener);
  return () => window.removeEventListener(OPEN_EVENT, listener as EventListener);
}

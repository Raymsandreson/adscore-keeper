/**
 * Recibo de entrega da WhatsApp Cloud API, traduzido para a bolha da conversa.
 *
 * Por que existe: a Graph API aceita a mensagem e devolve `wamid` mesmo quando
 * ela NÃO vai ser entregue. A recusa chega ~1s depois, num webhook de status
 * separado. Sem mostrar isso na tela, "enviada" vira sinônimo de "chegou" — e a
 * equipe segue achando que falou com o cliente quando não falou.
 *
 * O webhook grava em `whatsapp_messages.status` (sent → delivered → read, ou
 * failed) e o motivo da falha em `metadata.delivery_error`.
 */

export type DeliveryTone = 'muted' | 'ok' | 'read' | 'error';

export interface DeliveryBadge {
  label: string;
  icon: 'check' | 'check-double' | 'alert';
  tone: DeliveryTone;
  /** Texto do title= — explica o estado sem ocupar espaço na bolha. */
  title: string;
}

/**
 * Motivos de falha que valem explicação em português. O texto da Meta
 * ("Re-engagement message") não diz à equipe o que fazer.
 */
const MOTIVO_POR_CODIGO: Record<number, string> = {
  131047:
    'Fora da janela de 24h: o cliente não escreve há mais de um dia, então o WhatsApp só aceita template.',
  131026: 'O número não tem WhatsApp ou não pode receber mensagens.',
  131051: 'Tipo de mensagem não suportado pelo destinatário.',
  132000: 'O template não bate com o número de parâmetros esperado.',
  132001: 'Template não existe ou não está aprovado nesse idioma.',
  131049: 'A Meta limitou a entrega para preservar a experiência do usuário.',
  130472: 'Número fora do experimento de entrega da Meta.',
};

export function motivoDaFalha(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const err = (metadata as Record<string, unknown>).delivery_error;
  if (!err || typeof err !== 'object') return null;
  const { code, title } = err as { code?: number; title?: string };
  if (typeof code === 'number' && MOTIVO_POR_CODIGO[code]) {
    return `${MOTIVO_POR_CODIGO[code]} (erro ${code})`;
  }
  if (title) return `${title}${typeof code === 'number' ? ` (erro ${code})` : ''}`;
  return typeof code === 'number' ? `Erro ${code}` : null;
}

/**
 * Devolve o selo da bolha, ou null quando não há nada a mostrar — mensagem
 * recebida, ou enviada por canal que não reporta entrega (UazAPI).
 */
export function deliveryBadge(
  direction: string | null | undefined,
  status: string | null | undefined,
  metadata?: unknown,
): DeliveryBadge | null {
  if (direction !== 'outbound') return null;

  switch (status) {
    case 'sent':
      return {
        label: 'enviada',
        icon: 'check',
        tone: 'muted',
        // Deliberadamente NÃO diz "entregue": a Meta aceitou, e só.
        title: 'Aceita pelo WhatsApp. Ainda sem confirmação de entrega.',
      };
    case 'delivered':
      return {
        label: 'entregue',
        icon: 'check-double',
        tone: 'ok',
        title: 'Chegou no aparelho do destinatário.',
      };
    case 'read':
      return {
        label: 'lida',
        icon: 'check-double',
        tone: 'read',
        title: 'O destinatário abriu a mensagem.',
      };
    case 'failed':
      return {
        label: 'não entregue',
        icon: 'alert',
        tone: 'error',
        title: motivoDaFalha(metadata) || 'O WhatsApp recusou a entrega.',
      };
    default:
      return null;
  }
}

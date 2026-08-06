/**
 * Pendências do CLIENTE — tipos e regras puras.
 *
 * "Pendência do cliente" é o que ELE ficou de fazer (avaliar no Google, gravar
 * o depoimento, mandar um documento), combinado quase sempre por áudio no
 * WhatsApp. Não confundir com `lead_activities`, que é tarefa do assessor e
 * entra em cronômetro, banco de horas e ranking do telão.
 *
 * Aqui fica só o que dá pra testar sem banco e sem React.
 */

export type CommitmentKind =
  | 'avaliacao_google'
  | 'depoimento'
  | 'documento'
  | 'comparecimento'
  | 'pagamento'
  | 'outro';

export type CommitmentStatus = 'combinado' | 'cobrado' | 'feito' | 'desistiu';

export interface ClientCommitment {
  id: string;
  lead_id: string | null;
  process_id: string | null;
  contact_id: string | null;
  phone: string | null;
  instance_name: string | null;
  title: string;
  kind: CommitmentKind;
  status: CommitmentStatus;
  due_date: string | null;
  promised_at: string;
  source_message_id: string | null;
  source_message_text: string | null;
  notes: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  done_at: string | null;
  done_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
}

export const COMMITMENT_KINDS: Array<{
  value: CommitmentKind;
  label: string;
  emoji: string;
  /** Título sugerido ao escolher o tipo — o usuário pode reescrever. */
  suggestion: string;
}> = [
  { value: 'avaliacao_google', label: 'Avaliar no Google', emoji: '⭐', suggestion: 'Avaliar o escritório no Google' },
  { value: 'depoimento', label: 'Vídeo de depoimento', emoji: '🎥', suggestion: 'Gravar vídeo de depoimento' },
  { value: 'documento', label: 'Enviar documento', emoji: '📄', suggestion: 'Enviar documento' },
  { value: 'comparecimento', label: 'Comparecer', emoji: '📍', suggestion: 'Comparecer no dia marcado' },
  { value: 'pagamento', label: 'Pagamento', emoji: '💰', suggestion: 'Efetuar o pagamento combinado' },
  { value: 'outro', label: 'Outro', emoji: '📌', suggestion: '' },
];

export function kindMeta(kind: CommitmentKind) {
  return COMMITMENT_KINDS.find((k) => k.value === kind) || COMMITMENT_KINDS[COMMITMENT_KINDS.length - 1];
}

export const OPEN_COMMITMENT_STATUSES: CommitmentStatus[] = ['combinado', 'cobrado'];

export function isCommitmentOpen(status: CommitmentStatus): boolean {
  return OPEN_COMMITMENT_STATUSES.includes(status);
}

/** Vencida = em aberto E com prazo anterior a hoje. Sem prazo nunca vence. */
export function isCommitmentOverdue(
  item: Pick<ClientCommitment, 'status' | 'due_date'>,
  today = new Date().toISOString().slice(0, 10)
): boolean {
  if (!isCommitmentOpen(item.status)) return false;
  if (!item.due_date) return false;
  return item.due_date < today;
}

/**
 * Texto de cobrança sugerido — vai para o campo de mensagem da conversa,
 * NUNCA é enviado sozinho. O assessor revisa e envia.
 */
export function buildReminderText(
  item: Pick<ClientCommitment, 'kind' | 'title'>,
  clientName: string
): string {
  const first = (clientName || '').trim().split(/\s+/)[0] || '';
  const hi = first ? `Oi, ${first}! ` : 'Oi! ';

  switch (item.kind) {
    case 'avaliacao_google':
      return `${hi}Passando pra lembrar da avaliação no Google que você ficou de fazer pra gente. É rapidinho e ajuda muito o escritório 🙏`;
    case 'depoimento':
      return `${hi}Lembra do vídeo de depoimento que você ficou de gravar pra gente? Pode ser bem simples, do jeito que você preferir 🙂`;
    case 'documento':
      return `${hi}Tudo bem? Ficou de nos enviar: ${item.title}. Consegue mandar por aqui mesmo?`;
    case 'comparecimento':
      return `${hi}Passando pra confirmar: ${item.title}. Está tudo certo pra você?`;
    case 'pagamento':
      return `${hi}Passando pra lembrar de: ${item.title}. Qualquer dúvida é só falar comigo.`;
    default:
      return `${hi}Passando pra lembrar de: ${item.title}. Consegue resolver essa semana?`;
  }
}

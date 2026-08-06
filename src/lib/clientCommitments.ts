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

/**
 * Rótulo curto e LIVRE, escrito pela IA a partir da conversa ("documento",
 * "depoimento", "perícia"). Já foi uma lista fechada de seis opções — errado:
 * o cliente promete coisa que nenhuma lista prevê, e o assessor não vai parar
 * pra escolher categoria no meio do atendimento.
 */
export type CommitmentKind = string;

export type CommitmentStatus = 'combinado' | 'cobrado' | 'feito' | 'desistiu' | 'descartada';

/** 'ia' = detectada na conversa pela IA; 'manual' = alguém digitou. */
export type CommitmentOrigin = 'ia' | 'manual';

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
  origin: CommitmentOrigin;
  ai_confidence: number | null;
}

export const OPEN_COMMITMENT_STATUSES: CommitmentStatus[] = ['combinado', 'cobrado'];

export function isCommitmentOpen(status: CommitmentStatus): boolean {
  return OPEN_COMMITMENT_STATUSES.includes(status);
}

/**
 * "Não era pendência" — a IA errou e alguém marcou. Não é uma pendência
 * resolvida: some da tela inteira, e serve só para a IA não registrar de novo.
 */
export function isCommitmentDismissed(status: CommitmentStatus): boolean {
  return status === 'descartada';
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
  // `kind` é texto livre da IA, então casa por palavra-chave em vez de enum.
  const k = `${item.kind || ''} ${item.title || ''}`.toLowerCase();

  if (k.includes('googl') || k.includes('avalia')) {
    return `${hi}Passando pra lembrar da avaliação no Google que você ficou de fazer pra gente. É rapidinho e ajuda muito o escritório 🙏`;
  }
  if (k.includes('depoiment') || k.includes('vídeo') || k.includes('video')) {
    return `${hi}Lembra do vídeo de depoimento que você ficou de gravar pra gente? Pode ser bem simples, do jeito que você preferir 🙂`;
  }
  if (k.includes('document') || k.includes('enviar') || k.includes('mandar') || k.includes('foto')) {
    return `${hi}Tudo bem? Ficou de nos enviar: ${item.title}. Consegue mandar por aqui mesmo?`;
  }
  if (k.includes('comparec') || k.includes('perícia') || k.includes('pericia') || k.includes('audiência') || k.includes('audiencia')) {
    return `${hi}Passando pra confirmar: ${item.title}. Está tudo certo pra você?`;
  }
  if (k.includes('pag')) {
    return `${hi}Passando pra lembrar de: ${item.title}. Qualquer dúvida é só falar comigo.`;
  }
  return `${hi}Passando pra lembrar de: ${item.title}. Consegue resolver essa semana?`;
}

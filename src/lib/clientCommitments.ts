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

/**
 * Palavras que não distinguem uma pendência de outra.
 *
 * "Fazer a visita do caso do Morumbi" e "Realizar a visita do caso do Morumbi"
 * são a MESMA promessa — a IA reescreve com outro verbo a cada leitura, e o
 * dedup por título exato deixava as duas passarem (visto em produção em
 * 06/08/2026, painel com seis pendências e duas repetidas).
 *
 * Espelhado em `railway-server/src/functions/detect-client-commitments.ts`,
 * que aplica a mesma regra antes de gravar. Esta é a fonte da regra.
 */
const COMMITMENT_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'pra', 'pro', 'por', 'com', 'ao', 'aos', 'e', 'que', 'se', 'ja', 'vai', 'ir',
  'fazer', 'realizar', 'efetuar', 'providenciar', 'enviar', 'mandar', 'levar', 'dar',
  'sobre', 'antes', 'depois', 'durante',
]);

/** Palavras que realmente identificam a pendência. */
export function commitmentKeyTokens(title: string): Set<string> {
  return new Set(
    (title || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !COMMITMENT_STOPWORDS.has(w))
  );
}

/**
 * Duas pendências são a mesma quando as palavras que importam coincidem em 70%
 * ou mais (Jaccard). Acima disso é reescrita da mesma promessa; abaixo, são
 * coisas diferentes ("visita do Morumbi" × "visita de Itatiba").
 */
export function isSameCommitmentTitle(a: string, b: string): boolean {
  const na = (a || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const nb = (b || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = commitmentKeyTokens(a);
  const tb = commitmentKeyTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}

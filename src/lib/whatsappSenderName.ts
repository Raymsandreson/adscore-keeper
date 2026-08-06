/**
 * Quem da equipe escreveu uma mensagem enviada.
 *
 * `whatsapp_messages` não guarda o autor: quando "Identificar remetente" está
 * ligado, `useWhatsAppMessages.sendMessage` prefixa o texto com `*Nome:*` antes
 * de enviar (pode vir com título de tratamento — `*Dra. Ana Souza:*`). Como uma
 * instância costuma ter vários donos ("Atendimento Previdenciário" tem 42
 * pessoas com acesso), esse prefixo é a única pista de quem falou com o cliente.
 *
 * Serve para pré-selecionar quem resolveu uma pendência — nunca para afirmar
 * autoria sozinho: mensagem sem prefixo devolve null e quem decide é o usuário.
 */

/** Títulos de tratamento que o sistema prefixa antes do nome. */
const TREATMENT_TITLES = ['dr', 'dra', 'sr', 'sra', 'exmo', 'exma'];

/**
 * Extrai o nome do prefixo `*Nome:*` da primeira linha. Devolve null quando a
 * mensagem não tem prefixo (envio anônimo, mensagem do agente de IA, mídia).
 */
export function extractSenderName(messageText: string | null | undefined): string | null {
  const first = (messageText || '').split('\n')[0]?.trim();
  if (!first) return null;

  const m = first.match(/^\*([^*:]{2,60}):\*$/);
  if (!m) return null;

  const nome = m[1].trim();
  if (!nome) return null;

  // Tira o título de tratamento: "Dra. Ana Souza" → "Ana Souza".
  const partes = nome.split(/\s+/);
  const primeiro = partes[0].replace(/\.$/, '').toLowerCase();
  if (partes.length > 1 && TREATMENT_TITLES.includes(primeiro)) {
    return partes.slice(1).join(' ');
  }
  return nome;
}

/**
 * Último nome identificado nas mensagens ENVIADAS da conversa — quem falou com
 * o cliente por último. Percorre de trás para frente.
 */
export function lastSenderName(
  messages: Array<{ direction?: string | null; message_text?: string | null }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.direction !== 'outbound') continue;
    const nome = extractSenderName(m.message_text);
    if (nome) return nome;
  }
  return null;
}

/**
 * Casa o nome do prefixo com um membro da equipe. O prefixo pode estar
 * abreviado (`first_last`: "Ana Souza" para "Ana Carolina Moreira Souza"),
 * então compara primeiro + último nome quando o nome inteiro não bate.
 */
export function matchMemberByName<T extends { full_name?: string | null }>(
  nome: string | null | undefined,
  members: T[]
): T | null {
  const alvo = normalizeName(nome);
  if (!alvo) return null;

  const exato = members.find((m) => normalizeName(m.full_name) === alvo);
  if (exato) return exato;

  const porExtremos = members.filter((m) => firstLast(m.full_name) === alvo);
  // Dois membros com o mesmo "primeiro + último" seria chute — melhor não casar.
  return porExtremos.length === 1 ? porExtremos[0] : null;
}

function normalizeName(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

function firstLast(s: string | null | undefined): string {
  const partes = normalizeName(s).split(' ').filter(Boolean);
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

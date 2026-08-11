/**
 * Formato compartilhado das mensagens do chat interno da equipe.
 *
 * O chat interno é UMA função só em todo o sistema: a bolha da conversa direta,
 * do grupo, da ficha (lead/atividade/caso/processo/POP) e da conversa do
 * WhatsApp têm o mesmo repertório de ações. Para isso o contexto ("encaminhada
 * de", "em resposta no grupo X") viaja dentro do próprio `content`, em um
 * cabeçalho na primeira linha — assim ele aparece no preview da conversa, no
 * push e no contexto da IA sem depender de coluna nova em cada tabela.
 *
 * Quem renderiza usa `parseForward`/`parsePrivateReply` para separar o cabeçalho
 * do corpo; quem envia usa `buildForwardContent`/`buildPrivateReplyHeader`.
 */

/** Só o que os dois chats (team_messages e team_chat_messages) têm em comum. */
export interface ChatMessageLike {
  content?: string | null;
  message_type?: string | null;
  file_name?: string | null;
  transcription?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
}

export const PVT_PREFIX = '↩️ Em resposta';
export const FWD_PREFIX = '↪️ Encaminhada';

/** Uma linha para preview/citação — nunca vazia. */
export function msgPreviewText(msg: ChatMessageLike): string {
  return (
    msg.content
    || (msg.message_type === 'image' ? '📷 Imagem'
      : msg.message_type === 'audio' ? '🎤 Áudio'
      : msg.message_type === 'file' ? `📎 ${msg.file_name || 'Arquivo'}` : '...')
  );
}

/** Separa o bloco citado ("> …") do texto que a pessoa escreveu. */
export function splitQuotedLines(content: string): { quoted: string; body: string } {
  const lines = (content || '').split('\n');
  const quotedLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('>')) quotedLines.push(line.replace(/^>\s?/, ''));
    else bodyLines.push(line);
  }
  if (quotedLines.length === 0) return { quoted: '', body: content || '' };
  return { quoted: quotedLines.join('\n').trim(), body: bodyLines.join('\n').trim() };
}

/**
 * Texto útil da bolha para copiar / citar / mandar pra IA: sem cabeçalho de
 * contexto, sem bloco citado, com a transcrição no lugar do áudio.
 */
export function msgPlainText(msg: ChatMessageLike): string {
  if (msg.message_type === 'audio') return (msg.transcription || '').trim();
  if (msg.message_type === 'file') return `📎 ${msg.file_name || 'Arquivo'}`;
  const withoutHeaders = parsePrivateReply(parseForward(msg.content || '').body).body;
  if (msg.message_type === 'image') {
    return withoutHeaders && withoutHeaders !== '📷 Imagem' ? withoutHeaders : '';
  }
  return splitQuotedLines(withoutHeaders).body || withoutHeaders;
}

// ===== Responder no privado (mensagem de um chat → conversa direta com o autor) =====

/**
 * Aceita tanto o formato antigo ("… no grupo X") quanto o do chat da ficha
 * ("… no chat interno de Y") — o prefixo comum é o que identifica o cabeçalho.
 */
export function parsePrivateReply(content: string | null): { header: string | null; body: string } {
  const m = (content || '').match(/^(↩️ Em resposta[^\n]*)\n?([\s\S]*)$/);
  if (!m) return { header: null, body: content || '' };
  return { header: m[1], body: m[2] || '' };
}

/**
 * `scopeLabel` é lido depois de "Em resposta no": "grupo Financeiro",
 * "chat interno de Fulano", "chat interno do WhatsApp de Fulano".
 */
export function buildPrivateReplyHeader(scopeLabel: string, excerptSource: ChatMessageLike | string): string {
  const raw = typeof excerptSource === 'string' ? excerptSource : msgPreviewText(excerptSource);
  const excerpt = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${PVT_PREFIX} no ${scopeLabel}: “${excerpt}”`;
}

// ===== Encaminhar =====

export function parseForward(content: string | null): { header: string | null; body: string } {
  const m = (content || '').match(/^(↪️ Encaminhada[^\n]*)(?:\n([\s\S]*))?$/);
  if (!m) return { header: null, body: content || '' };
  return { header: m[1], body: m[2] || '' };
}

export function buildForwardContent(msg: ChatMessageLike, myName: string): string {
  const origName = msg.sender_name || 'Alguém';
  const header = !msg.sender_name || origName === myName
    ? `${FWD_PREFIX} por ${myName}`
    : `${FWD_PREFIX} de ${origName} por ${myName}`;
  // Mensagem que já era encaminhada não empilha cabeçalho.
  const parsed = parseForward(msg.content || '');
  const body = parsed.header ? parsed.body : (msg.content || '');
  return body.trim() ? `${header}\n${body}` : header;
}

/**
 * Citação de mensagem — o "responder" do WhatsApp.
 *
 * A UazAPI entrega a resposta com o id da mensagem citada em
 * `metadata.message.quoted` (mesmo valor de `content.contextInfo.stanzaID`) e
 * com uma CÓPIA do conteúdo citado em `content.contextInfo.quotedMessage`.
 * Nada disso era lido no front: a bolha mostrava só o texto da resposta — que
 * muitas vezes é um "." solto, quando a pessoa responde só para apontar o
 * arquivo/áudio — sem citação e sem nada clicável.
 *
 * Como a prévia vem junto no payload, ela é montada sem ida ao banco. O banco
 * só entra quando o usuário CLICA e a mensagem original está fora da janela
 * carregada (ver `findMessageByWhatsAppId` em external-rpc).
 */

export type QuotedKind =
  | 'text' | 'image' | 'video' | 'audio' | 'voice' | 'document'
  | 'sticker' | 'location' | 'contact' | 'poll' | 'other';

export interface QuotedMessageInfo {
  /** Id da mensagem citada no WhatsApp (stanzaID). Nunca vazio. */
  stanzaId: string;
  /** Telefone real de quem escreveu a citada, quando o payload traz. */
  participantPhone: string | null;
  /** @lid (id anônimo em grupo) de quem escreveu a citada, em dígitos. */
  participantLid: string | null;
  kind: QuotedKind;
  /** Rótulo do tipo em PT-BR ('Documento', 'Foto'…). Vazio para texto puro. */
  label: string;
  /** Texto, legenda ou nome do arquivo citado. Pode ser null (mídia sem legenda). */
  text: string | null;
}

const LABELS: Record<QuotedKind, string> = {
  text: '',
  image: 'Foto',
  video: 'Vídeo',
  audio: 'Áudio',
  voice: 'Mensagem de voz',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  poll: 'Enquete',
  other: 'Mensagem',
};

/** Nó livre do payload da UazAPI — só o que este módulo lê é tipado. */
type Json = Record<string, unknown>;

const asObj = (v: unknown): Json | null =>
  v && typeof v === 'object' ? (v as Json) : null;

const asText = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

/** Wrappers que embrulham a mensagem real (efêmera, ver-uma-vez, doc c/ legenda). */
const WRAPPERS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
  'viewOnceMessageV2Extension', 'documentWithCaptionMessage',
];

function unwrap(node: unknown, depth = 0): unknown {
  const obj = asObj(node);
  if (!obj || depth > 4) return node;
  for (const w of WRAPPERS) {
    const dentro = asObj(obj[w])?.message;
    if (dentro) return unwrap(dentro, depth + 1);
  }
  return obj;
}

function digitsOf(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Id da mensagem no WhatsApp. `external_message_id` é "<owner>:<messageid>" —
 * o owner muda por instância espelhada, o sufixo é o mesmo em todas as cópias.
 */
export function getWhatsAppMessageId(
  msg: { external_message_id?: string | null; metadata?: unknown } | null | undefined,
): string | null {
  const fromExternal = String(msg?.external_message_id || '').split(':').pop() || '';
  if (fromExternal) return fromExternal;
  const message = asObj(asObj(msg?.metadata)?.message);
  return asText(message?.messageid)?.trim() || null;
}

/** Lê o conteúdo citado e devolve tipo + prévia. */
function describeQuoted(quotedRaw: unknown): { kind: QuotedKind; text: string | null } {
  const cru = unwrap(quotedRaw);
  const texto = asText(cru);
  if (texto) return { kind: 'text', text: texto };
  const q = asObj(cru);
  if (!q) return { kind: 'other', text: null };

  const conversa = asText(q.conversation);
  if (conversa) return { kind: 'text', text: conversa };

  const extendido = asObj(q.extendedTextMessage);
  if (extendido) return { kind: 'text', text: asText(extendido.text) };

  const imagem = asObj(q.imageMessage);
  if (imagem) return { kind: 'image', text: asText(imagem.caption) };

  const video = asObj(q.videoMessage);
  if (video) return { kind: 'video', text: asText(video.caption) };
  if (asObj(q.ptvMessage)) return { kind: 'video', text: null };

  const audio = asObj(q.audioMessage);
  if (audio) return { kind: audio.PTT || audio.ptt ? 'voice' : 'audio', text: null };

  const doc = asObj(q.documentMessage);
  if (doc) {
    return { kind: 'document', text: asText(doc.title) || asText(doc.fileName) || asText(doc.caption) };
  }
  if (asObj(q.stickerMessage)) return { kind: 'sticker', text: null };

  const local = asObj(q.locationMessage);
  if (local) return { kind: 'location', text: asText(local.name) || asText(local.address) };
  if (asObj(q.liveLocationMessage)) return { kind: 'location', text: null };

  const contato = asObj(q.contactMessage) || asObj(q.contactsArrayMessage);
  if (contato) return { kind: 'contact', text: asText(contato.displayName) };

  const enquete = asObj(q.pollCreationMessage) || asObj(q.pollCreationMessageV3);
  if (enquete) return { kind: 'poll', text: asText(enquete.name) };

  return { kind: 'other', text: null };
}

/**
 * Extrai a citação da mensagem, se houver. `null` quando a mensagem não é
 * resposta a nada — inclusive no caso do anúncio Click-to-WhatsApp, que também
 * usa `contextInfo` (via `externalAdReply`) mas não cita mensagem nenhuma.
 */
export function extractQuotedMessage(metadata: unknown): QuotedMessageInfo | null {
  const meta = asObj(metadata);
  const msgObj = asObj(meta?.message) || asObj(asObj(meta?.chat)?.message) || {};
  const content = asObj(msgObj.content) || {};
  const ctx =
    asObj(content.contextInfo) ||
    asObj(msgObj.contextInfo) ||
    asObj(asObj(content.extendedTextMessage)?.contextInfo) ||
    asObj(asObj(msgObj.extendedTextMessage)?.contextInfo) ||
    {};

  const stanzaId = String(
    msgObj.quoted || ctx.stanzaID || ctx.stanzaId || ''
  ).trim();
  if (!stanzaId) return null;

  const participantRaw = String(ctx.participant || ctx.remoteJID || '');
  const participantLid = participantRaw.includes('@lid') ? digitsOf(participantRaw) : null;
  const participantPhone =
    !participantLid && participantRaw.includes('@') ? digitsOf(participantRaw) || null : null;

  const { kind, text } = describeQuoted(ctx.quotedMessage);
  return {
    stanzaId,
    participantPhone,
    participantLid,
    kind,
    label: LABELS[kind],
    text: text && text.trim() ? text.trim() : null,
  };
}

/** Acha, entre as mensagens já carregadas, a cópia visível da citada. */
export function findMessageByWhatsAppIdInList<T extends { external_message_id?: string | null; metadata?: unknown }>(
  messages: readonly T[] | null | undefined,
  stanzaId: string,
): T | null {
  if (!stanzaId || !messages?.length) return null;
  for (const m of messages) {
    if (getWhatsAppMessageId(m) === stanzaId) return m;
  }
  return null;
}

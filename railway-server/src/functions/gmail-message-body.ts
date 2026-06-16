import type { RequestHandler } from 'express';

/**
 * Busca o corpo COMPLETO de um e-mail do Gmail sob demanda, pelo message_id.
 *
 * Usado pelo histórico do INSS Administrativo: o sync salva só o snippet; quando
 * o usuário clica em "ver e-mail completo", o front chama aqui passando o
 * `gmail_message_id` da linha de histórico. Como há várias caixas configuradas
 * e o ID é único por caixa, tentamos cada inbox até uma responder 200.
 *
 * POST /functions/gmail-message-body  { gmail_message_id: string }
 *
 * Envs (já usadas pelo gmail-inss-sync):
 *   - LOVABLE_API_KEY
 *   - GOOGLE_MAIL_API_KEY[, _1, _2, ...]
 */

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: any[];
    body?: { data?: string };
    mimeType?: string;
  };
}

function getHeader(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

/** Extrai a 1ª parte de um dado mimeType (text/plain ou text/html). */
function extractByMime(msg: GmailMessage, mime: string): string {
  const walk = (parts?: any[]): string => {
    if (!parts) return '';
    for (const p of parts) {
      if (p.mimeType === mime && p.body?.data) return decodeBase64Url(p.body.data);
      if (p.parts) { const r = walk(p.parts); if (r) return r; }
    }
    return '';
  };
  // Corpo direto (e-mail sem multipart)
  if (msg.payload?.mimeType === mime && msg.payload?.body?.data) {
    return decodeBase64Url(msg.payload.body.data);
  }
  return walk(msg.payload?.parts);
}

function getInboxKeys(): Array<{ label: string; key: string }> {
  const inboxes: Array<{ label: string; key: string }> = [];
  if (process.env.GOOGLE_MAIL_API_KEY) inboxes.push({ label: 'inbox#1', key: process.env.GOOGLE_MAIL_API_KEY });
  if (process.env.GOOGLE_MAIL_API_KEY_1) inboxes.push({ label: 'inbox#2', key: process.env.GOOGLE_MAIL_API_KEY_1 });
  for (let i = 2; i <= 5; i++) {
    const k = process.env[`GOOGLE_MAIL_API_KEY_${i}`];
    if (k) inboxes.push({ label: `inbox#${i + 1}`, key: k });
  }
  return inboxes;
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const query = (req.query || {}) as any;
  const messageId: string = String(body.gmail_message_id ?? query.gmail_message_id ?? body.id ?? query.id ?? '').trim();

  if (!messageId) {
    return res.status(400).json({ success: false, error: 'gmail_message_id obrigatório' });
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) {
    return res.status(200).json({ success: false, error: 'LOVABLE_API_KEY ausente na Railway' });
  }

  const inboxes = getInboxKeys();
  if (inboxes.length === 0) {
    return res.status(200).json({ success: false, error: 'Nenhuma GOOGLE_MAIL_API_KEY* configurada' });
  }

  const errors: string[] = [];
  for (const inbox of inboxes) {
    try {
      const url = new URL(`${GATEWAY_BASE}/users/me/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set('format', 'full');
      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          'X-Connection-Api-Key': inbox.key,
        },
      });
      if (!resp.ok) {
        // 404 nesta caixa = mensagem é de outra; tenta a próxima.
        errors.push(`${inbox.label}: ${resp.status}`);
        continue;
      }
      const msg = (await resp.json()) as GmailMessage;
      const text = extractByMime(msg, 'text/plain');
      const html = extractByMime(msg, 'text/html');
      return res.status(200).json({
        success: true,
        inbox: inbox.label,
        message_id: msg.id,
        subject: getHeader(msg, 'Subject') || null,
        from: getHeader(msg, 'From') || null,
        date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        snippet: msg.snippet || null,
        body_text: text || null,
        body_html: html || null,
      });
    } catch (e: any) {
      errors.push(`${inbox.label}: ${e?.message || String(e)}`);
    }
  }

  return res.status(200).json({
    success: false,
    error: `E-mail não encontrado em nenhuma caixa (pode ter sido apagado do Gmail). Detalhes: ${errors.join('; ')}`,
  });
};

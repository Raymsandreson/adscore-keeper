// Envio de e-mail pela API do Gmail, via gateway de conectores do Lovable
// (mesmo gateway usado pelos syncs gmail-*). O e-mail sai DA conta autenticada
// pela connection key — então a escolha da key define o remetente real:
//   - judicial      → caixa processual (GOOGLE_MAIL_API_KEY_3 por padrão)
//   - administrativo → caixa adm/INSS  (GOOGLE_MAIL_API_KEY  por padrão)
//
// Body: { to: string|string[], subject: string, html?: string, text?: string,
//         process_type?: 'judicial'|'administrativo', from?: string, reply_to?: string }
// Retorno: HTTP 200 { success, id?, error? }
//
// Requisitos no Railway: LOVABLE_API_KEY + as connection keys do Gmail.
// IMPORTANTE: a conexão do Gmail precisa ter ESCOPO DE ENVIO (gmail.send/compose).
// Se foi autorizada só para leitura, o gateway retorna 403 e o envio falha.
import type { RequestHandler } from 'express';

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

// Connection key por tipo de processo (sobrescrevível por env dedicada).
function connectionKeyFor(processType?: string): { key: string; label: string } {
  const isAdmin = (processType || '').toLowerCase() === 'administrativo';
  if (isAdmin) {
    return {
      key: process.env.COBRANCA_GMAIL_KEY_ADMIN || process.env.GOOGLE_MAIL_API_KEY || '',
      label: 'adm',
    };
  }
  return {
    key: process.env.COBRANCA_GMAIL_KEY_JUDICIAL || process.env.GOOGLE_MAIL_API_KEY_3 || '',
    label: 'processual',
  };
}

function encodeSubject(subject: string): string {
  // RFC 2047 — assunto com acentos.
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildRawMessage(opts: {
  to: string[]; subject: string; html: string; from?: string; replyTo?: string;
}): string {
  const bodyB64 = Buffer.from(opts.html, 'utf-8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const headers = [
    `To: ${opts.to.join(', ')}`,
    opts.from ? `From: ${opts.from}` : null,
    opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
    `Subject: ${encodeSubject(opts.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean).join('\r\n');
  return `${headers}\r\n\r\n${bodyB64}`;
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { to, subject, html, text, process_type, from, reply_to } = (req.body || {}) as {
      to?: string | string[]; subject?: string; html?: string; text?: string;
      process_type?: string; from?: string; reply_to?: string;
    };

    const toList = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
    if (toList.length === 0) return ok({ success: false, error: 'destinatário (to) é obrigatório' });
    if (!subject) return ok({ success: false, error: 'assunto (subject) é obrigatório' });
    if (!html && !text) return ok({ success: false, error: 'html ou text é obrigatório' });

    const lovable = process.env.LOVABLE_API_KEY;
    if (!lovable) return ok({ success: false, error: 'LOVABLE_API_KEY não configurada no servidor' });

    const { key, label } = connectionKeyFor(process_type);
    if (!key) return ok({ success: false, error: `connection key do Gmail (${label}) não configurada` });

    const bodyHtml = html || `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text || '').replace(/\n/g, '<br>')}</div>`;

    const raw = base64url(buildRawMessage({
      to: toList, subject, html: bodyHtml, from, replyTo: reply_to,
    }));

    const r = await fetch(`${GATEWAY_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovable}`,
        'X-Connection-Api-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    const respText = await r.text();
    if (!r.ok) {
      console.error('[send-email] Gmail gateway error:', r.status, respText.slice(0, 400));
      return ok({ success: false, error: `Gmail gateway ${r.status}: ${respText.slice(0, 300)}` });
    }

    let id: string | undefined;
    try { id = JSON.parse(respText)?.id; } catch { /* sem id no corpo */ }
    return ok({ success: true, id });
  } catch (e: any) {
    console.error('[send-email] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

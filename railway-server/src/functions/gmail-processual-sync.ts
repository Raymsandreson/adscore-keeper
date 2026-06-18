import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';

/**
 * Carteiro robô do Gmail — caixa Processual.
 *
 * Lê e-mails da(s) caixa(s) marcadas como Processual e grava em
 * public.processual_emails (Externo) APENAS quando o assunto OU corpo
 * contém "movimentação processual" (case/acento-insensitive).
 *
 * POST /functions/gmail-processual-sync
 *   { lookback_hours?: number=72, max_messages?: number=50, dry_run?: boolean }
 *
 * Envs:
 *   - LOVABLE_API_KEY
 *   - GOOGLE_MAIL_API_KEY_3 (ou outra slot) — a caixa processual@
 *   - PROCESSUAL_INBOXES   = "inbox#4" (opcional; se vazio, NÃO roda)
 *   - EXTERNAL_SUPABASE_URL + EXTERNAL_SUPABASE_SERVICE_ROLE_KEY
 */

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

interface GmailListItem { id: string; threadId: string }
interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    mimeType?: string;
    headers?: Array<{ name: string; value: string }>;
    parts?: any[];
    body?: { data?: string };
  };
}

function getHeader(msg: GmailMessage, name: string) {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function extractPlainText(msg: GmailMessage): string {
  let plain = '', html = '';
  const walk = (parts?: any[]) => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeBase64Url(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeBase64Url(p.body.data);
      if (p.parts) walk(p.parts);
    }
  };
  if (msg.payload?.body?.data) {
    const raw = decodeBase64Url(msg.payload.body.data);
    if ((msg.payload.mimeType || '').includes('html')) html = raw; else plain = raw;
  }
  walk(msg.payload?.parts);
  if (plain.trim()) return decodeEntities(plain);
  if (html) return htmlToText(html);
  return '';
}

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Casa "movimentação processual" com/sem acento, espaços extras. */
function hasMovimentacaoProcessual(...texts: string[]): boolean {
  const blob = stripAccents(texts.filter(Boolean).join(' \n ').toLowerCase());
  return /\bmovimentacao\s+processual\b/.test(blob);
}

function extractProcessNumber(text: string): string | null {
  // CNJ: 0000000-00.0000.0.00.0000
  const m = text.match(/\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/);
  return m ? m[0] : null;
}

async function gmailFetch<T = any>(path: string, key: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GATEWAY_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const lovable = process.env.LOVABLE_API_KEY;
  if (!lovable || !key) throw new Error('Missing LOVABLE_API_KEY or inbox key');
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${lovable}`, 'X-Connection-Api-Key': key },
  });
  if (!r.ok) throw new Error(`Gmail gateway ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<T>;
}

function getInboxKeys(): Array<{ label: string; key: string }> {
  const all: Array<{ label: string; key: string }> = [];
  if (process.env.GOOGLE_MAIL_API_KEY) all.push({ label: 'inbox#1', key: process.env.GOOGLE_MAIL_API_KEY });
  if (process.env.GOOGLE_MAIL_API_KEY_1) all.push({ label: 'inbox#2', key: process.env.GOOGLE_MAIL_API_KEY_1 });
  for (let i = 2; i <= 5; i++) {
    const k = process.env[`GOOGLE_MAIL_API_KEY_${i}`];
    if (k) all.push({ label: `inbox#${i + 1}`, key: k });
  }
  const allow = (process.env.PROCESSUAL_INBOXES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return [];
  return all.filter((i) => allow.includes(i.label));
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const query = (req.query || {}) as any;
  const lookbackHours = Number(body.lookback_hours ?? query.lookback_hours ?? 72);
  const maxMessages = Number(body.max_messages ?? query.max_messages ?? 50);
  const dryRun: boolean = Boolean(body.dry_run ?? query.dry_run);

  const inboxes = getInboxKeys();
  if (inboxes.length === 0) {
    return res.status(200).json({
      success: false,
      error: 'PROCESSUAL_INBOXES não configurada. Defina ex.: PROCESSUAL_INBOXES="inbox#4"',
    });
  }

  const externalUrl = (process.env.EXTERNAL_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!externalUrl || !serviceKey) {
    return res.status(200).json({ success: false, error: 'EXTERNAL_SUPABASE_URL/SERVICE_ROLE_KEY ausentes' });
  }
  const ext = createClient(externalUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const afterTs = Math.floor((Date.now() - lookbackHours * 3600 * 1000) / 1000);
    const q = `after:${afterTs}`;
    const perInbox: Record<string, any> = {};
    let totalChecked = 0, totalInserted = 0, totalSkipped = 0;

    for (const inbox of inboxes) {
      const ir: any = { checked: 0, inserted: 0, skipped: 0, errors: [] as string[] };
      perInbox[inbox.label] = ir;
      try {
        const list = await gmailFetch<{ messages?: GmailListItem[] }>('/users/me/messages', inbox.key, {
          q,
          maxResults: String(Math.min(maxMessages, 100)),
        });
        const items: GmailListItem[] = list.messages || [];
        for (const it of items) {
          if (ir.checked >= maxMessages) break;
          ir.checked++;
          totalChecked++;
          try {
            const msg = await gmailFetch<GmailMessage>(`/users/me/messages/${it.id}`, inbox.key, { format: 'full' });
            const subject = getHeader(msg, 'Subject') || '';
            const fromAddr = getHeader(msg, 'From') || '';
            const text = extractPlainText(msg);
            if (!hasMovimentacaoProcessual(subject, text)) { ir.skipped++; totalSkipped++; continue; }
            if (dryRun) { ir.inserted++; totalInserted++; continue; }
            const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
            const { error } = await ext.from('processual_emails').upsert({
              gmail_message_id: it.id,
              inbox_label: inbox.label,
              subject,
              from_addr: fromAddr,
              snippet: msg.snippet ? decodeEntities(msg.snippet).slice(0, 500) : null,
              body_text: text.slice(0, 50000),
              received_at: receivedAt,
              has_movimentacao: true,
              process_number: extractProcessNumber(`${subject}\n${text}`),
            } as any, { onConflict: 'gmail_message_id', ignoreDuplicates: true });
            if (error) ir.errors.push(`upsert ${it.id}: ${error.message}`);
            else { ir.inserted++; totalInserted++; }
          } catch (e: any) {
            ir.errors.push(`${it.id}: ${e?.message || String(e)}`);
          }
        }
      } catch (e: any) {
        ir.errors.push(`list: ${e?.message || String(e)}`);
      }
    }

    return res.status(200).json({
      success: true,
      total_checked: totalChecked,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      per_inbox: perInbox,
    });
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err?.message || String(err) });
  }
};

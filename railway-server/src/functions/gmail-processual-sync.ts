import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';

/**
 * Carteiro robô do Gmail — caixa Processual.
 *
 * Modos:
 *  - Sync normal: lookback_hours + paginação até esgotar; novos e-mails da janela.
 *  - Backfill: ignora data, varre TODO o histórico página por página usando
 *    pageToken; retorna cursor pro client chamar de novo até `done=true`.
 *
 * POST /functions/gmail-processual-sync
 *   { lookback_hours?: number=168, max_messages?: number=100,
 *     backfill?: boolean=false, cursor?: { inbox, page_token } | null,
 *     after?: 'YYYY/MM/DD' (só backfill), dry_run?: boolean }
 *
 * Envs: LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY_3 (caixa processual),
 *       PROCESSUAL_INBOXES (ex.: "inbox#4"),
 *       EXTERNAL_SUPABASE_URL + EXTERNAL_SUPABASE_SERVICE_ROLE_KEY
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

function extractProcessNumber(text: string): string | null {
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

interface ProcessualCursor {
  inbox: string | null;
  page_token: string | null;
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const query = (req.query || {}) as any;
  const backfill: boolean = Boolean(body.backfill ?? query.backfill);
  const lookbackHours = Number(body.lookback_hours ?? query.lookback_hours ?? (backfill ? 0 : 168));
  // Orçamento por chamada (limita o tempo de uma request pra não estourar timeout).
  const maxMessages = Number(body.max_messages ?? query.max_messages ?? (backfill ? 150 : 100));
  const pageSize = Math.min(maxMessages, 100); // Gmail max é 100/página
  const dryRun: boolean = Boolean(body.dry_run ?? query.dry_run);
  const inCursor: ProcessualCursor | null = body.cursor ?? null;
  const afterDate: string | null = backfill ? (body.after ?? query.after ?? null) : null;

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
    // Filtro Gmail
    let q: string;
    if (backfill) {
      // Sem janela; opcionalmente after:YYYY/MM/DD
      q = afterDate ? `after:${afterDate}` : '';
    } else {
      const afterTs = Math.floor((Date.now() - lookbackHours * 3600 * 1000) / 1000);
      q = `after:${afterTs}`;
    }

    const perInbox: Record<string, any> = {};
    let totalChecked = 0, totalInserted = 0, totalSkipped = 0, totalExisting = 0;
    let checkedThisCall = 0;
    let outCursor: ProcessualCursor | null = null;
    let oldestSeen: string | null = null;
    let newestSeen: string | null = null;

    const cursorInboxIdx = inCursor?.inbox
      ? inboxes.findIndex((i) => i.label === inCursor.inbox)
      : -1;

    inboxLoop:
    for (let idx = 0; idx < inboxes.length; idx++) {
      const inbox = inboxes[idx];
      if (cursorInboxIdx >= 0 && idx < cursorInboxIdx) continue;

      const ir: any = { checked: 0, inserted: 0, skipped: 0, existing: 0, errors: [] as string[] };
      perInbox[inbox.label] = ir;

      // Token inicial: só usa se cursor for desta inbox
      let pageToken: string | undefined = (inCursor && inCursor.inbox === inbox.label && inCursor.page_token)
        ? inCursor.page_token
        : undefined;

      try {
        while (true) {
          if (checkedThisCall >= maxMessages) {
            outCursor = { inbox: inbox.label, page_token: pageToken || null };
            break inboxLoop;
          }
          const params: Record<string, string> = { maxResults: String(pageSize) };
          if (q) params.q = q;
          if (pageToken) params.pageToken = pageToken;
          const list = await gmailFetch<{ messages?: GmailListItem[]; nextPageToken?: string }>(
            '/users/me/messages', inbox.key, params,
          );
          const items: GmailListItem[] = list.messages || [];
          const nextToken = list.nextPageToken;

          if (items.length > 0) {
            // Skip os que já temos (por gmail_message_id)
            const ids = items.map((i) => i.id);
            const { data: existing } = await ext
              .from('processual_emails')
              .select('gmail_message_id')
              .in('gmail_message_id', ids);
            const seen = new Set((existing || []).map((r: any) => r.gmail_message_id));
            const toProcess = dryRun ? items : items.filter((i) => !seen.has(i.id));
            const existingCount = items.length - toProcess.length;
            ir.existing += existingCount;
            totalExisting += existingCount;

            ir.checked += items.length;
            totalChecked += items.length;
            checkedThisCall += items.length;

            for (const it of toProcess) {
              try {
                const msg = await gmailFetch<GmailMessage>(
                  `/users/me/messages/${it.id}`, inbox.key, { format: 'full' },
                );
                const subject = getHeader(msg, 'Subject') || '';
                const fromAddr = getHeader(msg, 'From') || '';
                const text = extractPlainText(msg);
                const receivedAt = msg.internalDate
                  ? new Date(Number(msg.internalDate)).toISOString()
                  : new Date().toISOString();
                if (!oldestSeen || receivedAt < oldestSeen) oldestSeen = receivedAt;
                if (!newestSeen || receivedAt > newestSeen) newestSeen = receivedAt;
                if (dryRun) { ir.inserted++; totalInserted++; continue; }
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
                if (error) { ir.errors.push(`upsert ${it.id}: ${error.message}`); totalSkipped++; ir.skipped++; }
                else { ir.inserted++; totalInserted++; }
              } catch (e: any) {
                ir.errors.push(`${it.id}: ${e?.message || String(e)}`);
                totalSkipped++; ir.skipped++;
              }
            }
          }

          pageToken = nextToken;
          if (!pageToken) break; // fim desta inbox
          // Em sync normal (não backfill) sem cursor, paginar até esgotar a janela;
          // em backfill, continua a paginar até esgotar orçamento.
          if (!backfill && checkedThisCall >= maxMessages) {
            outCursor = { inbox: inbox.label, page_token: pageToken };
            break inboxLoop;
          }
        }
      } catch (e: any) {
        ir.errors.push(`list: ${e?.message || String(e)}`);
      }

      // Inbox terminou. Se houver mais inbox, segue.
    }

    const result = {
      success: true,
      dry_run: dryRun,
      backfill,
      done: !outCursor,
      cursor: outCursor,
      total_checked: totalChecked,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      total_existing: totalExisting,
      oldest_email_at: oldestSeen,
      newest_email_at: newestSeen,
      per_inbox: perInbox,
    };

    if (!dryRun) {
      await ext.from('processual_sync_state').update({
        last_run_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        last_result: result,
        cursor: outCursor,
      }).eq('id', 1).then(() => {}, () => {});
    }

    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err?.message || String(err) });
  }
};

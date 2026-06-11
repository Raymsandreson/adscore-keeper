import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

/**
 * Carteiro robô do Gmail.
 *
 * O que faz, em 1 frase: abre a caixa do escritório, lê emails do INSS,
 * pega "requerimento + status" e atualiza/cria o processo administrativo.
 *
 * Roda via pg_cron 1x/hora no Externo (POST /functions/gmail-inss-sync).
 *
 * Envs necessárias na Railway:
 *   - LOVABLE_API_KEY        (gateway)
 *   - GOOGLE_MAIL_API_KEY    (connection key do gateway)
 *   - RAILWAY_PUBLIC_URL     (ex.: https://app.up.railway.app) — usado p/ chamar notify-inss-update
 *   - RAILWAY_API_KEY        (a mesma já em uso)
 */

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

interface GmailMessageListItem { id: string; threadId: string }
interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: any[];
    body?: { data?: string };
  };
}

function getHeader(msg: GmailMessage, name: string): string | undefined {
  const h = msg.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value;
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function extractPlainText(msg: GmailMessage): string {
  const walk = (parts?: any[]): string => {
    if (!parts) return '';
    for (const p of parts) {
      if (p.mimeType === 'text/plain' && p.body?.data) return decodeBase64Url(p.body.data);
      if (p.parts) { const r = walk(p.parts); if (r) return r; }
    }
    return '';
  };
  if (msg.payload?.body?.data) return decodeBase64Url(msg.payload.body.data);
  return walk(msg.payload?.parts);
}

/**
 * Parser dos emails do INSS observados no print:
 *   "[INSS] O status do requerimento 1874188131 foi alterado para Exigência"
 *   "[INSS] Requerimento realizado com sucesso"  (corpo traz o número)
 */
function parseBrDate(s: string): string | undefined {
  // dd/mm/yyyy ou dd-mm-yyyy
  const m = s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`; // ISO yyyy-mm-dd
}

function parseInssSubject(subject: string, body: string): {
  requerimento?: string;
  status?: string;
  cpf?: string;
  nome?: string;
  beneficio?: string;
  beneficio_num?: string;
  protocol_date?: string;
} {
  const out: any = {};

  // Número do requerimento (8-12 dígitos) - subject ou body
  const numMatch =
    subject.match(/requerimento\s+(\d{6,12})/i) ||
    body.match(/requerimento[:\s]+(\d{6,12})/i) ||
    body.match(/protocolo[:\s]+(\d{6,12})/i);
  if (numMatch) out.requerimento = numMatch[1];

  // Status no subject: "alterado para X" / "realizado com sucesso" / "Concluída"
  const statusMatch =
    subject.match(/alterado\s+para\s+(.+?)(?:\s*$)/i) ||
    subject.match(/\[INSS\]\s+(.+?)(?:\s*$)/i);
  if (statusMatch) {
    let s = statusMatch[1].trim();
    if (/realizado com sucesso/i.test(s)) s = 'Em análise';
    out.status = s;
  }

  // CPF (formato com ou sem pontuação)
  const cpfMatch = body.match(/cpf[:\s]*((?:\d{3}\.?){3}-?\d{2})/i);
  if (cpfMatch) out.cpf = cpfMatch[1].replace(/\D/g, '');

  // Nome do segurado
  const nomeMatch =
    body.match(/segurado[:\s]+([A-Z][A-ZÀ-Ú\s]{5,80})/i) ||
    body.match(/nome[:\s]+([A-Z][A-ZÀ-Ú\s]{5,80})/i) ||
    body.match(/requerente[:\s]+([A-Z][A-ZÀ-Ú\s]{5,80})/i);
  if (nomeMatch) out.nome = nomeMatch[1].trim().replace(/\s+/g, ' ');

  // Tipo de benefício
  const benMatch = body.match(/benef[íi]cio[:\s]+([^\n]{3,80})/i) ||
                   body.match(/servi[çc]o[:\s]+([^\n]{3,80})/i);
  if (benMatch) out.beneficio = benMatch[1].trim();

  // Número do benefício (NB) - diferente do requerimento
  const nbMatch = body.match(/\bNB[:\s]*(\d{6,12})/i) ||
                  body.match(/n[uú]mero\s+do\s+benef[íi]cio[:\s]*(\d{6,12})/i);
  if (nbMatch) out.beneficio_num = nbMatch[1];

  // Data do protocolo (data de entrada do requerimento)
  const protoMatch =
    body.match(/data\s+(?:do\s+)?protocolo[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i) ||
    body.match(/data\s+de\s+entrada[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i) ||
    body.match(/protocolado\s+em[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (protoMatch) out.protocol_date = parseBrDate(protoMatch[1]);

  return out;
}

async function gmailFetch(path: string, gmailKey: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${GATEWAY_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey || !gmailKey) {
    throw new Error('Missing LOVABLE_API_KEY or gmailKey on Railway env');
  }
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': gmailKey,
    },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gmail gateway ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return resp.json();
}

/** Lê a lista de caixas Gmail configuradas (adm + processual etc.). */
function getInboxKeys(): Array<{ label: string; key: string }> {
  const inboxes: Array<{ label: string; key: string }> = [];
  if (process.env.GOOGLE_MAIL_API_KEY) inboxes.push({ label: 'inbox#1', key: process.env.GOOGLE_MAIL_API_KEY });
  if (process.env.GOOGLE_MAIL_API_KEY_1) inboxes.push({ label: 'inbox#2', key: process.env.GOOGLE_MAIL_API_KEY_1 });
  // Suporte futuro: GOOGLE_MAIL_API_KEY_2, _3 ...
  for (let i = 2; i <= 5; i++) {
    const k = process.env[`GOOGLE_MAIL_API_KEY_${i}`];
    if (k) inboxes.push({ label: `inbox#${i + 1}`, key: k });
  }
  return inboxes;
}

export const handler: RequestHandler = async (req, res) => {
  const lookbackHours = Number(req.body?.lookback_hours || req.query?.lookback_hours || 24);
  const maxMessages = Number(req.body?.max_messages || 50);

  const inboxes = getInboxKeys();
  if (inboxes.length === 0) {
    return res.status(200).json({ success: false, error: 'No GOOGLE_MAIL_API_KEY* env vars configured' });
  }

  try {
    let totalChecked = 0;
    let totalNew = 0;
    let totalCreatedProcesses = 0;
    let totalCreatedHistory = 0;
    let totalNotifyTriggers = 0;
    const allErrors: string[] = [];
    const perInbox: Record<string, any> = {};

    for (const inbox of inboxes) {
      const inboxResult = { checked: 0, new: 0, created_processes: 0, created_history: 0, notify_triggers: 0, errors: [] as string[] };

      try {
        const query = `from:noreply [INSS] newer_than:${lookbackHours}h`;
        const list = await gmailFetch('/users/me/messages', inbox.key, {
          q: query,
          maxResults: String(maxMessages),
        });
        const messageIds: GmailMessageListItem[] = list.messages || [];
        inboxResult.checked = messageIds.length;
        totalChecked += messageIds.length;

        if (messageIds.length === 0) {
          perInbox[inbox.label] = inboxResult;
          continue;
        }

        const ids = messageIds.map((m) => m.id);
        const { data: existing } = await supabase
          .from('inss_status_history')
          .select('gmail_message_id')
          .in('gmail_message_id', ids);
        const seenIds = new Set((existing || []).map((r: any) => r.gmail_message_id));
        const toProcess = messageIds.filter((m) => !seenIds.has(m.id));
        inboxResult.new = toProcess.length;
        totalNew += toProcess.length;

        for (const item of toProcess) {
          try {
            const msg: GmailMessage = await gmailFetch(`/users/me/messages/${item.id}`, inbox.key, {
              format: 'full',
            });
            const subject = getHeader(msg, 'Subject') || '';
            const body = extractPlainText(msg);
            const receivedAt = msg.internalDate
              ? new Date(Number(msg.internalDate)).toISOString()
              : new Date().toISOString();

            const parsed = parseInssSubject(subject, body);
            if (!parsed.requerimento) {
              await supabase.from('inss_status_history').insert({
                process_id: null as any,
                gmail_message_id: item.id,
                email_subject: subject,
                email_snippet: msg.snippet?.slice(0, 500),
                email_received_at: receivedAt,
                to_status: 'PARSE_FAILED',
              } as any).then(() => {}, () => {});
              continue;
            }

            const { data: existingProc } = await supabase
              .from('inss_admin_processes')
              .select('id, current_status, case_id, lead_id')
              .eq('requerimento_number', parsed.requerimento)
              .maybeSingle();

            let processId: string;
            let fromStatus: string | null = null;
            let caseId: string | null = null;

            if (existingProc) {
              processId = existingProc.id;
              fromStatus = existingProc.current_status || null;
              caseId = existingProc.case_id || null;

              await supabase
                .from('inss_admin_processes')
                .update({
                  current_status: parsed.status || fromStatus,
                  cpf_segurado: parsed.cpf || undefined,
                  nome_segurado: parsed.nome || undefined,
                  benefit_type: parsed.beneficio || undefined,
                  benefit_number: parsed.beneficio_num || undefined,
                  protocol_date: parsed.protocol_date || undefined,
                  last_email_at: receivedAt,
                  last_email_subject: subject,
                })
                .eq('id', processId);
            } else {
              const { data: created, error: createErr } = await supabase
                .from('inss_admin_processes')
                .insert({
                  requerimento_number: parsed.requerimento,
                  current_status: parsed.status || 'Desconhecido',
                  cpf_segurado: parsed.cpf,
                  nome_segurado: parsed.nome,
                  benefit_type: parsed.beneficio,
                  benefit_number: parsed.beneficio_num,
                  protocol_date: parsed.protocol_date,
                  last_email_at: receivedAt,
                  last_email_subject: subject,
                })
                .select('id')
                .single();
              if (createErr || !created) {
                inboxResult.errors.push(`create process ${parsed.requerimento}: ${createErr?.message}`);
                continue;
              }
              processId = created.id;
              inboxResult.created_processes++;
              totalCreatedProcesses++;
            }

            await supabase.from('inss_status_history').insert({
              process_id: processId,
              from_status: fromStatus,
              to_status: parsed.status || 'Desconhecido',
              email_received_at: receivedAt,
              email_subject: subject,
              email_snippet: msg.snippet?.slice(0, 500),
              gmail_message_id: item.id,
              notified: false,
            });
            inboxResult.created_history++;
            totalCreatedHistory++;

            if (caseId) {
              inboxResult.notify_triggers++;
              totalNotifyTriggers++;
              const railwayUrl = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
              fetch(`${railwayUrl}/functions/notify-inss-update`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': process.env.RAILWAY_API_KEY || '',
                },
                body: JSON.stringify({ process_id: processId }),
              }).catch((e) => console.error('[gmail-inss-sync] notify fire failed:', e));
            }
          } catch (err) {
            inboxResult.errors.push(`${item.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        inboxResult.errors.push(`fatal: ${msg}`);
        allErrors.push(`${inbox.label}: ${msg}`);
      }

      allErrors.push(...inboxResult.errors.map((e) => `${inbox.label}: ${e}`));
      perInbox[inbox.label] = inboxResult;
    }

    const result = {
      success: true,
      inboxes: inboxes.length,
      checked: totalChecked,
      new: totalNew,
      created_processes: totalCreatedProcesses,
      created_history: totalCreatedHistory,
      notify_triggers: totalNotifyTriggers,
      per_inbox: perInbox,
      errors: allErrors.slice(0, 10),
    };

    await supabase.from('inss_sync_state').update({
      last_run_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      last_result: result,
    }).eq('id', 1);

    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[gmail-inss-sync] fatal:', msg);
    await supabase.from('inss_sync_state').update({
      last_run_at: new Date().toISOString(),
      last_result: { success: false, error: msg },
    }).eq('id', 1).then(() => {}, () => {});
    return res.status(200).json({ success: false, error: msg });
  }
};

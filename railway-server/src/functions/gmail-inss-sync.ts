import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { findInssOrphanMatch, applyInssMatch } from '../lib/inss-matcher';

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
    mimeType?: string;
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

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
    });
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlainText(msg: GmailMessage): string {
  let plain = '';
  let html = '';
  const walk = (parts?: any[]): void => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeBase64Url(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeBase64Url(p.body.data);
      if (p.parts) walk(p.parts);
    }
  };
  if (msg.payload?.body?.data) {
    const raw = decodeBase64Url(msg.payload.body.data);
    if ((msg.payload.mimeType || '').includes('html')) html = raw;
    else plain = raw;
  }
  walk(msg.payload?.parts);
  if (plain && plain.trim()) return decodeEntities(plain);
  if (html) return htmlToText(html);
  return '';
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

  // Nome do segurado. Os e-mails do INSS sempre começam com
  // "Prezado(a) Sr(a) NOME COMPLETO," — esse é o sinal mais confiável.
  const nomeMatch =
    body.match(/Prezad[oa]\(a\)\s*Sr\(a\)\s+([A-ZÀ-Ú][A-ZÀ-Ú\s]{4,80}?),/) ||
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

/**
 * Detecta e-mail de Push de tribunal/processo judicial (PJe, TRT, TJ, Eproc).
 * Esses e-mails citam "Instituto Nacional do Seguro Social" no corpo quando o
 * INSS é parte da ação — o que enganava isLikelyInssAdminEmail e os fazia virar
 * PARSE_FAILED no inss_status_history. NÃO são e-mails administrativos do INSS.
 */
function isProcessualOrCourtEmail(subject: string, body: string): boolean {
  const subj = subject || '';
  // Assuntos típicos do Push judicial.
  if (/^\s*\[(?:push|trt\s*\d*|tj[a-z]{2}|pje|eproc)\]/i.test(subj)) return true;
  if (/movimenta[çc][ãa]o\s+processual|atualiza[çc][õo]es\s+de\s+informa[çc][õo]es\s+processuais|novos\s+arquivos\s+encontrados\s+do\s+processo/i.test(subj)) return true;
  // Corpo: assinatura inconfundível do serviço de acompanhamento dos tribunais.
  const hay = `${subj}\n${(body || '').slice(0, 1500)}`;
  if (/pje\s*push|servi[çc]o\s+de\s+acompanhamento\s+autom[áa]tico\s+de\s+processos|tribunal\s+(?:regional\s+do\s+trabalho|de\s+justi[çc]a|superior)/i.test(hay)) return true;
  return false;
}

function isLikelyInssAdminEmail(subject: string, fromAddr: string, body: string): boolean {
  // Precedência: Push de tribunal/processo NUNCA é e-mail administrativo do INSS,
  // mesmo que o corpo mencione o INSS como parte da ação.
  if (isProcessualOrCourtEmail(subject, body)) return false;
  const haystack = `${subject}\n${fromAddr}\n${body.slice(0, 2000)}`;
  if (/\[INSS\]|Meu\s+INSS|Instituto\s+Nacional\s+do\s+Seguro\s+Social|inss\.gov\.br/i.test(haystack)) return true;
  if (/requerimento\s+\d{6,12}/i.test(haystack) && /benef[íi]cio|segurado|Prezad[oa]\(a\)\s*Sr\(a\)/i.test(haystack)) return true;
  return false;
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

/** Lê a lista de caixas Gmail configuradas (adm + processual etc.).
 * Se INSS_INBOXES estiver definido (ex: "inbox#1,inbox#2"), filtra só essas
 * para o sync do INSS — evita que a caixa Processual seja varrida aqui.
 */
function getInboxKeys(): Array<{ label: string; key: string }> {
  const inboxes: Array<{ label: string; key: string }> = [];
  if (process.env.GOOGLE_MAIL_API_KEY) inboxes.push({ label: 'inbox#1', key: process.env.GOOGLE_MAIL_API_KEY });
  if (process.env.GOOGLE_MAIL_API_KEY_1) inboxes.push({ label: 'inbox#2', key: process.env.GOOGLE_MAIL_API_KEY_1 });
  for (let i = 2; i <= 5; i++) {
    const k = process.env[`GOOGLE_MAIL_API_KEY_${i}`];
    if (k) inboxes.push({ label: `inbox#${i + 1}`, key: k });
  }
  const allow = (process.env.INSS_INBOXES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return inboxes;
  return inboxes.filter((i) => allow.includes(i.label));
}

interface SyncCursor {
  inbox: string | null;
  /** Janela mensal (YYYY-MM) sendo varrida em backfill, oldest-first. */
  month: string | null;
  page_token: string | null;
}

/** Lista YYYY-MM crescente de `fromYm` até `toYm` (inclusive). */
function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  let y = fy; let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** YYYY-MM → janela Gmail [after, before) em YYYY/MM/DD. */
function monthWindow(ym: string): { after: string; before: string } {
  const [y, m] = ym.split('-').map(Number);
  const after = `${y}/${String(m).padStart(2, '0')}/01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const before = `${nextY}/${String(nextM).padStart(2, '0')}/01`;
  return { after, before };
}

/** YYYY/MM/DD → YYYY-MM (para normalizar o param `after`). */
function ymFromAfter(after: string): string {
  const m = after.match(/^(\d{4})[\/\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '2022-01';
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const query = (req.query || {}) as any;

  const lookbackDays = Number(body.lookback_days ?? query.lookback_days ?? 0);
  const lookbackHours = lookbackDays > 0
    ? lookbackDays * 24
    : Number(body.lookback_hours ?? query.lookback_hours ?? 24);
  // backfill: ignora a janela de data e varre TODO o histórico "from:noreply [INSS]",
  // página por página (nextPageToken). A UI chama em loop usando o `cursor` retornado.
  const backfill: boolean = Boolean(body.backfill ?? query.backfill);
  // Em backfill, max_messages é o ORÇAMENTO de mensagens verificadas POR chamada
  // (limita o tempo da request p/ não estourar timeout). Sem backfill, mantém o
  // comportamento antigo: tamanho de uma página única.
  const maxMessages = Number(body.max_messages ?? query.max_messages ?? (backfill ? 150 : 50));
  const pageSize = backfill ? Math.min(maxMessages, 100) : maxMessages;
  const inboxFilter: string | undefined = body.inbox ?? query.inbox; // ex: "inbox#1"
  const dryRun: boolean = Boolean(body.dry_run ?? query.dry_run);
  const inCursor: SyncCursor | null = body.cursor ?? null;
  // Data inicial do backfill (Gmail aceita YYYY/MM/DD). Default: jan/2022.
  const backfillAfter: string = String(body.after ?? query.after ?? '2022/01/01');
  // Em backfill, varremos mês a mês em ordem CRONOLÓGICA (oldest-first).
  const backfillStartYm = ymFromAfter(backfillAfter);
  const now = new Date();
  const todayYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const backfillMonths = backfill ? monthsBetween(backfillStartYm, todayYm) : [];

  const allInboxes = getInboxKeys();
  const inboxes = inboxFilter
    ? allInboxes.filter((i) => i.label === inboxFilter)
    : allInboxes;

  if (inboxes.length === 0) {
    return res.status(200).json({
      success: false,
      error: inboxFilter
        ? `Inbox "${inboxFilter}" não configurada. Disponíveis: ${allInboxes.map((i) => i.label).join(', ') || 'nenhuma'}`
        : 'No GOOGLE_MAIL_API_KEY* env vars configured',
    });
  }

  try {
    let totalChecked = 0;
    let totalNew = 0;
    let totalCreatedProcesses = 0;
    let totalCreatedHistory = 0;
    let totalNotifyTriggers = 0;
    let checkedThisCall = 0;
    const allErrors: string[] = [];
    const perInbox: Record<string, any> = {};
    let globalOldest: string | null = null;
    let globalNewest: string | null = null;
    let outCursor: SyncCursor | null = null;

    // Durante backfill (histórico antigo) NÃO disparamos WhatsApp: seria notificar
    // clientes sobre mudanças de status velhas. Notificação só no sync normal/cron.
    // O auto-match (vínculo de órfãos) continua rodando — isso é desejável.
    const allowNotify = !backfill;

    // Processa 1 email: detalhe -> parse -> upsert do processo + histórico
    // (+ auto-match de órfão + notify).
    const processItem = async (
      item: GmailMessageListItem,
      inbox: { label: string; key: string },
      inboxResult: any,
    ): Promise<void> => {
      try {
        const msg: GmailMessage = await gmailFetch(`/users/me/messages/${item.id}`, inbox.key, {
          format: 'full',
        });
        const subject = getHeader(msg, 'Subject') || '';
        const fromAddr = getHeader(msg, 'From') || '';
        const body = extractPlainText(msg);
        const receivedAt = msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : new Date().toISOString();

        // Atualiza janela de datas (mín/máx) por inbox e global
        if (!inboxResult.oldest_email_at || receivedAt < inboxResult.oldest_email_at) inboxResult.oldest_email_at = receivedAt;
        if (!inboxResult.newest_email_at || receivedAt > inboxResult.newest_email_at) inboxResult.newest_email_at = receivedAt;
        if (!globalOldest || receivedAt < globalOldest) globalOldest = receivedAt;
        if (!globalNewest || receivedAt > globalNewest) globalNewest = receivedAt;

        const parsed = parseInssSubject(subject, body);

        // Segurança contra filtros amplos do Gmail: se a mensagem não parece ser
        // administrativa do INSS, ignora sem gravar PARSE_FAILED. Assim e-mails
        // processuais/LinkedIn/billing não poluem o histórico nem bloqueiam a UI.
        if (!isLikelyInssAdminEmail(subject, fromAddr, body)) {
          inboxResult.skipped_non_inss = (inboxResult.skipped_non_inss || 0) + 1;
          return;
        }

        // Em dry_run só conta, não grava nada
        if (dryRun) return;

        if (!parsed.requerimento) {
          // Sem nº de requerimento: gravamos como PARSE_FAILED para NUNCA
          // reprocessar este e-mail. process_id é nullable; gmail_message_id
          // é UNIQUE então onConflict=ignore evita conflito em retries.
          const { error: pfErr } = await supabase
            .from('inss_status_history')
            .upsert({
              process_id: null,
              gmail_message_id: item.id,
              email_subject: subject,
              email_snippet: msg.snippet ? decodeEntities(msg.snippet).slice(0, 500) : undefined,
              email_received_at: receivedAt,
              to_status: 'PARSE_FAILED',
            } as any, { onConflict: 'gmail_message_id', ignoreDuplicates: true });
          if (pfErr) {
            inboxResult.errors.push(`PARSE_FAILED insert ${item.id}: ${pfErr.message}`);
          } else {
            inboxResult.created_history++;
            totalCreatedHistory++;
          }
          return;
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
            return;
          }
          processId = created.id;
          inboxResult.created_processes++;
          totalCreatedProcesses++;
        }

        const { error: histErr } = await supabase
          .from('inss_status_history')
          .upsert({
            process_id: processId,
            from_status: fromStatus,
            to_status: parsed.status || 'Desconhecido',
            email_received_at: receivedAt,
            email_subject: subject,
            email_snippet: msg.snippet ? decodeEntities(msg.snippet).slice(0, 500) : undefined,
            gmail_message_id: item.id,
            notified: false,
          } as any, { onConflict: 'gmail_message_id', ignoreDuplicates: true });
        if (histErr) {
          inboxResult.errors.push(`history insert ${item.id}: ${histErr.message}`);
          return;
        }
        inboxResult.created_history++;
        totalCreatedHistory++;

        // === AUTO-MATCH: se órfão, tenta achar lead pelo nº requerimento ===
        if (!caseId) {
          try {
            const match = await findInssOrphanMatch({
              requerimento: parsed.requerimento,
              cpf: parsed.cpf,
              nome: parsed.nome,
              beneficio_num: parsed.beneficio_num,
            });
            if (match.leadId || match.caseId) {
              const applied = await applyInssMatch({
                processId,
                requerimento: parsed.requerimento,
                match,
              });
              caseId = applied.caseId || null;
            }
          } catch (mErr) {
            console.warn('[gmail-inss-sync] auto-match failed:', mErr);
          }
        }

        if (caseId && allowNotify) {
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
    };

    const cursorInboxIdx = inCursor?.inbox
      ? inboxes.findIndex((i) => i.label === inCursor.inbox)
      : -1;

    for (let inboxIdx = 0; inboxIdx < inboxes.length; inboxIdx++) {
      const inbox = inboxes[inboxIdx];

      // Se o cursor aponta p/ uma inbox posterior, pula as anteriores.
      if (cursorInboxIdx >= 0 && inboxIdx < cursorInboxIdx) continue;

      const inboxResult = {
        checked: 0,
        new: 0,
        created_processes: 0,
        created_history: 0,
        notify_triggers: 0,
        oldest_email_at: null as string | null,
        newest_email_at: null as string | null,
        errors: [] as string[],
      };

      // Orçamento da chamada esgotado numa fronteira de inbox: retoma aqui na próxima.
      if (backfill && checkedThisCall >= maxMessages) {
        outCursor = { inbox: inbox.label, month: backfillMonths[0] ?? null, page_token: null };
        break;
      }

      try {
        // Em backfill: itera mês a mês oldest-first; sem backfill: 1 janela só.
        const monthsToScan: Array<string | null> = backfill
          ? (() => {
              const startIdx = (inCursor && inCursor.inbox === inbox.label && inCursor.month)
                ? Math.max(0, backfillMonths.indexOf(inCursor.month))
                : 0;
              return backfillMonths.slice(startIdx) as Array<string | null>;
            })()
          : [null];

        monthLoop:
        for (const ym of monthsToScan) {
          // Filtro restrito: e-mails genéricos de noreply/naoresponder trazem
          // Push processual, LinkedIn e billing. Esses itens viravam PARSE_FAILED
          // e consumiam o orçamento/rate-limit antes dos e-mails administrativos.
          const baseFilter = '(subject:INSS OR subject:"Meu INSS" OR from:inss.gov.br OR from:meu.inss.gov.br)';
          const gmailQuery = backfill && ym
            ? (() => {
                const { after, before } = monthWindow(ym);
                return `${baseFilter} after:${after} before:${before}`;
              })()
            : `${baseFilter} newer_than:${lookbackHours}h`;

          // Token inicial: só usa se cursor for desta inbox E deste mês.
          let pageToken: string | undefined =
            (inCursor && inCursor.inbox === inbox.label && inCursor.month === ym && inCursor.page_token)
              ? inCursor.page_token
              : undefined;

          while (true) {
            const params: Record<string, string> = { q: gmailQuery, maxResults: String(pageSize) };
            if (pageToken) params.pageToken = pageToken;
            const list = await gmailFetch('/users/me/messages', inbox.key, params);
            const messageIds: GmailMessageListItem[] = list.messages || [];
            const nextToken: string | undefined = list.nextPageToken || undefined;

            inboxResult.checked += messageIds.length;
            totalChecked += messageIds.length;
            checkedThisCall += messageIds.length;

            if (messageIds.length > 0) {
              const ids = messageIds.map((m) => m.id);
              let toProcess: GmailMessageListItem[];
              if (dryRun) {
                toProcess = messageIds;
              } else {
                const { data: existing } = await supabase
                  .from('inss_status_history')
                  .select('gmail_message_id')
                  .in('gmail_message_id', ids);
                const seenIds = new Set((existing || []).map((r: any) => r.gmail_message_id));
                toProcess = messageIds.filter((m) => !seenIds.has(m.id));
              }
              inboxResult.new += toProcess.length;
              totalNew += toProcess.length;

              // Dentro da página: oldest-first (Gmail devolve newest-first).
              for (const item of [...toProcess].reverse()) {
                await processItem(item, inbox, inboxResult);
              }
            }

            if (!backfill) break;

            pageToken = nextToken;
            if (!pageToken) break; // fim deste mês -> próximo mês

            if (checkedThisCall >= maxMessages) {
              outCursor = { inbox: inbox.label, month: ym, page_token: pageToken };
              break monthLoop;
            }
          }

          // Mês terminou: se orçamento esgotou, retoma no próximo mês.
          if (backfill && checkedThisCall >= maxMessages) {
            const idx = backfillMonths.indexOf(ym as string);
            const nextYm = idx >= 0 && idx + 1 < backfillMonths.length ? backfillMonths[idx + 1] : null;
            outCursor = nextYm
              ? { inbox: inbox.label, month: nextYm, page_token: null }
              : null;
            break monthLoop;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        inboxResult.errors.push(`fatal: ${msg}`);
        allErrors.push(`${inbox.label}: ${msg}`);
      }

      allErrors.push(...inboxResult.errors.map((e) => `${inbox.label}: ${e}`));
      perInbox[inbox.label] = inboxResult;

      if (outCursor) break; // interrompido por orçamento; resto fica p/ a próxima chamada
    }

    const result = {
      success: true,
      dry_run: dryRun,
      backfill,
      done: !outCursor,
      cursor: outCursor,
      params: {
        lookback_hours: lookbackHours,
        lookback_days: Math.round((lookbackHours / 24) * 100) / 100,
        max_messages: maxMessages,
        page_size: pageSize,
        backfill_after: backfill ? backfillAfter : null,
        inbox_filter: inboxFilter || null,
      },
      inboxes: inboxes.length,
      inbox_labels: inboxes.map((i) => i.label),
      checked: totalChecked,
      new: totalNew,
      created_processes: totalCreatedProcesses,
      created_history: totalCreatedHistory,
      notify_triggers: totalNotifyTriggers,
      oldest_email_at: globalOldest,
      newest_email_at: globalNewest,
      per_inbox: perInbox,
      errors: allErrors.slice(0, 10),
    };

    if (!dryRun) {
      await supabase.from('inss_sync_state').update({
        last_run_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        last_result: result,
      }).eq('id', 1);
    }

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

import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { extractDespacho, gmailBodyToText } from '../lib/inss-despacho';

/**
 * Varredura das EXIGÊNCIAS: lê o corpo de cada e-mail de exigência e salva o
 * Despacho (o que o INSS pede pra cumprir) em inss_status_history.despacho, e,
 * quando é a exigência vigente do processo, também em inss_admin_processes.despacho.
 *
 * Base para: prazo de cumprimento (data do e-mail + 30d), ranking do que o INSS
 * mais exige, e geração de atividade com o "o que apresentar".
 *
 * POST /functions/backfill-inss-exigencia  { limit?, dry_run?, only_open? }
 *  - only_open (padrão true): só exigências abertas (current = Exigência).
 * Reusa LOVABLE_API_KEY + GOOGLE_MAIL_API_KEY* (mesmas do gmail-message-body).
 */

const GATEWAY_BASE = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

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

async function fetchGmailFull(messageId: string, inboxes: Array<{ label: string; key: string }>): Promise<any | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) return null;
  for (const inbox of inboxes) {
    try {
      const url = new URL(`${GATEWAY_BASE}/users/me/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set('format', 'full');
      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': inbox.key },
      });
      if (!resp.ok) continue;
      return await resp.json();
    } catch { /* próxima caixa */ }
  }
  return null;
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const limit = Math.min(Number(body.limit ?? 500), 2000);
  const dryRun: boolean = Boolean(body.dry_run);
  const onlyOpen: boolean = body.only_open === undefined ? true : Boolean(body.only_open);
  const CONCURRENCY = 6;

  const inboxes = getInboxKeys();
  if (inboxes.length === 0 || !process.env.LOVABLE_API_KEY) {
    return res.status(200).json({ success: false, error: 'LOVABLE_API_KEY / GOOGLE_MAIL_API_KEY* ausentes' });
  }

  try {
    // Processos-alvo: exigências abertas (ou todas que já passaram por exigência).
    const procQuery = supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, current_status')
      .is('deleted_at', null)
      .limit(limit);
    if (onlyOpen) procQuery.ilike('current_status', '%exig%');
    const { data: procs, error: procErr } = await procQuery;
    if (procErr) return res.status(200).json({ success: false, error: procErr.message });

    const procList = (procs || []) as Array<{ id: string; requerimento_number: string; current_status: string | null }>;
    if (procList.length === 0) return res.status(200).json({ success: true, scanned: 0, message: 'Nada a varrer' });

    const procIds = procList.map((p) => p.id);
    const isOpenExig = new Map(procList.map((p) => [p.id, /exig/i.test(p.current_status || '')]));
    const reqByProc = new Map(procList.map((p) => [p.id, p.requerimento_number]));

    // Eventos de exigência desses processos que ainda não têm despacho.
    const events: Array<{ id: string; process_id: string; gmail_message_id: string; email_received_at: string | null }> = [];
    const CHUNK = 150;
    for (let i = 0; i < procIds.length; i += CHUNK) {
      const slice = procIds.slice(i, i + CHUNK);
      const { data: evs } = await supabase
        .from('inss_status_history')
        .select('id, process_id, gmail_message_id, email_received_at, despacho')
        .in('process_id', slice)
        .ilike('to_status', 'exig%')
        .not('gmail_message_id', 'is', null);
      for (const e of (evs || []) as any[]) {
        if (!e.despacho) events.push({ id: e.id, process_id: e.process_id, gmail_message_id: e.gmail_message_id, email_received_at: e.email_received_at });
      }
    }

    // Evento de exigência mais recente por processo (o que vira o despacho vigente).
    const latestByProc = new Map<string, string>();
    for (const e of events) {
      const cur = latestByProc.get(e.process_id);
      if (!cur) latestByProc.set(e.process_id, e.id);
    }

    const stats = { processos: procList.length, eventos: events.length, com_despacho: 0, sem_despacho: 0, erros: 0, updated_hist: 0, updated_proc: 0 };
    const samples: Array<{ req: string; despacho: string }> = [];

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < events.length) {
        const ev = events[cursor++];
        try {
          const msg = await fetchGmailFull(ev.gmail_message_id, inboxes);
          if (!msg) { stats.erros++; continue; }
          const text = gmailBodyToText(msg);
          const despacho = extractDespacho(text);
          if (!despacho) { stats.sem_despacho++; continue; }
          stats.com_despacho++;
          if (samples.length < 12) samples.push({ req: reqByProc.get(ev.process_id) || '?', despacho: despacho.slice(0, 200) });

          if (!dryRun) {
            const { error: hErr } = await supabase.from('inss_status_history').update({ despacho }).eq('id', ev.id);
            if (hErr) { stats.erros++; } else { stats.updated_hist++; }
            // Se é a exigência vigente e o processo ainda está em exigência aberta,
            // reflete no processo (o "o que cumprir" atual).
            if (isOpenExig.get(ev.process_id) && latestByProc.get(ev.process_id) === ev.id) {
              const { error: pErr } = await supabase.from('inss_admin_processes').update({ despacho }).eq('id', ev.process_id);
              if (!pErr) stats.updated_proc++;
            }
          }
        } catch { stats.erros++; }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    return res.status(200).json({ success: true, dry_run: dryRun, only_open: onlyOpen, ...stats, samples });
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err?.message || String(err) });
  }
};

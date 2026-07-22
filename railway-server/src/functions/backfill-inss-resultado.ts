import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import {
  classifyResultado, extractDespacho, extractServico, gmailBodyToText,
} from '../lib/inss-despacho';

/**
 * Backfill do veredito (deferido/indeferido) dos requerimentos já CONCLUÍDOS.
 *
 * O sync antigo só guardava o status "Concluída". Este handler re-lê o corpo do
 * e-mail de conclusão (que traz o Despacho) e preenche resultado/servico/despacho
 * dos processos que ainda estão sem `resultado`. Idempotente: só toca em quem tem
 * resultado NULL, então pode rodar quantas vezes precisar.
 *
 * POST /functions/backfill-inss-resultado  { limit?: number, dry_run?: boolean }
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

/** Busca a mensagem completa no Gmail tentando cada caixa até uma responder 200. */
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
      if (!resp.ok) continue; // 404 nesta caixa = mensagem é de outra
      return await resp.json();
    } catch { /* tenta próxima caixa */ }
  }
  return null;
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const limit = Math.min(Number(body.limit ?? 1000), 2000);
  const dryRun: boolean = Boolean(body.dry_run);
  const CONCURRENCY = 6;

  const inboxes = getInboxKeys();
  if (inboxes.length === 0 || !process.env.LOVABLE_API_KEY) {
    return res.status(200).json({ success: false, error: 'LOVABLE_API_KEY / GOOGLE_MAIL_API_KEY* ausentes' });
  }

  try {
    // 1) Processos Concluídos ainda sem veredito.
    const { data: procs, error: procErr } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number')
      .is('deleted_at', null)
      .is('resultado', null)
      .ilike('current_status', 'conclu%')
      .limit(limit);
    if (procErr) return res.status(200).json({ success: false, error: procErr.message });

    const procList = (procs || []) as Array<{ id: string; requerimento_number: string }>;
    if (procList.length === 0) {
      return res.status(200).json({ success: true, scanned: 0, message: 'Nada a preencher' });
    }

    // 2) gmail_message_id mais recente de cada processo (o e-mail de conclusão).
    const ids = procList.map((p) => p.id);
    const gidByProc = new Map<string, string>();
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: hist } = await supabase
        .from('inss_status_history')
        .select('process_id, gmail_message_id, email_received_at')
        .in('process_id', slice)
        .not('gmail_message_id', 'is', null)
        .order('email_received_at', { ascending: false });
      for (const h of (hist || []) as any[]) {
        if (!gidByProc.has(h.process_id)) gidByProc.set(h.process_id, h.gmail_message_id);
      }
    }

    const stats = { scanned: procList.length, deferido: 0, indeferido: 0, indefinido: 0, sem_email: 0, sem_despacho: 0, erros: 0, updated: 0 };
    const samples: Array<{ req: string; resultado: string | null; servico: string | null }> = [];

    // 3) Processa em pool de concorrência limitada.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < procList.length) {
        const proc = procList[cursor++];
        const gid = gidByProc.get(proc.id);
        if (!gid) { stats.sem_email++; continue; }
        try {
          const msg = await fetchGmailFull(gid, inboxes);
          if (!msg) { stats.sem_email++; continue; }
          const text = gmailBodyToText(msg);
          const despacho = extractDespacho(text);
          const servico = extractServico(text);
          const resultado = classifyResultado(despacho);
          if (resultado === 'deferido') stats.deferido++;
          else if (resultado === 'indeferido') stats.indeferido++;
          else { stats.indefinido++; if (!despacho) stats.sem_despacho++; }
          if (samples.length < 8) samples.push({ req: proc.requerimento_number, resultado: resultado || null, servico: servico || null });

          if (!dryRun && (resultado || servico || despacho)) {
            const { error: upErr } = await supabase
              .from('inss_admin_processes')
              .update({
                resultado: resultado ?? undefined,
                servico: servico ?? undefined,
                despacho: despacho ?? undefined,
              })
              .eq('id', proc.id);
            if (upErr) stats.erros++; else stats.updated++;
          }
        } catch { stats.erros++; }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    return res.status(200).json({ success: true, dry_run: dryRun, ...stats, samples });
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err?.message || String(err) });
  }
};

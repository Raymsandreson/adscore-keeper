/**
 * meta-call-queue-processor — processa whatsapp_call_queue rows com provider='meta_cloud'.
 *
 * Fluxos:
 *  - status='pending_permission':
 *      Se já existe permissão granted pra (phone, phone_number_id) → empurra pra ready_to_call.
 *      Senão: envia template de permissão (Graph API messages) e marca awaiting_permission.
 *  - status='ready_to_call':
 *      Verifica janela/horário; chama dispatchMetaCall() (STUB hoje — quando Meta liberar acesso,
 *      é só plugar o endpoint POST /{phone_number_id}/calls).
 *  - status='awaiting_permission' / 'awaiting_meta_calling_api':
 *      Sem ação automática (espera webhook ou retry manual).
 *
 * Rodando via pg_cron (a cada 1 min) que faz POST autenticado em /functions/meta-call-queue-processor.
 */

import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';
const BATCH_SIZE = 20;

interface QueueRow {
  id: string;
  phone: string;
  instance_name: string;
  lead_id: string | null;
  lead_name: string | null;
  contact_name: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  provider: string;
  phone_number_id_used: string | null;
  permission_template_used: string | null;
  owner_user_id: string | null;
  board_id: string | null;
}

interface BoardSettings {
  auto_call_enabled?: boolean;
  auto_call_window?: { start: string; end: string; weekdays?: number[] };
  auto_call_max_attempts?: number;
  auto_call_retry_minutes?: number[];
  auto_call_permission_template_name?: string;
  auto_call_permission_template_language?: string;
}

function isWithinWindow(settings: BoardSettings | null): { ok: boolean; reason?: string } {
  const w = settings?.auto_call_window;
  if (!w) return { ok: true };
  const now = new Date();
  const weekday = now.getUTCDay(); // 0..6 — UI deve gravar em UTC ou rever
  const wd = w.weekdays;
  if (Array.isArray(wd) && wd.length > 0 && !wd.includes(weekday)) {
    return { ok: false, reason: 'OUT_OF_WEEKDAY' };
  }
  if (w.start && w.end) {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (cur < start || cur > end) return { ok: false, reason: 'OUT_OF_HOURS' };
  }
  return { ok: true };
}

function nextRetryAt(settings: BoardSettings | null, attempts: number): string {
  const arr = settings?.auto_call_retry_minutes || [5, 30, 120];
  const minutes = arr[Math.min(attempts, arr.length - 1)] ?? 60;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function loadBoardSettings(boardId: string | null): Promise<BoardSettings | null> {
  if (!boardId) return null;
  const { data } = await supabase
    .from('kanban_boards')
    .select('settings')
    .eq('id', boardId)
    .maybeSingle();
  return ((data as any)?.settings as BoardSettings) || null;
}

async function sendPermissionTemplate(
  row: QueueRow,
  settings: BoardSettings | null,
): Promise<{ ok: boolean; templateName?: string; error?: string }> {
  if (!TOKEN) return { ok: false, error: 'MISSING_TOKEN' };
  const templateName = settings?.auto_call_permission_template_name;
  const lang = settings?.auto_call_permission_template_language || 'pt_BR';
  if (!templateName) return { ok: false, error: 'NO_TEMPLATE_CONFIGURED' };
  if (!row.phone_number_id_used) return { ok: false, error: 'NO_PHONE_NUMBER_ID' };

  const url = `${GRAPH}/${API_VERSION}/${row.phone_number_id_used}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: row.phone,
    type: 'template',
    template: { name: templateName, language: { code: lang } },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.message || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, templateName };
}

/**
 * STUB — Meta Cloud Calling API ainda em beta fechado.
 * Quando você tiver acesso, troque o corpo desta função pelo POST real:
 *   POST {GRAPH}/{API_VERSION}/{phone_number_id}/calls
 *   Body: { messaging_product: 'whatsapp', to: phone, ... }
 * E retorne { ok: true, callId } com o id que a Meta devolver.
 */
async function dispatchMetaCall(row: QueueRow): Promise<{ ok: boolean; callId?: string; error?: string }> {
  console.warn(
    `[meta-call] STUB — Meta Cloud Calling API indisponível. lead=${row.lead_id} phone=***${row.phone.slice(-4)} pnid=${row.phone_number_id_used}`,
  );
  return { ok: false, error: 'META_CALLING_API_NOT_AVAILABLE' };
}

async function processOne(row: QueueRow): Promise<{ id: string; result: string }> {
  const settings = await loadBoardSettings(row.board_id);
  const nowIso = new Date().toISOString();

  // 1) pending_permission → checa permissão existente
  if (row.status === 'pending_permission') {
    const pnid = row.phone_number_id_used;
    if (!pnid) {
      await supabase
        .from('whatsapp_call_queue')
        .update({ status: 'failed', last_result: 'no_phone_number_id', updated_at: nowIso } as any)
        .eq('id', row.id);
      return { id: row.id, result: 'failed:no_pnid' };
    }

    const { data: perm } = await supabase
      .from('whatsapp_call_permissions')
      .select('status, expires_at')
      .eq('phone', row.phone)
      .eq('phone_number_id', pnid)
      .maybeSingle();

    const granted =
      (perm as any)?.status === 'granted' &&
      (!(perm as any)?.expires_at || new Date((perm as any).expires_at).getTime() > Date.now());

    if (granted) {
      await supabase
        .from('whatsapp_call_queue')
        .update({ status: 'ready_to_call', last_result: 'permission_already_granted', updated_at: nowIso } as any)
        .eq('id', row.id);
      return { id: row.id, result: 'advanced:ready_to_call' };
    }

    // Manda template de permissão
    const sent = await sendPermissionTemplate(row, settings);
    if (!sent.ok) {
      await supabase
        .from('whatsapp_call_queue')
        .update({
          status: 'failed',
          last_result: `template_send_failed:${sent.error}`,
          updated_at: nowIso,
        } as any)
        .eq('id', row.id);
      return { id: row.id, result: `failed:template:${sent.error}` };
    }

    // Registra permissão pending
    await supabase
      .from('whatsapp_call_permissions')
      .upsert(
        {
          phone: row.phone,
          phone_number_id: pnid,
          lead_id: row.lead_id,
          status: 'pending',
          template_sent: sent.templateName,
          template_sent_at: nowIso,
          updated_at: nowIso,
        } as any,
        { onConflict: 'phone,phone_number_id' },
      );

    await supabase
      .from('whatsapp_call_queue')
      .update({
        status: 'awaiting_permission',
        permission_template_used: sent.templateName,
        last_result: 'permission_template_sent',
        next_action_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
        updated_at: nowIso,
      } as any)
      .eq('id', row.id);

    return { id: row.id, result: 'template_sent' };
  }

  // 2) ready_to_call → dispara ligação (STUB hoje)
  if (row.status === 'ready_to_call') {
    const win = isWithinWindow(settings);
    if (!win.ok) {
      await supabase
        .from('whatsapp_call_queue')
        .update({
          scheduled_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          last_result: `delayed:${win.reason}`,
          updated_at: nowIso,
        } as any)
        .eq('id', row.id);
      return { id: row.id, result: `delayed:${win.reason}` };
    }
    if (row.attempts >= row.max_attempts) {
      await supabase
        .from('whatsapp_call_queue')
        .update({ status: 'failed', last_result: 'max_attempts_reached', updated_at: nowIso } as any)
        .eq('id', row.id);
      return { id: row.id, result: 'failed:max_attempts' };
    }

    const dispatched = await dispatchMetaCall(row);
    const newAttempts = row.attempts + 1;

    if (dispatched.ok) {
      await supabase
        .from('whatsapp_call_queue')
        .update({
          status: 'calling',
          attempts: newAttempts,
          last_attempt_at: nowIso,
          meta_call_id: dispatched.callId || null,
          last_result: 'call_dispatched',
          updated_at: nowIso,
        } as any)
        .eq('id', row.id);
      return { id: row.id, result: 'dispatched' };
    }

    if (dispatched.error === 'META_CALLING_API_NOT_AVAILABLE') {
      // Não consome tentativa — fica parado aguardando a feature
      await supabase
        .from('whatsapp_call_queue')
        .update({
          status: 'awaiting_meta_calling_api',
          last_result: 'awaiting_meta_calling_api_release',
          updated_at: nowIso,
        } as any)
        .eq('id', row.id);
      return { id: row.id, result: 'awaiting_meta_api' };
    }

    // Outro erro → conta tentativa, reagenda
    await supabase
      .from('whatsapp_call_queue')
      .update({
        status: newAttempts >= row.max_attempts ? 'failed' : 'ready_to_call',
        attempts: newAttempts,
        last_attempt_at: nowIso,
        scheduled_at: nextRetryAt(settings, newAttempts - 1),
        last_result: `dispatch_error:${dispatched.error}`,
        updated_at: nowIso,
      } as any)
      .eq('id', row.id);
    return { id: row.id, result: `retry:${dispatched.error}` };
  }

  return { id: row.id, result: `skipped:${row.status}` };
}

export async function handler(req: Request, res: Response): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('whatsapp_call_queue')
      .select(
        'id, phone, instance_name, lead_id, lead_name, contact_name, status, attempts, max_attempts, scheduled_at, provider, phone_number_id_used, permission_template_used, owner_user_id, board_id',
      )
      .eq('provider', 'meta_cloud')
      .in('status', ['pending_permission', 'ready_to_call'])
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error('[meta-call-queue] fetch error:', error);
      res.status(200).json({ success: false, error: error.message });
      return;
    }

    const rows = (data as QueueRow[]) || [];
    if (rows.length === 0) {
      res.status(200).json({ success: true, processed: 0 });
      return;
    }

    const results: Array<{ id: string; result: string }> = [];
    for (const row of rows) {
      try {
        results.push(await processOne(row));
      } catch (e: any) {
        console.error(`[meta-call-queue] row ${row.id} failed:`, e);
        results.push({ id: row.id, result: `exception:${e?.message || 'unknown'}` });
      }
    }

    res.status(200).json({ success: true, processed: results.length, results });
  } catch (e: any) {
    console.error('[meta-call-queue] fatal:', e);
    res.status(200).json({ success: false, error: e?.message || 'unknown' });
  }
}

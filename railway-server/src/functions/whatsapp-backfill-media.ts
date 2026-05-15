import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { handler as downloadMedia } from './whatsapp-download-media';

const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

async function verifyCloudJwt(authHeader?: string): Promise<boolean> {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token || token === CLOUD_ANON_KEY) return false;
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    return r.ok;
  } catch {
    return false;
  }
}

function isEnc(u?: string | null) {
  if (typeof u !== 'string') return false;
  return /\.enc(?:\?|$)/i.test(u) || /^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(u);
}

// Estado em memória: progresso da última varredura por usuário (single-tenant simples)
const state: { running: boolean; total: number; processed: number; ok: number; fail: number; startedAt?: string; lastError?: string } = {
  running: false, total: 0, processed: 0, ok: 0, fail: 0,
};

async function runBackfill(authHeader: string) {
  state.running = true;
  state.total = 0; state.processed = 0; state.ok = 0; state.fail = 0;
  state.startedAt = new Date().toISOString();
  state.lastError = undefined;

  try {
    // 1. Pega todas as mensagens com mídia faltante ou criptografada + mediaKey
    const { data: rows, error } = await ext
      .from('whatsapp_messages')
      .select('id, phone, external_message_id, media_url, metadata, message_type, created_at')
      .in('message_type', ['image', 'video', 'audio', 'document'])
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) { state.lastError = error.message; return; }

    // 2. Filtra os que precisam de reparo + têm mediaKey + agrupa por bareId+phone
    const seen = new Set<string>();
    const toRepair: Array<{ id: string; bareKey: string }> = [];
    for (const r of rows || []) {
      if (r.media_url && !isEnc(r.media_url)) continue; // já OK
      const mk = (r.metadata as any)?.message?.content?.mediaKey || (r.metadata as any)?.message?.content?.media_key;
      if (typeof mk !== 'string' || mk.length < 32) continue;
      const ext = String(r.external_message_id || '');
      const bare = ext.includes(':') ? ext.split(':').pop()! : ext;
      const key = `${r.phone}|${bare}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toRepair.push({ id: r.id, bareKey: key });
    }

    state.total = toRepair.length;

    // 3. Chama whatsapp-download-media uma vez por grupo (a função replica para irmãos)
    const CONCURRENCY = 3;
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push((async () => {
        while (cursor < toRepair.length) {
          const idx = cursor++;
          const item = toRepair[idx];
          try {
            const fakeReq: any = {
              headers: { authorization: authHeader },
              body: { message_row_id: item.id },
            };
            const fakeRes: any = { _body: null, _status: 200, status(c: number) { this._status = c; return this; }, json(b: any) { this._body = b; return this; } };
            await downloadMedia(fakeReq, fakeRes, () => {});
            if (fakeRes._body?.success) state.ok++;
            else state.fail++;
          } catch {
            state.fail++;
          } finally {
            state.processed++;
          }
        }
      })());
    }
    await Promise.all(workers);
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
  } finally {
    state.running = false;
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: any) => res.status(200).json(b);
  const action = String(req.body?.action || 'status');

  if (action === 'status') return ok({ success: true, ...state });

  if (action === 'start') {
    const authHeader = req.headers.authorization as string | undefined;
    const authed = await verifyCloudJwt(authHeader);
    if (!authed) return ok({ success: false, error: 'Sessão inválida.' });
    if (state.running) return ok({ success: false, error: 'Já existe um reparo em andamento.', ...state });
    runBackfill(authHeader!).catch(() => {});
    return ok({ success: true, started: true });
  }

  return ok({ success: false, error: 'Ação inválida (use start ou status).' });
};

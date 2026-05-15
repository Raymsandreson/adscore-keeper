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

function isStorageOk(u?: string | null) {
  if (typeof u !== 'string' || !u) return false;
  if (/\.enc(?:\?|$)/i.test(u)) return false;
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(u)) return false;
  return /\/storage\/v1\/object\/public\//i.test(u);
}

function isBroken(u?: string | null) {
  if (!u) return true;
  if (/\.enc(?:\?|$)/i.test(u)) return true;
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(u)) return true;
  return false;
}

function bareIdOf(extId: string | null | undefined): string {
  const s = String(extId || '');
  return s.includes(':') ? s.split(':').pop()! : s;
}

type ErrorBuckets = {
  expired_404: number;   // .enc devolveu 404/410 (mídia velha, irrecuperável)
  network_err: number;   // erro de rede ao baixar .enc ou UazAPI
  uazapi_fail: number;   // UazAPI não conhece mais o id (4xx/5xx)
  decrypt_err: number;   // baixou mas não decifrou / bytes inválidos
  no_candidate: number;  // sem mediaKey ou sem url
  other: number;
};

const state: { running: boolean; total: number; processed: number; ok: number; fail: number; siblingCopied: number; decrypted: number; errors: ErrorBuckets; sampleErrors: string[]; startedAt?: string; lastError?: string; phase?: string } = {
  running: false, total: 0, processed: 0, ok: 0, fail: 0, siblingCopied: 0, decrypted: 0,
  errors: { expired_404: 0, network_err: 0, uazapi_fail: 0, decrypt_err: 0, no_candidate: 0, other: 0 },
  sampleErrors: [],
};

function classifyError(errMsg: string): keyof ErrorBuckets {
  const m = String(errMsg || '').toLowerCase();
  // padrões: "enc-direct:404", "enc-direct:410", "uazapi[xxx]:404"
  if (/enc-direct:(404|410|403)/.test(m)) return 'expired_404';
  if (/enc-direct-err:/.test(m) || /fetch failed|network|timeout|econnreset/.test(m)) return 'network_err';
  if (/uazapi\[[^\]]*\]:(4\d\d|5\d\d)/.test(m)) return 'uazapi_fail';
  if (/decrypt|hkdf|mac|sha|invalid/.test(m)) return 'decrypt_err';
  if (/sem token|nenhuma/.test(m)) return 'no_candidate';
  return 'other';
}

async function runBackfill(authHeader: string) {
  state.running = true;
  state.total = 0; state.processed = 0; state.ok = 0; state.fail = 0;
  state.siblingCopied = 0; state.decrypted = 0;
  state.errors = { expired_404: 0, network_err: 0, uazapi_fail: 0, decrypt_err: 0, no_candidate: 0, other: 0 };
  state.sampleErrors = [];
  state.startedAt = new Date().toISOString();
  state.lastError = undefined;
  state.phase = 'scanning';

  try {
    // Pega últimos 8000 registros de mídia
    const { data: rows, error } = await ext
      .from('whatsapp_messages')
      .select('id, phone, external_message_id, media_url, media_type, metadata, message_type, instance_name, created_at')
      .in('message_type', ['image', 'video', 'audio', 'document'])
      .order('created_at', { ascending: false })
      .limit(8000);

    if (error) { state.lastError = error.message; return; }

    // Agrupa por phone + bareId
    type Row = { id: string; phone: string; external_message_id: string | null; media_url: string | null; media_type: string | null; metadata: any; message_type: string; instance_name: string | null };
    const groups = new Map<string, Row[]>();
    for (const r of (rows || []) as Row[]) {
      const bare = bareIdOf(r.external_message_id);
      if (!bare || !r.phone) continue;
      const key = `${r.phone}|${bare}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    // FASE 1: cópia entre irmãos (rápido, sem rede WA)
    state.phase = 'sibling-copy';
    const needsRepair: Row[] = [];
    for (const [, sibs] of groups) {
      const good = sibs.find(s => isStorageOk(s.media_url));
      if (good) {
        // Copia para todos os irmãos quebrados
        for (const s of sibs) {
          if (s.id === good.id) continue;
          if (isBroken(s.media_url) || !s.media_url) {
            const { error: upErr } = await ext.from('whatsapp_messages').update({
              media_url: good.media_url,
              media_type: good.media_type || s.media_type,
            }).eq('id', s.id);
            if (!upErr) state.siblingCopied++;
          }
        }
      } else {
        // Nenhum irmão tem storage OK — precisa decifrar.
        // Pega o primeiro com mediaKey + URL .enc
        const candidate = sibs.find(s => {
          const mk = s.metadata?.message?.content?.mediaKey || s.metadata?.message?.content?.media_key;
          return typeof mk === 'string' && mk.length >= 32 && isBroken(s.media_url) && s.media_url;
        });
        if (candidate) needsRepair.push(candidate);
      }
    }

    state.total = needsRepair.length;

    // FASE 2: decifrar via whatsapp-download-media (mais lento)
    state.phase = 'decrypting';
    const CONCURRENCY = 3;
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push((async () => {
        while (cursor < needsRepair.length) {
          const idx = cursor++;
          const item = needsRepair[idx];
          try {
            const fakeReq: any = {
              headers: { authorization: authHeader },
              body: { message_row_id: item.id },
            };
            const fakeRes: any = { _body: null, _status: 200, status(c: number) { this._status = c; return this; }, json(b: any) { this._body = b; return this; } };
            await downloadMedia(fakeReq, fakeRes, () => {});
            if (fakeRes._body?.success) { state.ok++; state.decrypted++; }
            else {
              state.fail++;
              const msg = String(fakeRes._body?.error || 'unknown');
              state.errors[classifyError(msg)]++;
              if (state.sampleErrors.length < 8) state.sampleErrors.push(msg.slice(0, 200));
            }
          } catch (e) {
            state.fail++;
            const msg = e instanceof Error ? e.message : String(e);
            state.errors[classifyError(msg)]++;
            if (state.sampleErrors.length < 8) state.sampleErrors.push(msg.slice(0, 200));
          } finally {
            state.processed++;
          }
        }
      })());
    }
    await Promise.all(workers);
    state.phase = 'done';
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

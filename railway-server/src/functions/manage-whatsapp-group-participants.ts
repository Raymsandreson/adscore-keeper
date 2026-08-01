import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

interface Instance {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string | null;
}

const DEFAULT_BASE = 'https://abraci.uazapi.com';
type Action = 'add' | 'remove' | 'promote' | 'demote';
const VALID: Action[] = ['add', 'remove', 'promote', 'demote'];

function normalize(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

async function uazUpdate(actor: Instance, groupJid: string, action: Action, numbers: string[]) {
  const base = (actor.base_url || DEFAULT_BASE).replace(/\/$/, '');
  const resp = await fetch(`${base}/group/updateParticipants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: actor.instance_token },
    body: JSON.stringify({ groupjid: groupJid, action, participants: numbers }),
  });
  let body: any = null;
  try { body = await resp.json(); } catch { body = await resp.text().catch(() => null); }
  return { ok: resp.ok, status: resp.status, body };
}

// Resolve a instância no Externo (fonte de verdade de `whatsapp_instances`).
// Antes só existia o caminho `actor` pronto, o que obrigava um proxy no Cloud a
// buscar o token antes de chamar aqui — e esse proxy lia a tabela do Cloud, onde
// ela não vive. Aceitando `instance_name`/`instance_id`, o front chama direto.
async function resolveInstance(instance_id?: string, instance_name?: string): Promise<Instance | null> {
  if (!instance_id && !instance_name) return null;
  let q = ext
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  q = instance_id ? q.eq('id', instance_id) : q.ilike('instance_name', instance_name!);
  const { data } = await q.limit(1).maybeSingle();
  return (data as any)?.instance_token ? (data as any as Instance) : null;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { actor: actorFromBody, instance_id, instance_name, group_jid, action, numbers } = req.body || {};

    // `actor` continua aceito: o proxy do Cloud ainda manda nesse formato.
    const actor: Instance | null = actorFromBody?.instance_token
      ? actorFromBody
      : await resolveInstance(instance_id, instance_name);

    if (!actor?.instance_token) {
      return res.json({
        success: false,
        error: instance_id || instance_name || actorFromBody
          ? 'instance not found or missing token'
          : 'actor, instance_name or instance_id is required',
      });
    }
    if (!group_jid) {
      return res.json({ success: false, error: 'group_jid is required' });
    }
    if (!VALID.includes(action)) {
      return res.json({ success: false, error: `invalid action; expected one of ${VALID.join(', ')}` });
    }

    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const n of Array.isArray(numbers) ? numbers : []) {
      const d = normalize(n);
      if (d.length >= 8 && !seen.has(d)) {
        seen.add(d);
        cleaned.push(d);
      }
    }

    if (cleaned.length === 0) {
      return res.json({ success: false, error: 'no valid numbers provided' });
    }

    // Para 'promote', se o número não estiver no grupo, faz add antes.
    if (action === 'promote') {
      await uazUpdate(actor, group_jid, 'add', cleaned).catch(() => null);
      await new Promise((r) => setTimeout(r, 2500));
    }

    const result = await uazUpdate(actor, group_jid, action, cleaned);
    console.log(`[manage-group-participants] ${action} on ${group_jid}: status=${result.status}, body=${JSON.stringify(result.body).slice(0, 300)}`);

    let ok_count = 0;
    const details: any[] = [];
    if (Array.isArray(result.body?.participants)) {
      for (const p of result.body.participants) {
        const st = p?.status ?? p?.code;
        const okFlag = st === 200 || st === '200' || st === 'success';
        if (okFlag) ok_count++;
        details.push({ jid: p?.jid || p?.participant, status: st, message: p?.message });
      }
    } else if (result.ok) {
      ok_count = cleaned.length;
    }

    return res.json({
      success: true,
      action,
      attempted: cleaned.length,
      ok_count,
      details,
      raw_status: result.status,
    });
  } catch (err: any) {
    console.error('[manage-whatsapp-group-participants] error:', err);
    return res.json({ success: false, error: err?.message || 'Internal error' });
  }
};

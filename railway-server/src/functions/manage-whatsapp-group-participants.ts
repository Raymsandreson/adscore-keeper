import type { RequestHandler } from 'express';

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

export const handler: RequestHandler = async (req, res) => {
  try {
    const { actor, group_jid, action, numbers } = req.body || {};

    if (!actor?.instance_token) {
      return res.json({ success: false, error: 'actor instance with token is required' });
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

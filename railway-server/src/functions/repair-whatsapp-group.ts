import type { RequestHandler } from 'express';

interface Instance {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string | null;
  owner_phone: string | null;
  is_active: boolean;
}

const DEFAULT_BASE = 'https://abraci.uazapi.com';

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d : null;
}

async function uazUpdateParticipants(
  inst: Instance,
  groupJid: string,
  action: 'add' | 'promote' | 'demote' | 'remove',
  numbers: string[]
): Promise<{ ok: boolean; status: number; body: any }> {
  const base = (inst.base_url || DEFAULT_BASE).replace(/\/$/, '');
  const resp = await fetch(`${base}/group/updateParticipants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: inst.instance_token,
    },
    body: JSON.stringify({ groupjid: groupJid, action, participants: numbers }),
  });
  let body: any = null;
  try { body = await resp.json(); } catch { body = await resp.text().catch(() => null); }
  return { ok: resp.ok, status: resp.status, body };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { action, group_jid, actor, target_numbers, promote_to_admin } = req.body || {};

    if (action !== 'update_participants') {
      return res.status(400).json({
        success: false,
        error: `Action '${action}' not implemented on Railway yet. Only 'update_participants' is available.`,
      });
    }

    if (!group_jid) {
      return res.status(400).json({ success: false, error: 'group_jid is required' });
    }

    if (!actor) {
      return res.status(400).json({ success: false, error: 'actor instance is required' });
    }

    const numbers: string[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(target_numbers) ? target_numbers : []) {
      const phone = normalizePhone(String(raw));
      if (!phone) continue;
      if (seen.has(phone)) continue;
      seen.add(phone);
      numbers.push(phone);
    }

    if (numbers.length === 0) {
      return res.json({
        success: true,
        added: 0,
        promoted: 0,
        message: 'Nenhuma instância-alvo com owner_phone válido encontrada.',
      });
    }

    // 4. Adicionar
    const addResult = await uazUpdateParticipants(actor, group_jid, 'add', numbers);
    console.log('[repair-whatsapp-group] add result:', addResult.status, JSON.stringify(addResult.body));

    let added = 0;
    let alreadyIn: string[] = [];
    if (Array.isArray(addResult.body?.participants)) {
      for (const p of addResult.body.participants) {
        // UazAPI retorna status 200 = adicionado, 409 = já é membro
        const status = p?.status ?? p?.code;
        if (status === 200 || status === '200') added++;
        else if (status === 409 || status === '409') alreadyIn.push(p?.jid || p?.participant || '');
      }
    } else if (addResult.ok) {
      added = numbers.length;
    }

    // 5. Promover (se solicitado): tenta promover TODOS os números (já membros + recém-adicionados)
    let promoted = 0;
    if (promote_to_admin) {
      const promoteResult = await uazUpdateParticipants(actor, group_jid, 'promote', numbers);
      console.log('[repair-whatsapp-group] promote result:', promoteResult.status, JSON.stringify(promoteResult.body));

      if (Array.isArray(promoteResult.body?.participants)) {
        for (const p of promoteResult.body.participants) {
          const status = p?.status ?? p?.code;
          if (status === 200 || status === '200') promoted++;
        }
      } else if (promoteResult.ok) {
        promoted = numbers.length;
      }
    }

    return res.json({
      success: true,
      added,
      promoted,
      attempted: numbers.length,
      actor_instance: actor.instance_name,
      message: promote_to_admin
        ? `${promoted} de ${numbers.length} instância(s) promovida(s) a admin (${added} recém-adicionada(s)).`
        : `${added} de ${numbers.length} instância(s) adicionada(s) ao grupo.`,
    });
  } catch (err: any) {
    console.error('[repair-whatsapp-group] error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal error',
    });
  }
};

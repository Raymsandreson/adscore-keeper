import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';

const CLOUD_URL = process.env.CLOUD_FUNCTIONS_URL || '';
const CLOUD_SRK = process.env.CLOUD_SERVICE_ROLE_KEY || '';

const cloud = createClient(CLOUD_URL, CLOUD_SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    const { action, group_jid, board_id, instance_id, promote_to_admin, scope } = req.body || {};

    if (action !== 'add_instances') {
      return res.status(400).json({
        success: false,
        error: `Action '${action}' not implemented on Railway yet. Only 'add_instances' is available.`,
      });
    }

    if (!group_jid) {
      return res.status(400).json({ success: false, error: 'group_jid is required' });
    }

    // 1. Buscar instância "atuadora" (a que vai executar a chamada UazAPI — precisa ser admin do grupo)
    let actor: Instance | null = null;
    if (instance_id) {
      const { data } = await cloud
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
        .eq('id', instance_id)
        .maybeSingle();
      actor = data as Instance | null;
    }
    if (!actor) {
      // fallback: primeira ativa
      const { data } = await cloud
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      actor = data as Instance | null;
    }
    if (!actor) {
      return res.status(400).json({ success: false, error: 'No active instance found to act on group' });
    }

    // 2. Determinar instâncias-alvo (cujos owner_phone serão adicionados/promovidos)
    let targets: Instance[] = [];
    if (scope === 'all_active') {
      const { data, error } = await cloud
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
        .eq('is_active', true);
      if (error) throw error;
      targets = (data || []) as Instance[];
    } else if (board_id) {
      const { data, error } = await cloud
        .from('board_group_instances')
        .select('instance_id, whatsapp_instances!inner(id, instance_name, instance_token, base_url, owner_phone, is_active)')
        .eq('board_id', board_id);
      if (error) throw error;
      targets = (data || [])
        .map((row: any) => row.whatsapp_instances)
        .filter((i: Instance) => i && i.is_active);
    } else {
      return res.status(400).json({ success: false, error: 'board_id or scope=all_active required' });
    }

    // 3. Coletar números (owner_phone) válidos, deduplicados, excluindo o actor
    const numbers: string[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      const phone = normalizePhone(t.owner_phone);
      if (!phone) continue;
      if (t.id === actor.id) continue; // actor já está no grupo
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

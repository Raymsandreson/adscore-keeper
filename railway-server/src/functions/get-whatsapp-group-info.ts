// Busca o nome (subject) de um grupo WhatsApp via UazAPI /group/info.
// Tenta a instância informada primeiro; se não responder, varre as ativas
// até alguma participar do grupo. Persiste o nome em lead_whatsapp_groups
// quando lead_id é informado, pra evitar nova chamada à API.
//
// Body: { group_jid: string, instance_name?: string, lead_id?: string }
// Retorno HTTP 200: { success, name?: string, used_instance?: string, error? }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const TIMEOUT_MS = 6000;

async function fetchInfo(baseUrl: string, token: string, groupjid: string): Promise<any | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ groupjid }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function extractName(data: any): string {
  return (
    data?.subject ||
    data?.name ||
    data?.data?.subject ||
    data?.group?.subject ||
    data?.chat?.name ||
    ''
  ).toString().trim();
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { group_jid, instance_name, lead_id } = req.body || {};
    if (!group_jid || typeof group_jid !== 'string' || !group_jid.includes('@g.us')) {
      return res.json({ success: false, error: 'group_jid (com @g.us) é obrigatório' });
    }

    let foundName = '';
    let usedInstance = '';
    let source: 'index' | 'uazapi' | '' = '';

    // 1) Primeiro tenta whatsapp_groups_index (sync diária — sem custo de API)
    try {
      const { data: idxRows } = await ext
        .from('whatsapp_groups_index')
        .select('contact_name, instance_name, last_seen')
        .eq('group_jid', group_jid)
        .order('last_seen', { ascending: false })
        .limit(1);
      const r = (idxRows || [])[0] as any;
      const nm = r?.contact_name ? String(r.contact_name).trim() : '';
      if (nm) {
        foundName = nm;
        usedInstance = r?.instance_name || '';
        source = 'index';
      }
    } catch (e) {
      console.warn('[get-whatsapp-group-info] index lookup failed:', (e as Error)?.message);
    }

    // 2) Fallback: chama UazAPI /group/info varrendo instâncias
    const tried: string[] = [];
    if (!foundName) {
      const instances: Array<{ instance_name: string; instance_token: string; base_url: string | null }> = [];

      if (instance_name) {
        const { data: hinted } = await ext
          .from('whatsapp_instances')
          .select('instance_name, instance_token, base_url')
          .ilike('instance_name', instance_name)
          .limit(1)
          .maybeSingle();
        if (hinted?.instance_token) instances.push(hinted as any);
      }

      const { data: actives } = await ext
        .from('whatsapp_instances')
        .select('instance_name, instance_token, base_url, is_active')
        .eq('is_active', true);
      for (const i of (actives || []) as any[]) {
        if (!i?.instance_token) continue;
        if (instances.find((x) => x.instance_name === i.instance_name)) continue;
        instances.push(i);
      }

      for (const inst of instances) {
        tried.push(inst.instance_name);
        const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
        const data = await fetchInfo(baseUrl, inst.instance_token, group_jid);
        const name = extractName(data);
        if (name) {
          foundName = name;
          usedInstance = inst.instance_name;
          source = 'uazapi';
          break;
        }
      }
    }

    if (!foundName) {
      return res.json({ success: false, error: 'Nenhuma fonte retornou o nome do grupo', tried });
    }

    // Persiste no banco se houver lead_id (sempre atualiza — nomes mudam)
    if (lead_id) {
      try {
        await ext
          .from('lead_whatsapp_groups')
          .update({ group_name: foundName })
          .eq('lead_id', lead_id)
          .eq('group_jid', group_jid);
      } catch (e) {
        console.warn('[get-whatsapp-group-info] persist failed:', (e as Error)?.message);
      }
    }

    return res.json({ success: true, name: foundName, used_instance: usedInstance, source });
  } catch (err: any) {
    console.error('[get-whatsapp-group-info] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

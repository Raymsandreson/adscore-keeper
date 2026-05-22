// Sincroniza um agente IA com etiquetas UazAPI em TODAS as instâncias ativas.
//
// Metáfora: o agente é uma pessoa, a etiqueta é o crachá dele. Esta função
// garante que o crachá esteja pendurado em todas as portarias (instâncias):
// verde se o agente está ativo no sistema, cinza se está desativado.
// Se você renomear o agente, o crachá é renomeado em todo lugar.
// Se apagar o agente, o crachá é recolhido em todo lugar.
//
// Body: { agent_id: string, operation: 'upsert' | 'delete' }
// Retorno HTTP 200: { success, results: Array<{instance_name, ok, action, error?}> }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const COLOR_ACTIVE = 3;   // verde (paleta Meta)
const COLOR_INACTIVE = 0; // cinza (paleta Meta)

async function callUazapi(baseUrl: string, token: string, body: any): Promise<{ ok: boolean; data: any; status: number; text: string }> {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/label/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, data, status: r.status, text };
}

async function findUazapiLabelByName(baseUrl: string, token: string, labelName: string): Promise<{ id: string; name: string; color: number | null } | null> {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/labels`, {
    method: 'GET',
    headers: { token },
  });
  if (!r.ok) return null;

  const data: any = await r.json().catch(() => null);
  const labels: any[] = Array.isArray(data) ? data : (data?.labels || []);
  const normalizedName = labelName.trim().toLowerCase();
  const matches = labels
    .map((l: any) => ({
      id: String(l.id ?? l.labelId ?? l.labelid ?? ''),
      name: String(l.name ?? l.label ?? ''),
      color: typeof l.color === 'number' ? l.color : null,
    }))
    .filter((l) => l.id && l.name.trim().toLowerCase() === normalizedName);

  return matches[matches.length - 1] || null;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { agent_id, operation } = (req.body || {}) as { agent_id?: string; operation?: 'upsert' | 'delete' };
    if (!agent_id || typeof agent_id !== 'string') {
      return res.json({ success: false, error: 'agent_id é obrigatório' });
    }
    if (operation !== 'upsert' && operation !== 'delete') {
      return res.json({ success: false, error: "operation deve ser 'upsert' ou 'delete'" });
    }

    // 1. Carrega agente
    const { data: agent, error: agentErr } = await ext
      .from('wjia_command_shortcuts')
      .select('id, shortcut_name, is_active')
      .eq('id', agent_id)
      .maybeSingle();
    if (agentErr) return res.json({ success: false, error: `agent lookup: ${agentErr.message}` });
    if (!agent) return res.json({ success: false, error: `agent ${agent_id} not found` });

    const agentName: string = (agent as any).shortcut_name || '';
    const isActive: boolean = !!(agent as any).is_active;
    const effectiveOp = operation === 'delete' ? 'delete' : 'upsert';
    const color = isActive ? COLOR_ACTIVE : COLOR_INACTIVE;


    // 2. Lista instâncias UazAPI ativas (tem token)
    const { data: instances, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url')
      .not('instance_token', 'is', null);
    if (instErr) return res.json({ success: false, error: `instances lookup: ${instErr.message}` });


    // 3. Lista mapeamentos existentes do agente
    const { data: existingMappings } = await ext
      .from('agent_instance_labels')
      .select('id, instance_name, label_id, label_name, color, deleted_at')
      .eq('agent_id', agent_id);
    const mappingByInstance = new Map<string, any>();
    for (const m of (existingMappings || []) as any[]) {
      mappingByInstance.set(String(m.instance_name).toLowerCase(), m);
    }

    const results: Array<{ instance_name: string; ok: boolean; action: string; error?: string }> = [];

    // 4. DELETE: apaga em todas instâncias que tiverem mapeamento
    if (effectiveOp === 'delete') {
      for (const inst of (instances || []) as any[]) {
        const key = String(inst.instance_name).toLowerCase();
        const mapping = mappingByInstance.get(key);
        if (!mapping || mapping.deleted_at) continue;
        const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
        try {
          const r = await callUazapi(baseUrl, inst.instance_token, { labelid: mapping.label_id, delete: true });
          if (!r.ok) {
            results.push({ instance_name: inst.instance_name, ok: false, action: 'delete', error: r.text.slice(0, 200) });
            continue;
          }
          await ext
            .from('agent_instance_labels')
            .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', mapping.id);
          results.push({ instance_name: inst.instance_name, ok: true, action: 'delete' });
        } catch (e: any) {
          results.push({ instance_name: inst.instance_name, ok: false, action: 'delete', error: e?.message || 'unknown' });
        }
      }
      return res.json({ success: true, agent_id, agent_name: agentName, operation: 'delete', results });
    }

    // 5. UPSERT: cria ou atualiza (rename + recolor) em cada instância
    for (const inst of (instances || []) as any[]) {
      const key = String(inst.instance_name).toLowerCase();
      const mapping = mappingByInstance.get(key);
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com';

      try {
        if (mapping && !mapping.deleted_at) {
          // Já existe — só renomeia/recolore se mudou
          if (mapping.label_name === agentName && mapping.color === color) {
            results.push({ instance_name: inst.instance_name, ok: true, action: 'unchanged' });
            continue;
          }
          const r = await callUazapi(baseUrl, inst.instance_token, {
            labelid: mapping.label_id,
            name: agentName,
            color,
          });
          if (!r.ok) {
            results.push({ instance_name: inst.instance_name, ok: false, action: 'update', error: r.text.slice(0, 200) });
            continue;
          }
          await ext
            .from('agent_instance_labels')
            .update({ label_name: agentName, color, updated_at: new Date().toISOString(), deleted_at: null })
            .eq('id', mapping.id);
          results.push({ instance_name: inst.instance_name, ok: true, action: 'update' });
        } else {
          // Criar
          const found = await findUazapiLabelByName(baseUrl, inst.instance_token, agentName);
          if (found) {
            await ext
              .from('agent_instance_labels')
              .upsert({
                agent_id,
                instance_name: inst.instance_name,
                label_id: found.id,
                label_name: agentName,
                color,
                updated_at: new Date().toISOString(),
                deleted_at: null,
              } as any, { onConflict: 'agent_id,instance_name' });
            if (found.color !== color) {
              await callUazapi(baseUrl, inst.instance_token, { labelid: found.id, name: agentName, color });
            }
            results.push({ instance_name: inst.instance_name, ok: true, action: 'adopt-existing' });
            continue;
          }

          const r = await callUazapi(baseUrl, inst.instance_token, {
            labelid: 'new',
            name: agentName,
            color,
          });
          if (!r.ok) {
            results.push({ instance_name: inst.instance_name, ok: false, action: 'create', error: r.text.slice(0, 200) });
            continue;
          }
          // Extrai label_id da resposta (UazAPI varia o nome do campo)
          const newId = String(
            r.data?.label?.id ?? r.data?.label?.labelid ?? r.data?.id ?? r.data?.labelid ?? '',
          );
          const resolvedId = newId || (await findUazapiLabelByName(baseUrl, inst.instance_token, agentName))?.id || '';
          if (!resolvedId) {
            results.push({ instance_name: inst.instance_name, ok: false, action: 'create', error: 'no label_id in response' });
            continue;
          }
          const upsertPayload = {
            agent_id,
            instance_name: inst.instance_name,
            label_id: resolvedId,
            label_name: agentName,
            color,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          };
          await ext
            .from('agent_instance_labels')
            .upsert(upsertPayload as any, { onConflict: 'agent_id,instance_name' });
          results.push({ instance_name: inst.instance_name, ok: true, action: 'create' });
        }
      } catch (e: any) {
        results.push({ instance_name: inst.instance_name, ok: false, action: 'unknown', error: e?.message || 'unknown' });
      }
    }

    return res.json({ success: true, agent_id, agent_name: agentName, operation: 'upsert', color, results });
  } catch (err: any) {
    console.error('[sync-agent-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

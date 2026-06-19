// Apaga TODAS as etiquetas de agente (🤖 ...) de UMA instância UazAPI.
// Útil quando o WhatsApp daquela instância está poluído com etiquetas
// de testes/agentes antigos e o usuário quer ver só as etiquetas
// das ETAPAS do funil (sincronizadas via sync-stage-labels).
//
// Body: { instance_name: string, also_disable_settings?: boolean }
// Retorno HTTP 200: { success, results: [{label_id, label_name, ok, error?}] }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { uazapiDeleteLabel } from '../lib/uazapi-labels';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { instance_name, also_disable_settings } = (req.body || {}) as {
      instance_name?: string;
      also_disable_settings?: boolean;
    };
    if (!instance_name || typeof instance_name !== 'string') {
      return res.json({ success: false, error: 'instance_name é obrigatório' });
    }

    const instKey = instance_name.toLowerCase();

    const { data: inst, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url')
      .ilike('instance_name', instance_name)
      .maybeSingle();
    if (instErr) return res.json({ success: false, error: `instance lookup: ${instErr.message}` });
    if (!inst || !inst.instance_token) {
      return res.json({ success: false, error: `instância "${instance_name}" não encontrada ou sem token` });
    }
    const baseUrl = inst.base_url || 'https://abraci.uazapi.com';

    // Carrega TODAS as etiquetas de agente mapeadas para esta instância (ativas)
    const { data: mappings, error: mapErr } = await ext
      .from('agent_instance_labels')
      .select('id, agent_id, label_id, label_name')
      .ilike('instance_name', instance_name)
      .is('deleted_at', null);
    if (mapErr) return res.json({ success: false, error: `mapping lookup: ${mapErr.message}` });

    const results: Array<{ label_id: string; label_name: string; ok: boolean; action: string; error?: string }> = [];

    for (const m of (mappings || []) as any[]) {
      try {
        const r = await uazapiDeleteLabel(baseUrl, inst.instance_token, m.label_id);
        if (!r.ok) {
          results.push({ label_id: m.label_id, label_name: m.label_name, ok: false, action: 'delete', error: `HTTP ${r.status} — ${String(r.text).slice(0, 200)}` });
          continue;
        }
        await ext
          .from('agent_instance_labels')
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', m.id);
        results.push({ label_id: m.label_id, label_name: m.label_name, ok: true, action: 'delete' });
      } catch (e: any) {
        results.push({ label_id: m.label_id, label_name: m.label_name, ok: false, action: 'delete', error: e?.message || 'unknown' });
      }
    }

    // Opcional: desabilita agent_instance_settings dessa instância pra evitar recriação automática
    if (also_disable_settings) {
      await ext
        .from('agent_instance_settings')
        .update({ is_enabled: false, updated_at: new Date().toISOString() })
        .eq('instance_id', inst.id);
    }

    return res.json({
      success: true,
      instance_name: inst.instance_name,
      deleted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err: any) {
    console.error('[wipe-instance-agent-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown' });
  }
};

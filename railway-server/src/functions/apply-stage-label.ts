// Aplica a etiqueta da nova etapa e remove a da antiga em TODAS as instâncias
// UazAPI onde o telefone do lead tem histórico.
//
// Body: { lead_id: string, board_id: string, new_stage_id: string, old_stage_id?: string }
// Retorna HTTP 200: { success, results: [{ instance_name, removed?, added?, error? }], lead_phone }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { uazapiChatLabel, getInstancesForPhone } from '../lib/uazapi-chat-labels';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { lead_id, board_id, new_stage_id, old_stage_id } = req.body || {};
    if (!lead_id || !board_id || !new_stage_id) {
      return res.json({ success: false, error: 'lead_id, board_id e new_stage_id são obrigatórios' });
    }

    // 1) Telefone do lead
    const { data: lead } = await ext
      .from('leads')
      .select('id, lead_phone')
      .eq('id', lead_id)
      .maybeSingle();
    const rawPhone = (lead as any)?.lead_phone || '';
    const phoneDigits = String(rawPhone).replace(/\D/g, '');
    if (!phoneDigits) {
      return res.json({ success: false, error: 'lead sem lead_phone preenchido' });
    }

    // 2) Mapeamentos das etapas envolvidas (todas as instâncias)
    const stageIds = old_stage_id && old_stage_id !== new_stage_id
      ? [new_stage_id, old_stage_id]
      : [new_stage_id];
    const { data: mappings } = await ext
      .from('stage_instance_labels')
      .select('instance_name, stage_id, label_id, label_name')
      .eq('board_id', board_id)
      .in('stage_id', stageIds)
      .is('deleted_at', null);

    const byInst = new Map<string, { add?: any; remove?: any }>();
    for (const m of (mappings || []) as any[]) {
      const key = String(m.instance_name).toLowerCase();
      const entry = byInst.get(key) || {};
      if (m.stage_id === new_stage_id) entry.add = m;
      else if (m.stage_id === old_stage_id) entry.remove = m;
      byInst.set(key, entry);
    }

    if (byInst.size === 0) {
      return res.json({
        success: false,
        error: 'Nenhum mapeamento de etiqueta encontrado para essas etapas. Rode "Sincronizar etiquetas" no painel do board.',
        lead_phone: phoneDigits,
      });
    }

    // 3) Instâncias onde o contato existe
    const instances = await getInstancesForPhone(ext, phoneDigits);
    if (instances.length === 0) {
      return res.json({ success: false, error: 'Contato não encontrado em nenhuma instância UazAPI', lead_phone: phoneDigits });
    }

    const results: any[] = [];
    for (const inst of instances) {
      const key = String(inst.instance_name).toLowerCase();
      const entry = byInst.get(key);
      if (!entry || !entry.add) {
        results.push({ instance_name: inst.instance_name, skipped: true, reason: 'sem mapeamento para a nova etapa nesta instância' });
        continue;
      }
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
      const out: any = { instance_name: inst.instance_name };

      // Remover label antiga (se houver e for diferente da nova)
      if (entry.remove && entry.remove.label_id !== entry.add.label_id) {
        try {
          const r = await uazapiChatLabel(baseUrl, inst.instance_token, phoneDigits, entry.remove.label_id, 'remove');
          out.removed = { label: entry.remove.label_name, ok: r.ok, status: r.status, ...(r.ok ? {} : { error: r.text.slice(0, 200) }) };
        } catch (e: any) {
          out.removed = { label: entry.remove.label_name, ok: false, error: e?.message };
        }
      }

      // Adicionar label nova
      try {
        const r = await uazapiChatLabel(baseUrl, inst.instance_token, phoneDigits, entry.add.label_id, 'add');
        out.added = { label: entry.add.label_name, ok: r.ok, status: r.status, ...(r.ok ? {} : { error: r.text.slice(0, 200) }) };
      } catch (e: any) {
        out.added = { label: entry.add.label_name, ok: false, error: e?.message };
      }

      results.push(out);
    }

    const anyAddOk = results.some((r) => r?.added?.ok);
    return res.json({ success: anyAddOk, lead_phone: phoneDigits, results });
  } catch (err: any) {
    console.error('[apply-stage-label] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

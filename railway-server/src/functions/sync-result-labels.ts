// Sincroniza as 5 etiquetas de RESULTADO de lead com TODAS as instâncias UazAPI.
// Etiquetas fixas (hardcoded — regra de negócio, não vira tela de admin):
//   in_progress / closed / refused / inviavel / cancelled
//
// Funciona igual sync-agent-labels: idempotente, compara nome+cor antes de update,
// grava em result_instance_labels pra o webhook conseguir voltar (WA → CRM).
//
// Body: { operation?: 'upsert' | 'delete' }  (default upsert)
// Retorna HTTP 200 sempre: { success, results: [{instance_name, result_key, ok, action, error?}] }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  uazapiCreateLabel,
  uazapiUpdateLabel,
  uazapiDeleteLabel,
  uazapiFindLabelByName,
} from '../lib/uazapi-labels';

// Paleta UazAPI (0..19, padrão Meta), alinhada ao print do WhatsApp Business.
// Em andamento=cinza, Fechado=verde, Recusado=lilás, Inviável=rosa/coral.
export const RESULT_LABELS = [
  { key: 'in_progress', name: '🕐 Em andamento', color: 6 },
  { key: 'closed',      name: '✅ Fechado',      color: 5 },
  { key: 'refused',     name: '❌ Recusado',     color: 13 },
  { key: 'inviavel',    name: '⚠️ Inviável',     color: 9 },
  { key: 'cancelled',   name: '🚫 Cancelado',    color: 1 },
] as const;

export const handler: RequestHandler = async (req, res) => {
  try {
    const operation = ((req.body || {}).operation || 'upsert') as 'upsert' | 'delete';
    if (operation !== 'upsert' && operation !== 'delete') {
      return res.json({ success: false, error: "operation deve ser 'upsert' ou 'delete'" });
    }

    const { data: instances, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url')
      .not('instance_token', 'is', null);
    if (instErr) return res.json({ success: false, error: `instances lookup: ${instErr.message}` });

    const { data: existing } = await ext
      .from('result_instance_labels')
      .select('id, instance_name, result_key, label_id, label_name, color, deleted_at');
    const mappingByKey = new Map<string, any>();
    for (const m of (existing || []) as any[]) {
      mappingByKey.set(`${String(m.instance_name).toLowerCase()}::${m.result_key}`, m);
    }

    const results: Array<{ instance_name: string; result_key: string; ok: boolean; action: string; error?: string }> = [];

    for (const inst of (instances || []) as any[]) {
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
      const instKey = String(inst.instance_name).toLowerCase();

      for (const def of RESULT_LABELS) {
        const mapKey = `${instKey}::${def.key}`;
        const mapping = mappingByKey.get(mapKey);

        try {
          if (operation === 'delete') {
            if (!mapping || mapping.deleted_at) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: true, action: 'unchanged' });
              continue;
            }
            const r = await uazapiDeleteLabel(baseUrl, inst.instance_token, mapping.label_id);
            if (!r.ok) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: false, action: 'delete', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
              continue;
            }
            await ext.from('result_instance_labels')
              .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', mapping.id);
            results.push({ instance_name: inst.instance_name, result_key: def.key, ok: true, action: 'delete' });
            continue;
          }

          // UPSERT
          if (mapping && !mapping.deleted_at) {
            if (mapping.label_name === def.name && mapping.color === def.color) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: true, action: 'unchanged' });
              continue;
            }
            const r = await uazapiUpdateLabel(baseUrl, inst.instance_token, mapping.label_id, def.name, def.color);
            if (!r.ok) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: false, action: 'update', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
              continue;
            }
            await ext.from('result_instance_labels')
              .update({ label_name: def.name, color: def.color, updated_at: new Date().toISOString(), deleted_at: null })
              .eq('id', mapping.id);
            results.push({ instance_name: inst.instance_name, result_key: def.key, ok: true, action: 'update' });
          } else {
            const r = await uazapiCreateLabel(baseUrl, inst.instance_token, def.name, def.color);
            if (!r.ok) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: false, action: 'create', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
              continue;
            }
            const newId = String(
              r.data?.label?.id ?? r.data?.label?.labelid ?? r.data?.id ?? r.data?.labelid ?? '',
            );
            const resolvedId = newId || (await uazapiFindLabelByName(baseUrl, inst.instance_token, def.name))?.id || '';
            if (!resolvedId) {
              results.push({ instance_name: inst.instance_name, result_key: def.key, ok: false, action: 'create', error: 'created sem label_id retornado' });
              continue;
            }
            await ext.from('result_instance_labels').upsert({
              result_key: def.key,
              instance_name: inst.instance_name,
              label_id: resolvedId,
              label_name: def.name,
              color: def.color,
              updated_at: new Date().toISOString(),
              deleted_at: null,
            } as any, { onConflict: 'result_key,instance_name' });
            results.push({ instance_name: inst.instance_name, result_key: def.key, ok: true, action: 'create' });
          }
        } catch (e: any) {
          results.push({ instance_name: inst.instance_name, result_key: def.key, ok: false, action: 'unknown', error: e?.message || 'unknown' });
        }
      }
    }

    return res.json({ success: true, operation, results });
  } catch (err: any) {
    console.error('[sync-result-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

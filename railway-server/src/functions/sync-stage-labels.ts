// Sincroniza as etiquetas das ETAPAS de um board do Kanban com TODAS as instâncias UazAPI.
//
// Cada stage do board vira uma etiqueta no WhatsApp. Se o stage tiver
// `result_key` ('closed'|'refused'|'inviavel'|'cancelled'|'in_progress') na config,
// REAPROVEITA a etiqueta global de result_instance_labels em vez de criar nova
// (assim "Fechados/Recusados/Inviáveis/Cancelamentos" no board BPC-Autismo
// reutilizam as etiquetas que o sync-result-labels já manteve).
//
// Body: { board_id: string, operation?: 'upsert' | 'delete' }
// Retorna HTTP 200 sempre: { success, results: [{instance_name, stage_id, ok, action, error?}] }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  uazapiCreateLabel,
  uazapiUpdateLabel,
  uazapiDeleteLabel,
  uazapiFindLabelByName,
} from '../lib/uazapi-labels';

const STAGE_LABEL_PREFIX = '📋';

// Cores baseadas na paleta visual do WhatsApp Business do print enviado.
// A UazAPI recebe inteiro (0..19), então mantemos um mapeamento por nome de etapa
// para evitar que todas as etiquetas caiam no azul padrão.
const STAGE_LABEL_COLOR = 3;
const STAGE_LABEL_COLOR_BY_NAME: Array<[RegExp, number]> = [
  [/nova\s*lead|recep[cç][aã]o|primeiro\s*contato/i, 4],
  [/em\s*andamento|andamento|onboarding|acompanhamento/i, 6],
  [/follow[-\s]*up|falar\s*depois/i, 5],
  [/vi[aá]vel|viabilidade|cadastrados\s*vi[aá]veis/i, 3],
  [/aguar\.?\s*documenta[cç][aã]o|aguardando\s*documentos|coleta\s*de\s*documentos|documentos\s*p\/\s*protocolo/i, 8],
  [/procura[cç][aã]o\s*assinada/i, 14],
  [/aguar\.?\s*assinatura|procura[cç][aã]o\s*enviada/i, 12],
  [/fechado|deferimento/i, 4],
  [/recusado|indeferimento/i, 13],
  [/desqualificado/i, 10],
  [/invi[aá]vel/i, 9],
  [/judicializa[cç][aã]o/i, 8],
];

function getStageLabelColor(stage: any): number {
  if (typeof stage?.label_color === 'number') return stage.label_color;
  const name = String(stage?.name || '');
  const match = STAGE_LABEL_COLOR_BY_NAME.find(([pattern]) => pattern.test(name));
  return match?.[1] ?? STAGE_LABEL_COLOR;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const board_id: string | undefined = body.board_id;
    const operation = (body.operation || 'upsert') as 'upsert' | 'delete';

    if (!board_id) return res.json({ success: false, error: 'board_id é obrigatório' });
    if (operation !== 'upsert' && operation !== 'delete') {
      return res.json({ success: false, error: "operation deve ser 'upsert' ou 'delete'" });
    }

    // Carrega board + stages do JSONB
    const { data: board, error: boardErr } = await ext
      .from('kanban_boards')
      .select('id, name, stages')
      .eq('id', board_id)
      .maybeSingle();
    if (boardErr || !board) return res.json({ success: false, error: `Board ${board_id} não encontrado` });

    const stages: any[] = Array.isArray((board as any).stages) ? (board as any).stages : [];
    if (stages.length === 0) return res.json({ success: false, error: 'Board sem stages' });

    // Carrega instâncias ativas
    const { data: instances, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url')
      .not('instance_token', 'is', null);
    if (instErr) return res.json({ success: false, error: `instances lookup: ${instErr.message}` });

    // Carrega mapeamentos atuais de stage_instance_labels + result_instance_labels (reuso)
    const { data: existing } = await ext
      .from('stage_instance_labels')
      .select('id, board_id, stage_id, instance_name, label_id, label_name, color, result_key, deleted_at')
      .eq('board_id', board_id);
    const mapByKey = new Map<string, any>();
    for (const m of (existing || []) as any[]) {
      mapByKey.set(`${String(m.instance_name).toLowerCase()}::${m.stage_id}`, m);
    }

    const { data: resultMappings } = await ext
      .from('result_instance_labels')
      .select('result_key, instance_name, label_id, label_name, color')
      .is('deleted_at', null);
    const resultByKey = new Map<string, any>();
    for (const m of (resultMappings || []) as any[]) {
      resultByKey.set(`${String(m.instance_name).toLowerCase()}::${m.result_key}`, m);
    }

    const results: Array<{ instance_name: string; stage_id: string; stage_name: string; ok: boolean; action: string; error?: string }> = [];

    for (const inst of (instances || []) as any[]) {
      const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
      const instKey = String(inst.instance_name).toLowerCase();

      for (const stage of stages) {
        const stageId: string = String(stage.id);
        const stageName: string = String(stage.name || stageId);
        const resultKey: string | null = stage.result_key || null;
        const desiredName = `${STAGE_LABEL_PREFIX} ${stageName}`;
        const desiredColor = getStageLabelColor(stage);

        const mapKey = `${instKey}::${stageId}`;
        const mapping = mapByKey.get(mapKey);
        const reuseFromResult = resultKey ? resultByKey.get(`${instKey}::${resultKey}`) : null;

        try {
          if (operation === 'delete') {
            if (!mapping || mapping.deleted_at) {
              results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'unchanged' });
              continue;
            }
            // Só apaga no UazAPI se NÃO for reuso de result-label
            if (!mapping.result_key) {
              const r = await uazapiDeleteLabel(baseUrl, inst.instance_token, mapping.label_id);
              if (!r.ok) {
                results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: false, action: 'delete', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
                continue;
              }
            }
            await ext.from('stage_instance_labels')
              .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', mapping.id);
            results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'delete' });
            continue;
          }

          // UPSERT
          // Caso 1: stage tem result_key → reaproveita label de result_instance_labels
          if (reuseFromResult) {
            const reuseLabelId = reuseFromResult.label_id;
            const reuseLabelName = reuseFromResult.label_name;
            const reuseColor = reuseFromResult.color ?? STAGE_LABEL_COLOR;

            if (mapping && !mapping.deleted_at && mapping.label_id === reuseLabelId) {
              results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'unchanged_reuse' });
              continue;
            }
            await ext.from('stage_instance_labels').upsert({
              board_id,
              stage_id: stageId,
              instance_name: inst.instance_name,
              label_id: reuseLabelId,
              label_name: reuseLabelName,
              color: reuseColor,
              result_key: resultKey,
              updated_at: new Date().toISOString(),
              deleted_at: null,
            } as any, { onConflict: 'board_id,stage_id,instance_name' });
            results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: mapping ? 'reuse_remap' : 'reuse_create' });
            continue;
          }

          // Caso 2: cria/atualiza etiqueta própria
          if (mapping && !mapping.deleted_at && !mapping.result_key) {
            if (mapping.label_name === desiredName && mapping.color === desiredColor) {
              results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'unchanged' });
              continue;
            }
            const r = await uazapiUpdateLabel(baseUrl, inst.instance_token, mapping.label_id, desiredName, desiredColor);
            if (!r.ok) {
              results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: false, action: 'update', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
              continue;
            }
            await ext.from('stage_instance_labels')
              .update({ label_name: desiredName, color: desiredColor, updated_at: new Date().toISOString(), deleted_at: null, result_key: null })
              .eq('id', mapping.id);
            results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'update' });
            continue;
          }

          // Criar
          const r = await uazapiCreateLabel(baseUrl, inst.instance_token, desiredName, desiredColor);
          if (!r.ok) {
            results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: false, action: 'create', error: `HTTP ${r.status} — ${r.text.slice(0,200)}` });
            continue;
          }
          const newId = String(
            r.data?.label?.id ?? r.data?.label?.labelid ?? r.data?.id ?? r.data?.labelid ?? '',
          );
          const resolvedId = newId || (await uazapiFindLabelByName(baseUrl, inst.instance_token, desiredName))?.id || '';
          if (!resolvedId) {
            results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: false, action: 'create', error: 'created sem label_id retornado' });
            continue;
          }
          await ext.from('stage_instance_labels').upsert({
            board_id,
            stage_id: stageId,
            instance_name: inst.instance_name,
            label_id: resolvedId,
            label_name: desiredName,
            color: desiredColor,
            result_key: null,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          } as any, { onConflict: 'board_id,stage_id,instance_name' });
          results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: true, action: 'create' });
        } catch (e: any) {
          results.push({ instance_name: inst.instance_name, stage_id: stageId, stage_name: stageName, ok: false, action: 'unknown', error: e?.message || 'unknown' });
        }
      }
    }

    return res.json({ success: true, board_id, operation, results });
  } catch (err: any) {
    console.error('[sync-stage-labels] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

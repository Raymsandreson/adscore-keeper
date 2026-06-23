// Reverso do apply-stage-label: WhatsApp -> Sistema.
// Quando a etiqueta de um chat muda no WhatsApp (evento UazAPI "labels"),
// este handler procura a etapa mapeada e move o card do lead no Kanban.
//
// Body: { instance_name: string, phone: string, label_ids: string[] }
// Resposta HTTP 200: { success, moved, reason?, lead_id?, stage_id? }
//
// Regras:
// - "Uma etiqueta por chat": se o chat tiver mais de uma label mapeada
//   no MESMO board, descarta o evento (não adivinha qual ganha).
// - Idempotente: se o lead já está na etapa correspondente, não faz nada
//   (evita loop sistema -> WA -> sistema).
// - Se nenhuma label do chat estiver mapeada, ignora (label de outro contexto).

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const norm = (s: string) => String(s || '').replace(/\D/g, '');

export const handler: RequestHandler = async (req, res) => {
  try {
    const { instance_name, phone, label_ids } = req.body || {};
    if (!instance_name || !phone) {
      return res.json({ success: false, error: 'instance_name e phone são obrigatórios' });
    }

    const phoneDigits = norm(phone);
    if (!phoneDigits) {
      return res.json({ success: false, error: 'phone inválido' });
    }

    const labelIds: string[] = Array.isArray(label_ids)
      ? label_ids.map((x) => String(x)).filter(Boolean)
      : [];

    // 1) Resolver lead pelo telefone (sufixo de 8 dígitos cobre 9º dígito variante)
    const tail = phoneDigits.slice(-8);
    const { data: leads } = await ext
      .from('leads')
      .select('id, board_id, status, lead_phone, lead_name')
      .ilike('lead_phone', `%${tail}%`)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(5);

    const lead = (leads || []).find((l: any) => norm(l.lead_phone).endsWith(tail));
    if (!lead) {
      return res.json({ success: true, moved: false, reason: 'lead não encontrado para o telefone' });
    }
    if (!lead.board_id) {
      return res.json({ success: true, moved: false, reason: 'lead sem board_id' });
    }

    // Se o chat ficou sem etiqueta, nada a fazer (não removemos do funil sozinhos).
    if (labelIds.length === 0) {
      return res.json({ success: true, moved: false, reason: 'sem labels no evento' });
    }

    // 2) Buscar mapeamentos do board do lead que batem com as labels recebidas nesta instância
    const instLower = String(instance_name).toLowerCase();
    const { data: mappings } = await ext
      .from('stage_instance_labels')
      .select('board_id, stage_id, instance_name, label_id, label_name')
      .eq('board_id', lead.board_id)
      .ilike('instance_name', instLower)
      .in('label_id', labelIds)
      .is('deleted_at', null);

    const matches = (mappings || []) as any[];

    if (matches.length === 0) {
      return res.json({ success: true, moved: false, reason: 'nenhuma label mapeada neste board' });
    }

    // "Uma etiqueta por chat": se houver mais de uma do mesmo board, descarta
    const uniqueStages = Array.from(new Set(matches.map((m) => m.stage_id)));
    if (uniqueStages.length > 1) {
      return res.json({
        success: true,
        moved: false,
        reason: 'múltiplas labels do board no chat — esperado apenas uma',
        stage_ids: uniqueStages,
      });
    }

    const targetStageId = uniqueStages[0];

    // 3) Idempotente: já está lá?
    if (lead.status === targetStageId) {
      return res.json({ success: true, moved: false, reason: 'lead já está na etapa', lead_id: lead.id, stage_id: targetStageId });
    }

    // 4) Mover
    const previousStage = lead.status;
    const { error: updErr } = await ext
      .from('leads')
      .update({ status: targetStageId, updated_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (updErr) {
      return res.json({ success: false, error: `Falha ao atualizar lead: ${updErr.message}` });
    }

    // 5) Histórico
    try {
      const { error: histErr } = await ext.from('lead_stage_history').insert({
        lead_id: lead.id,
        from_stage: previousStage,
        to_stage: targetStageId,
        from_board_id: lead.board_id,
        to_board_id: lead.board_id,
        changed_by: null,
        notes: `Movido via etiqueta WhatsApp (${instLower}) — labels: ${labelIds.join(',')}`,
      });
      if (histErr) console.warn('[apply-label-event] history insert failed:', histErr.message);
    } catch (e: any) {
      console.warn('[apply-label-event] history insert threw:', e?.message);
    }

    return res.json({
      success: true,
      moved: true,
      lead_id: lead.id,
      from_stage_id: previousStage,
      to_stage_id: targetStageId,
    });
  } catch (err: any) {
    console.error('[apply-label-event] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown' });
  }
};

// Retorna os mapeamentos stage→label de um board, agrupados por stage.
// Usado pelo Select de etiqueta nos cards/Dialog.
//
// Body: { board_id: string }
// Retorna: { success, stages: [{ stage_id, stage_name, instances: [{instance_name, label_id, label_name}] }] }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { board_id } = req.body || {};
    if (!board_id) return res.json({ success: false, error: 'board_id é obrigatório' });

    const { data: board } = await ext
      .from('kanban_boards')
      .select('id, name, stages')
      .eq('id', board_id)
      .maybeSingle();
    if (!board) return res.json({ success: false, error: `Board ${board_id} não encontrado` });

    const stages: any[] = Array.isArray((board as any).stages) ? (board as any).stages : [];

    const { data: mappings } = await ext
      .from('stage_instance_labels')
      .select('stage_id, instance_name, label_id, label_name, color, result_key')
      .eq('board_id', board_id)
      .is('deleted_at', null);

    const byStage = new Map<string, any[]>();
    for (const m of (mappings || []) as any[]) {
      const arr = byStage.get(m.stage_id) || [];
      arr.push(m);
      byStage.set(m.stage_id, arr);
    }

    const out = stages.map((s) => ({
      stage_id: s.id,
      stage_name: s.name,
      stage_color: s.color || null,
      result_key: s.result_key || null,
      instances: byStage.get(s.id) || [],
      synced: (byStage.get(s.id) || []).length > 0,
    }));

    return res.json({ success: true, board_id, board_name: (board as any).name, stages: out });
  } catch (err: any) {
    return res.json({ success: false, error: err?.message || 'unknown' });
  }
};

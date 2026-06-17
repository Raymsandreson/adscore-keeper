// Define o `result_key` de uma etapa do board (escreve dentro do JSONB kanban_boards.stages).
// Permite reaproveitar etiquetas globais de result_instance_labels (Fechado, Recusado, etc).
//
// Body: { board_id, stage_id, result_key: null | 'closed' | 'refused' | 'inviavel' | 'cancelled' | 'in_progress' }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const VALID_KEYS = new Set([null, 'closed', 'refused', 'inviavel', 'cancelled', 'in_progress']);

export const handler: RequestHandler = async (req, res) => {
  try {
    const { board_id, stage_id, result_key } = req.body || {};
    if (!board_id || !stage_id) return res.json({ success: false, error: 'board_id e stage_id obrigatórios' });
    const normalized = result_key === '' || result_key === undefined ? null : result_key;
    if (!VALID_KEYS.has(normalized)) return res.json({ success: false, error: 'result_key inválido' });

    const { data: board } = await ext
      .from('kanban_boards')
      .select('id, stages')
      .eq('id', board_id)
      .maybeSingle();
    if (!board) return res.json({ success: false, error: 'board não encontrado' });

    const stages: any[] = Array.isArray((board as any).stages) ? (board as any).stages : [];
    let found = false;
    const next = stages.map((s) => {
      if (String(s.id) === String(stage_id)) {
        found = true;
        return { ...s, result_key: normalized };
      }
      return s;
    });
    if (!found) return res.json({ success: false, error: 'stage_id não está no board' });

    const { error } = await ext
      .from('kanban_boards')
      .update({ stages: next, updated_at: new Date().toISOString() } as any)
      .eq('id', board_id);
    if (error) return res.json({ success: false, error: error.message });

    return res.json({ success: true, board_id, stage_id, result_key: normalized });
  } catch (err: any) {
    return res.json({ success: false, error: err?.message || 'unknown' });
  }
};

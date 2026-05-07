// Calcula a posição determinística do lead na fila de fechados de um funil.
// Regra: ordenar todos os leads cujo checkpoint `setup_lead_close` está done,
// por confirmed_at ASC. Posição do lead alvo = 1-based.
// Retorna também o lead anterior na sequência, pra UI conferir antes de regerar.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { lead_id } = (req.body || {}) as { lead_id?: string };
    if (!lead_id) return ok({ success: false, error: 'lead_id required' });

    const { data: lead } = await ext
      .from('leads')
      .select('id, board_id, lead_name')
      .eq('id', lead_id)
      .maybeSingle();
    if (!lead) return ok({ success: false, error: 'lead not found' });
    if (!lead.board_id) return ok({ success: false, error: 'lead sem board_id' });

    // Todos os checkpoints setup_lead_close=done, com leads do mesmo board.
    // Como onboarding_checkpoints não tem board_id, fazemos join via leads.
    const { data: closedSteps, error: csErr } = await ext
      .from('onboarding_checkpoints')
      .select('lead_id, confirmed_at, updated_at')
      .eq('step', 'setup_lead_close')
      .eq('status', 'done');
    if (csErr) return ok({ success: false, error: csErr.message });

    const candidateIds = (closedSteps || []).map((c: any) => c.lead_id);
    if (candidateIds.length === 0) {
      return ok({ success: true, position: null, total_closed: 0, previous_closed: null });
    }

    // Filtra pelos que pertencem ao mesmo board
    const { data: leadsRows, error: lErr } = await ext
      .from('leads')
      .select('id, lead_name, board_id')
      .in('id', candidateIds)
      .eq('board_id', lead.board_id);
    if (lErr) return ok({ success: false, error: lErr.message });

    const leadIdsInBoard = new Set((leadsRows || []).map((l: any) => l.id));
    const leadNameById = new Map<string, string>(
      (leadsRows || []).map((l: any) => [l.id, l.lead_name || '']),
    );

    // Combina com confirmed_at, ordena
    const sequence = (closedSteps || [])
      .filter((c: any) => leadIdsInBoard.has(c.lead_id))
      .map((c: any) => ({
        lead_id: c.lead_id as string,
        when: (c.confirmed_at || c.updated_at) as string,
        lead_name: leadNameById.get(c.lead_id) || '',
      }))
      .sort((a, b) => (a.when || '').localeCompare(b.when || ''));

    const idx = sequence.findIndex((s) => s.lead_id === lead_id);
    const position = idx === -1 ? null : idx + 1;
    const previous = idx > 0 ? sequence[idx - 1] : null;

    return ok({
      success: true,
      position,
      total_closed: sequence.length,
      previous_closed: previous
        ? { lead_id: previous.lead_id, lead_name: previous.lead_name, confirmed_at: previous.when }
        : null,
    });
  } catch (e: any) {
    return ok({ success: false, error: e?.message || String(e) });
  }
};

// Webhook chamado por Google Apps Script (onFormSubmit) quando chega
// linha nova em uma planilha de formulário Meta. Cria lead no funil
// configurado, deduplica por telefone (mesmo board, últimos 30 dias).
//
// Segurança: token aleatório de 32 chars gravado em
// kanban_boards.sheet_webhook_token. URL pública, sem x-api-key.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

function normalizePhone(raw: unknown): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function pickByMapping(row: Record<string, unknown>, mapping: Record<string, string>, targetField: string): string | null {
  // mapping é { "lead_field": "Sheet Column Header" }. Procura primeiro
  // a coluna mapeada; se ausente, devolve null.
  const sheetCol = mapping?.[targetField];
  if (!sheetCol) return null;
  const v = row[sheetCol];
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

export const handler: RequestHandler = async (req, res) => {
  // Sempre HTTP 200 com payload — Apps Script não reage bem a 4xx/5xx.
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);

  try {
    const token = (req.params as { token?: string }).token;
    if (!token || token.length < 16) return ok({ success: false, error: 'invalid token' });

    const body = (req.body || {}) as { row?: Record<string, unknown>; rows?: Record<string, unknown>[] };
    const rows = body.rows || (body.row ? [body.row] : []);
    if (!rows.length) return ok({ success: false, error: 'no rows in payload' });

    // Localiza o board pelo token
    const { data: board, error: boardErr } = await ext
      .from('kanban_boards')
      .select('id, name, sheet_enabled, sheet_field_mapping, sheet_initial_stage_id, stages')
      .eq('sheet_webhook_token', token)
      .maybeSingle();

    if (boardErr) return ok({ success: false, error: boardErr.message });
    if (!board) return ok({ success: false, error: 'token not linked to any board' });
    if (!board.sheet_enabled) return ok({ success: false, error: 'ingest disabled for this board' });

    const mapping = (board.sheet_field_mapping || {}) as Record<string, string>;
    const stages = (board.stages as Array<{ id: string }>) || [];
    const initialStageId = board.sheet_initial_stage_id || stages[0]?.id || 'new';

    const results: Array<{ row_index: number; status: string; lead_id?: string; reason?: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const rawPhone = pickByMapping(row, mapping, 'phone');
        const phone = normalizePhone(rawPhone);
        if (!phone) {
          results.push({ row_index: i, status: 'skipped', reason: 'phone missing/invalid' });
          continue;
        }

        const name = pickByMapping(row, mapping, 'name') || `Lead ${phone.slice(-4)}`;

        // Dedup: mesmo board + telefone nos últimos 30 dias
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: dup } = await ext
          .from('leads')
          .select('id, lead_name')
          .eq('board_id', board.id)
          .eq('phone', phone)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dup) {
          // Cria atividade "Possível duplicata" no lead existente
          await ext.from('lead_activities').insert({
            lead_id: dup.id,
            title: 'Possível duplicata recebida via planilha',
            description: `Nova submissão do formulário com o mesmo telefone (${phone}).\nDados: ${JSON.stringify(row).slice(0, 800)}`,
            activity_type: 'observacao',
            status: 'concluida',
          });
          results.push({ row_index: i, status: 'duplicate', lead_id: dup.id });
          continue;
        }

        // Coleta campos extras mapeados (ex: estado_civil, renda, laudo) em details
        const extras: Record<string, string> = {};
        for (const [leadField, sheetCol] of Object.entries(mapping)) {
          if (leadField === 'phone' || leadField === 'name') continue;
          const v = row[sheetCol];
          if (v !== undefined && v !== null && v !== '') extras[leadField] = String(v);
        }

        const { data: created, error: insErr } = await ext
          .from('leads')
          .insert({
            lead_name: name,
            phone,
            board_id: board.id,
            stage_id: initialStageId,
            status: 'new',
            lead_source_label: `Planilha: ${board.name}`,
            details: { sheet_ingest: extras, sheet_row: row },
          })
          .select('id')
          .single();

        if (insErr) {
          results.push({ row_index: i, status: 'error', reason: insErr.message });
          continue;
        }

        results.push({ row_index: i, status: 'created', lead_id: created.id });
      } catch (err) {
        results.push({ row_index: i, status: 'error', reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return ok({ success: true, board_id: board.id, board_name: board.name, results });
  } catch (err) {
    console.error('[sheet-lead-ingest] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};

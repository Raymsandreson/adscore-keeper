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
  const sheetCol = mapping?.[targetField];
  if (!sheetCol) return null;
  const v = row[sheetCol];
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

// Procura o nome REAL do cliente na linha bruta, independente do mapping.
// Aceita variações comuns (case-insensitive, com/sem acento, espaço/underline).
function findClientNameInRow(row: Record<string, unknown>): string | null {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const targets = new Set([
    'nomecompleto', 'nomedocliente', 'nomecliente', 'nomedobeneficiario',
    'nomedavitima', 'nomedoautor', 'beneficiario', 'cliente', 'nome',
  ]);
  for (const [key, val] of Object.entries(row)) {
    if (val === undefined || val === null || val === '') continue;
    if (targets.has(norm(String(key)))) {
      const s = String(val).trim();
      if (s) return s;
    }
  }
  return null;
}

// Rejeita "nomes" lixo: títulos PREV, placeholders "....", "Lead WhatsApp +55...", etc.
function isJunkName(name: string): boolean {
  const s = (name || '').trim();
  if (!s || s.length < 3) return true;
  if (/^\.+$/.test(s)) return true;
  if (/^prev\s/i.test(s)) return true;
  if (/^lead\s+whatsapp/i.test(s)) return true;
  if (/^lead\s+\d{3,}$/i.test(s)) return true;
  if (!/[a-zà-ú]/i.test(s)) return true;
  return false;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);

  try {
    const token = (req.params as { token?: string }).token;
    if (!token || token.length < 16) return ok({ success: false, error: 'invalid token' });

    const body = (req.body || {}) as { row?: Record<string, unknown>; rows?: Record<string, unknown>[] };
    const rows = body.rows || (body.row ? [body.row] : []);
    if (!rows.length) return ok({ success: false, error: 'no rows in payload' });

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

        // Resolução de nome: priorizar nome real do cliente da planilha.
        // 1) coluna mapeada como 'name'; se vier lixo (PREV, ...., etc), descarta.
        // 2) procura colunas candidatas (nome_completo, nome_do_cliente, etc).
        // 3) sem nome real → SKIP (não cria lead com "Lead WhatsApp +55...").
        let name = (pickByMapping(row, mapping, 'name') || '').trim();
        if (isJunkName(name)) name = '';
        if (!name) {
          const fallback = findClientNameInRow(row);
          if (fallback && !isJunkName(fallback)) name = fallback.trim();
        }
        if (!name) {
          results.push({ row_index: i, status: 'skipped', reason: 'no real client name in row (need nome_completo)' });
          continue;
        }
        if (name.startsWith('<test lead')) {
          results.push({ row_index: i, status: 'skipped', reason: 'test lead' });
          continue;
        }

        // Dedup: mesmo board, últimos 30 dias. Por telefone se houver, senão por nome.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let dupQuery = ext
          .from('leads')
          .select('id, lead_name')
          .eq('board_id', board.id)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(1);
        dupQuery = phone ? dupQuery.eq('lead_phone', phone) : dupQuery.eq('lead_name', name);
        const { data: dup } = await dupQuery.maybeSingle();

        if (dup) {
          await ext.from('lead_activities').insert({
            lead_id: dup.id,
            title: 'Possível duplicata recebida via planilha',
            description: `Nova submissão da planilha com mesma identidade.\nDados: ${JSON.stringify(row).slice(0, 800)}`,
            activity_type: 'observacao',
            status: 'concluida',
          });
          results.push({ row_index: i, status: 'duplicate', lead_id: dup.id });
          continue;
        }


        // Coleta campos extras mapeados (qualquer leadField != phone/name)
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
            lead_phone: phone || null,
            board_id: board.id,
            status: initialStageId,
            source: `Planilha: ${board.name}`,
            notes: `Importado via planilha: ${board.name}`,
          })
          .select('id')
          .single();

        if (insErr) {
          results.push({ row_index: i, status: 'error', reason: insErr.message });
          continue;
        }

        // Persistir cada extra como custom field do board.
        // Garante o lead_custom_fields (auto-cria por board) e grava em lead_custom_field_values.
        for (const [fieldKey, valueText] of Object.entries(extras)) {
          try {
            const fieldName = fieldKey
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());

            // 1) Garante a definição do campo no board
            let { data: fieldDef } = await ext
              .from('lead_custom_fields')
              .select('id')
              .eq('board_id', board.id)
              .eq('field_name', fieldName)
              .maybeSingle();

            if (!fieldDef) {
              const ins = await ext
                .from('lead_custom_fields')
                .insert({
                  board_id: board.id,
                  field_name: fieldName,
                  field_type: 'text',
                  tab: 'info',
                })
                .select('id')
                .single();
              fieldDef = ins.data as any;
            }

            // 2) Grava valor
            if (fieldDef?.id) {
              await ext.from('lead_custom_field_values').insert({
                lead_id: created.id,
                field_id: fieldDef.id,
                value_text: valueText.slice(0, 2000),
              });
            }
          } catch (cfErr) {
            console.warn('[sheet-lead-ingest] custom field skipped', fieldKey, cfErr);
          }
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

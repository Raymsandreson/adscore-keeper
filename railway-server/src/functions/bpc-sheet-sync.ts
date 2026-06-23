// Sincroniza a planilha Google "Meta Lead Ads — BPC-LOAS Autismo" com o board BPC.
// Lê as 8 abas por operador, dedup por (phone + board_id) nos últimos 30 dias,
// e cria leads novos na primeira etapa. Idempotente — pode ser chamado a cada N minutos.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const SPREADSHEET_ID_DEFAULT = '1EXB6oFovhX2LOHsC2X20LFk-JVIkjk-NR5Er4cUn6Qw';
const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// Mapeamento por PALAVRA-CHAVE (não por nome exato).
// Resiliente a renomear aba ("LEADS EDILAN" / "1LEADS EDILAN" / "EDILAN NOVO" → Edilan).
const OPERATOR_KEYWORDS: { keyword: string; operator: string }[] = [
  { keyword: 'israel', operator: 'Israel' },
  { keyword: 'cris', operator: 'Cris' },
  { keyword: 'mateus', operator: 'Mateus' },
  { keyword: 'edilan', operator: 'Edilan' },
  { keyword: 'karol', operator: 'Karolyne' },
  { keyword: 'andressa', operator: 'Andressa' },
  { keyword: 'keilane', operator: 'Keilane' },
  { keyword: 'api', operator: 'API' },
];
const SKIP_TABS = new Set(['BASE_UNIFICADA']);

async function discoverSheetTabs(spreadsheetId: string): Promise<{ tab: string; operator: string }[]> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey || !gsKey) throw new Error('Missing connector keys');
  const resp = await fetch(
    `${GATEWAY}/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': gsKey } },
  );
  if (!resp.ok) throw new Error(`discoverSheetTabs ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json: any = await resp.json();
  const titles: string[] = (json.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
  const found: { tab: string; operator: string }[] = [];
  for (const title of titles) {
    if (SKIP_TABS.has(title)) continue;
    const lower = String(title).toLowerCase();
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
  }
  return found;
}

interface ParsedRow {
  form_lead_id: string;
  created_at: string;
  name: string;
  phone: string; // normalizado, só dígitos (com 55 quando aplicável)
  phone_key: string; // últimos 8 dígitos (chave de match)
  operator: string;
  campaign_name: string;
  ad_name: string;
  form_name: string;
  estado_civil: string;
  renda: string;
  laudo: string;
  possui_advogado: string;
  filho_autista: string;
  tab: string;
}

function normalizePhone(raw: string): string {
  if (!raw) return '';
  let digits = String(raw).replace(/^p:/i, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function phoneKey(digits: string): string {
  return digits.slice(-8);
}

function isJunkName(s: string): boolean {
  const t = (s || '').trim();
  if (!t || t.length < 3) return true;
  if (t.startsWith('<test')) return true;
  if (/^\.+$/.test(t)) return true;
  if (!/[a-zà-ú]/i.test(t)) return true;
  return false;
}

function rowToObj(headers: string[], r: any[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = String(r[i] ?? '').trim();
  });
  return o;
}

async function fetchTab(spreadsheetId: string, meta: { tab: string; operator: string }): Promise<ParsedRow[]> {
  const lovableKey = process.env.LOVABLE_API_KEY || '';
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY || '';
  if (!lovableKey || !gsKey) throw new Error('Missing connector keys (LOVABLE_API_KEY / GOOGLE_SHEETS_API_KEY)');

  const url = `${GATEWAY}/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(meta.tab)}'!A1:Z5000`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': gsKey,
    },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`sheet "${meta.tab}" ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { values?: any[][] };
  const values: any[][] = json.values || [];
  if (values.length < 2) return [];
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

  const out: ParsedRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || !r.length) continue;
    const o = rowToObj(headers, r);
    const rawPhone =
      o['telefone'] || o['phone_number'] || o['número_do_whatsapp'] || o['qual_o_seu_número_de_contato_?'] || '';
    const name = o['nome_completo'] || o['full_name'] || '';
    if (isJunkName(name)) continue;
    const phone = normalizePhone(rawPhone);
    if (phone.length < 10) continue;
    out.push({
      form_lead_id: o['id'] || '',
      created_at: o['created_time'] || '',
      name: name.trim(),
      phone,
      phone_key: phoneKey(phone),
      operator: meta.operator,
      campaign_name: o['campaign_name'] || '',
      ad_name: o['ad_name'] || '',
      form_name: o['form_name'] || '',
      estado_civil: o['estado_civil'] || o['marital_status'] || '',
      renda: o['qual_a_sua_renda_familiar_?'] || '',
      laudo: o['possui_laudo_médico_ou_relatório_escolar_?'] || '',
      possui_advogado: o['possui_advogado_?'] || '',
      filho_autista: o['você_possui_filho_autista_ou_conhece_alguém_autista_?'] || '',
      tab: meta.tab,
    });
  }
  return out;
}

// Garante a definição de um custom field do board (cria se não existir).
async function ensureCustomField(boardId: string, fieldKey: string, displayName: string): Promise<string | null> {
  try {
    const { data: existing } = await ext
      .from('lead_custom_fields')
      .select('id')
      .eq('board_id', boardId)
      .eq('field_name', displayName)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created, error } = await ext
      .from('lead_custom_fields')
      .insert({ board_id: boardId, field_name: displayName, field_type: 'text', tab: 'info' })
      .select('id')
      .single();
    if (error) return null;
    return created?.id || null;
  } catch {
    return null;
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const {
      board_id,
      spreadsheet_id,
      since_days,
      dry_run,
    } = (req.body || {}) as {
      board_id?: string;
      spreadsheet_id?: string;
      since_days?: number;
      dry_run?: boolean;
    };

    if (!board_id) return ok({ success: false, error: 'board_id obrigatório' });

    const spreadsheetId = (spreadsheet_id || SPREADSHEET_ID_DEFAULT).trim();
    const sinceDays = Math.max(1, Math.min(365, Number(since_days) || 7));
    const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

    // 1) Board: pegar primeira etapa
    const { data: board, error: boardErr } = await ext
      .from('kanban_boards')
      .select('id, name, stages')
      .eq('id', board_id)
      .maybeSingle();
    if (boardErr) return ok({ success: false, error: `board: ${boardErr.message}` });
    if (!board) return ok({ success: false, error: 'board não encontrado' });
    const stages = (board.stages as Array<{ id: string; name: string }>) || [];
    if (!stages.length) return ok({ success: false, error: 'board sem etapas' });
    const initialStageId = stages[0].id;

    // 2) Lê todas as abas em paralelo limitado (3 por vez pra não estourar quota)
    const sheetRows: ParsedRow[] = [];
    const tabErrors: { tab: string; error: string }[] = [];
    for (let i = 0; i < SHEET_TABS.length; i += 3) {
      const chunk = SHEET_TABS.slice(i, i + 3);
      const results = await Promise.allSettled(chunk.map((t) => fetchTab(spreadsheetId, t)));
      results.forEach((r, idx) => {
        const meta = chunk[idx];
        if (r.status === 'fulfilled') sheetRows.push(...r.value);
        else tabErrors.push({ tab: meta.tab, error: String(r.reason?.message || r.reason).slice(0, 200) });
      });
      if (i + 3 < SHEET_TABS.length) await new Promise((r) => setTimeout(r, 300));
    }

    // 3) Filtra por janela de tempo (apenas leads recentes)
    const recentRows = sheetRows.filter((r) => {
      if (!r.created_at) return false;
      const t = new Date(r.created_at).getTime();
      return !isNaN(t) && t >= sinceMs;
    });

    // Dedup interno na própria planilha (mesmo telefone aparece em várias abas)
    const seenKeys = new Set<string>();
    const uniqueRows: ParsedRow[] = [];
    for (const r of recentRows) {
      if (seenKeys.has(r.phone_key)) continue;
      seenKeys.add(r.phone_key);
      uniqueRows.push(r);
    }

    // 4) Busca leads existentes no board pra dedup contra o banco
    // (busca todos do board com lead_phone preenchido — board BPC tem ~milhares,
    //  mas pegamos só id e lead_phone, é leve)
    const { data: existing, error: existErr } = await ext
      .from('leads')
      .select('id, lead_phone')
      .eq('board_id', board_id)
      .not('lead_phone', 'is', null);
    if (existErr) return ok({ success: false, error: `dedup query: ${existErr.message}` });
    const existingKeys = new Set<string>();
    for (const l of existing || []) {
      const k = phoneKey(String(l.lead_phone || '').replace(/\D/g, ''));
      if (k) existingKeys.add(k);
    }

    // 5) Decide quem criar
    const toCreate = uniqueRows.filter((r) => !existingKeys.has(r.phone_key));

    if (dry_run) {
      return ok({
        success: true,
        dry_run: true,
        spreadsheet_id: spreadsheetId,
        since_days: sinceDays,
        total_rows_in_sheet: sheetRows.length,
        recent_rows: recentRows.length,
        unique_recent: uniqueRows.length,
        already_in_board: uniqueRows.length - toCreate.length,
        would_create: toCreate.length,
        tab_errors: tabErrors,
        sample: toCreate.slice(0, 5).map((r) => ({
          name: r.name,
          phone: r.phone,
          operator: r.operator,
          created_at: r.created_at,
        })),
      });
    }

    // 6) Garante custom fields (1x só)
    const fieldEstadoCivil = await ensureCustomField(board_id, 'estado_civil', 'Estado Civil');
    const fieldRenda = await ensureCustomField(board_id, 'renda', 'Renda Familiar');
    const fieldAcolhedor = await ensureCustomField(board_id, 'acolhedor', 'Acolhedor (Planilha)');

    // 7) Insere em lotes
    const created: string[] = [];
    const errors: { row: string; error: string }[] = [];
    const byOperator: Record<string, number> = {};

    for (const r of toCreate) {
      try {
        const { data: ins, error: insErr } = await ext
          .from('leads')
          .insert({
            lead_name: r.name,
            lead_phone: r.phone,
            board_id,
            status: initialStageId,
            source: `Planilha Meta Ads — ${r.operator || 'BPC'}`,
            notes: [
              `Importado da planilha BASE_UNIFICADA / aba ${r.tab}`,
              r.form_name && `Form: ${r.form_name}`,
              r.campaign_name && `Campanha: ${r.campaign_name}`,
              r.ad_name && `Ad: ${r.ad_name}`,
              r.form_lead_id && `form_lead_id: ${r.form_lead_id}`,
            ]
              .filter(Boolean)
              .join('\n'),
            created_at: r.created_at || new Date().toISOString(),
          })
          .select('id')
          .single();
        if (insErr) {
          errors.push({ row: `${r.name} (${r.phone})`, error: insErr.message });
          continue;
        }
        created.push(ins.id);
        byOperator[r.operator] = (byOperator[r.operator] || 0) + 1;

        // Custom field values (best-effort, sem falhar lead se der erro)
        const cfInserts: Array<{ lead_id: string; field_id: string; value_text: string }> = [];
        if (fieldEstadoCivil && r.estado_civil) cfInserts.push({ lead_id: ins.id, field_id: fieldEstadoCivil, value_text: r.estado_civil.slice(0, 500) });
        if (fieldRenda && r.renda) cfInserts.push({ lead_id: ins.id, field_id: fieldRenda, value_text: r.renda.slice(0, 500) });
        if (fieldAcolhedor && r.operator) cfInserts.push({ lead_id: ins.id, field_id: fieldAcolhedor, value_text: r.operator });
        if (cfInserts.length) {
          await ext.from('lead_custom_field_values').insert(cfInserts);
        }
      } catch (e) {
        errors.push({ row: `${r.name} (${r.phone})`, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return ok({
      success: true,
      spreadsheet_id: spreadsheetId,
      since_days: sinceDays,
      total_rows_in_sheet: sheetRows.length,
      recent_rows: recentRows.length,
      unique_recent: uniqueRows.length,
      already_in_board: uniqueRows.length - toCreate.length,
      created: created.length,
      errors_count: errors.length,
      by_operator: byOperator,
      tab_errors: tabErrors,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error('[bpc-sheet-sync] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};

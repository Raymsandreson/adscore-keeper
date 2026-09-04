// Sincroniza a planilha Google de Lead Ads de um board com o funil desse board.
// Le as abas por operador, dedup por (phone + board_id) na janela pedida, e cria
// os leads novos na primeira etapa. Idempotente — pode rodar a cada N minutos.
//
// A planilha vem de `kanban_boards.sheet_source_url`, NAO de constante. Ate
// 04/09/2026 o id ficava fixo aqui e o `board_id` recebido so escolhia onde
// gravar: chamar a funcao com o board "Acidente de Trabalho" lia a planilha do
// BPC assim mesmo e criaria centenas de leads no funil errado. Fonte e destino
// agora saem da mesma linha do banco.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { normalizaLeadIdMeta } from '../lib/leadAdsSheet';

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

async function discoverSheetTabs(
  spreadsheetId: string,
): Promise<{ lidas: { tab: string; operator: string }[]; ignoradas: string[] }> {
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
  // Aba sem palavra-chave conhecida era descartada em silencio: atendente novo na
  // planilha simplesmente nao existia para o sistema, e nada denunciava a perda.
  // Agora volta na resposta para virar decisao (cadastrar a palavra-chave) em vez
  // de sumico.
  const ignoradas: string[] = [];
  for (const title of titles) {
    if (SKIP_TABS.has(title)) continue;
    const lower = String(title).toLowerCase();
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
    else ignoradas.push(title);
  }
  return { lidas: found, ignoradas };
}

interface ParsedRow {
  facebook_lead_id: string;
  created_at: string;
  name: string;
  phone: string; // normalizado, só dígitos (com 55 quando aplicável)
  phone_key: string; // últimos 8 dígitos (chave de match)
  operator: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
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

interface AbaLida {
  tab: string;
  headers: string[];
  rows: ParsedRow[];
}

async function fetchTab(spreadsheetId: string, meta: { tab: string; operator: string }): Promise<AbaLida> {
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
  if (values.length < 2) return { tab: meta.tab, headers: [], rows: [] };
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
      facebook_lead_id: normalizaLeadIdMeta(o['id']),
      created_at: o['created_time'] || '',
      name: name.trim(),
      phone,
      phone_key: phoneKey(phone),
      operator: meta.operator,
      campaign_id: o['campaign_id'] || '',
      campaign_name: o['campaign_name'] || '',
      adset_id: o['adset_id'] || '',
      adset_name: o['adset_name'] || '',
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
  return { tab: meta.tab, headers, rows: out };
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

interface BoardConfig {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }> | null;
  sheet_source_url: string | null;
}

function extrairIdDaPlanilha(url: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

interface OpcoesSync {
  spreadsheetIdOverride?: string;
  sinceDays: number;
  dryRun: boolean;
}

async function sincronizaBoard(board: BoardConfig, opts: OpcoesSync): Promise<Record<string, unknown>> {
  const boardId = board.id;
  const falha = (error: string) => ({ success: false, board_id: boardId, board: board.name, error });

  const stages = (board.stages as Array<{ id: string; name: string }>) || [];
  if (!stages.length) return falha('board sem etapas');
  const initialStageId = stages[0].id;

  const spreadsheetId = (opts.spreadsheetIdOverride || extrairIdDaPlanilha(board.sheet_source_url) || '').trim();
  if (!spreadsheetId) {
    return falha('board sem planilha: sheet_source_url vazio ou sem id de planilha na URL');
  }
  const sinceMs = Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000;

  // 1) Descoberta dinamica das abas + leitura em paralelo limitado (3 por vez)
  let SHEET_TABS: { tab: string; operator: string }[] = [];
  let abasIgnoradas: string[] = [];
  try {
    const d = await discoverSheetTabs(spreadsheetId);
    SHEET_TABS = d.lidas;
    abasIgnoradas = d.ignoradas;
  } catch (e: any) {
    return falha(`discover tabs: ${e?.message || e}`);
  }
  const sheetRows: ParsedRow[] = [];
  const tabErrors: { tab: string; error: string }[] = [];
  const cabecalhos = new Set<string>();
  for (let i = 0; i < SHEET_TABS.length; i += 3) {
    const chunk = SHEET_TABS.slice(i, i + 3);
    const results = await Promise.allSettled(chunk.map((t) => fetchTab(spreadsheetId, t)));
    results.forEach((r, idx) => {
      const meta = chunk[idx];
      if (r.status === 'fulfilled') {
        sheetRows.push(...r.value.rows);
        r.value.headers.forEach((h) => cabecalhos.add(h));
      } else {
        tabErrors.push({ tab: meta.tab, error: String(r.reason?.message || r.reason).slice(0, 200) });
      }
    });
    if (i + 3 < SHEET_TABS.length) await new Promise((r) => setTimeout(r, 300));
  }

  // 2) Filtra por janela de tempo (apenas leads recentes)
  const recentRows = sheetRows.filter((r) => {
    if (!r.created_at) return false;
    const t = new Date(r.created_at).getTime();
    return !isNaN(t) && t >= sinceMs;
  });

  // Dedup interno na propria planilha (mesmo telefone aparece em varias abas)
  const seenKeys = new Set<string>();
  const uniqueRows: ParsedRow[] = [];
  for (const r of recentRows) {
    if (seenKeys.has(r.phone_key)) continue;
    seenKeys.add(r.phone_key);
    uniqueRows.push(r);
  }

  // 3) Busca leads existentes no board pra dedup contra o banco
  const { data: existing, error: existErr } = await ext
    .from('leads')
    .select('id, lead_phone')
    .eq('board_id', boardId)
    .not('lead_phone', 'is', null);
  if (existErr) return falha(`dedup query: ${existErr.message}`);
  const existingKeys = new Set<string>();
  for (const l of existing || []) {
    const k = phoneKey(String(l.lead_phone || '').replace(/\D/g, ''));
    if (k) existingKeys.add(k);
  }

  // 4) Decide quem criar
  const toCreate = uniqueRows.filter((r) => !existingKeys.has(r.phone_key));

  // Contagem por aba. Sem ela, "li 8 abas" e promessa sem prova: uma aba pode
  // voltar vazia (renomeada, range errado, permissao) que o total geral nao
  // denuncia. `recentes` e antes do dedup por telefone; `novos` e depois, e a
  // soma de `novos` fecha com would_create/created.
  const porAba = SHEET_TABS.map((t) => ({
    aba: t.tab,
    operador: t.operator,
    linhas: sheetRows.filter((r) => r.tab === t.tab).length,
    recentes: recentRows.filter((r) => r.tab === t.tab).length,
    novos: toCreate.filter((r) => r.tab === t.tab).length,
  }));

  const comum = {
    success: true,
    board_id: boardId,
    board: board.name,
    spreadsheet_id: spreadsheetId,
    since_days: opts.sinceDays,
    total_rows_in_sheet: sheetRows.length,
    recent_rows: recentRows.length,
    unique_recent: uniqueRows.length,
    already_in_board: uniqueRows.length - toCreate.length,
    abas_lidas: SHEET_TABS.map((t) => `${t.tab} -> ${t.operator}`),
    abas_ignoradas: abasIgnoradas,
    linhas_por_aba: porAba,
    tab_errors: tabErrors,
    // Cabecalhos vistos na planilha: e o que permite afirmar de qual coluna veio
    // cada campo, em vez de supor. Mudanca de nome de coluna pela Meta aparece
    // aqui antes de virar coluna vazia no banco.
    colunas_da_planilha: [...cabecalhos].sort(),
    com_facebook_lead_id: toCreate.filter((r) => r.facebook_lead_id).length,
  };

  if (opts.dryRun) {
    return {
      ...comum,
      dry_run: true,
      would_create: toCreate.length,
      sample: toCreate.slice(0, 5).map((r) => ({
        name: r.name,
        phone: r.phone,
        operator: r.operator,
        created_at: r.created_at,
      })),
    };
  }

  // 5) Garante custom fields (1x so)
  const fieldEstadoCivil = await ensureCustomField(boardId, 'estado_civil', 'Estado Civil');
  const fieldRenda = await ensureCustomField(boardId, 'renda', 'Renda Familiar');
  const fieldAcolhedor = await ensureCustomField(boardId, 'acolhedor', 'Acolhedor (Planilha)');

  // 6) Insere
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
          board_id: boardId,
          status: initialStageId,
          source: `Planilha Meta Ads — ${r.operator || board.name}`,
          // Atribuicao vai para as COLUNAS, nao so para o texto de `notes`.
          // Ate 04/09/2026 tudo isso era despejado em `notes` e as colunas
          // ficavam nulas: `facebook_lead_id` estava vazio em 19.420 de 19.420
          // leads. Sem esse id a Meta nao consegue casar o fechamento com o lead
          // do formulario, que e o que destrava otimizar por lead qualificado.
          // Campo ausente na planilha fica NULL em vez de string vazia, senao
          // "tem valor" e "e vazio" viram a mesma coisa na hora de medir.
          facebook_lead_id: r.facebook_lead_id || null,
          campaign_id: r.campaign_id || null,
          campaign_name: r.campaign_name || null,
          adset_id: r.adset_id || null,
          adset_name: r.adset_name || null,
          ad_name: r.ad_name || null,
          notes: [
            `Importado da planilha do board — aba ${r.tab}`,
            r.form_name && `Form: ${r.form_name}`,
            r.campaign_name && `Campanha: ${r.campaign_name}`,
            r.ad_name && `Ad: ${r.ad_name}`,
            r.facebook_lead_id && `facebook_lead_id: ${r.facebook_lead_id}`,
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

  return {
    ...comum,
    created: created.length,
    errors_count: errors.length,
    by_operator: byOperator,
    errors: errors.slice(0, 20),
  };
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

    const sinceDays = Math.max(1, Math.min(365, Number(since_days) || 7));
    const dryRun = !!dry_run;
    const COLUNAS = 'id, name, stages, sheet_source_url';

    // Um board: o formato da resposta e o de sempre, pra nao quebrar quem ja chama.
    if (board_id) {
      const { data, error } = await ext.from('kanban_boards').select(COLUNAS).eq('id', board_id).maybeSingle();
      if (error) return ok({ success: false, error: `board: ${error.message}` });
      if (!data) return ok({ success: false, error: 'board nao encontrado' });
      const r = await sincronizaBoard(data as unknown as BoardConfig, {
        spreadsheetIdOverride: spreadsheet_id,
        sinceDays,
        dryRun,
      });
      return ok(r);
    }

    // Sem board: varre todo board com a planilha ligada. E assim que o cron chama.
    if (spreadsheet_id) {
      return ok({
        success: false,
        error: 'spreadsheet_id so vale junto com board_id — na varredura cada board usa a planilha dele',
      });
    }
    const { data, error } = await ext.from('kanban_boards').select(COLUNAS).eq('sheet_enabled', true);
    if (error) return ok({ success: false, error: `boards: ${error.message}` });
    const boards = (data || []) as unknown as BoardConfig[];

    const resultados: Record<string, unknown>[] = [];
    for (const b of boards) {
      resultados.push(await sincronizaBoard(b, { sinceDays, dryRun }));
      // A API do Sheets tem cota por minuto e ja devolveu 429 numa leitura
      // dupla: espacar os boards custa segundos e evita perder a varredura.
      if (boards.indexOf(b) < boards.length - 1) await new Promise((r) => setTimeout(r, 5000));
    }
    return ok({
      success: true,
      dry_run: dryRun,
      boards_com_planilha: boards.length,
      criados: resultados.reduce((n, r) => n + (Number(r.created) || 0), 0),
      resultados,
    });
  } catch (err) {
    console.error('[bpc-sheet-sync] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};

// Sincroniza a coluna "status" da planilha do Meta Ads → CRM (leads no Externo),
// importa fechamentos que ainda não estão no CRM, e dispara a conversão (Meta CAPI
// Purchase) server-side. Piloto: Auxílio Acidente.
//
// REGRAS:
// - "planilha ganha": um desfecho na planilha sobrescreve o lead_status do CRM.
// - Desfechos mapeados: fechado→closed, inviável→inviavel, cancelado/nº errado→cancelled,
//   sem resposta→no_response. Etapas em trabalho NÃO viram lead_status.
// - Importa órfão SÓ quando o status é "Fechado" (ganho) — não polui o CRM com negativos.
// - Purchase dispara no máximo 1x por lead (carimbo leads.capi_purchase_sent_at) → idempotente
//   e permite retry. Mudar status vai-e-volta na planilha NÃO re-cobra o Meta.
// - Match por telefone TOLERANTE ao 9 do celular: chave = DDD + últimos 8 dígitos.
//
// dry_run = true (PADRÃO): não escreve/importa/dispara nada; só devolve o plano.
// { dry_run: false } executa. { fire_conversions: false } executa import+status sem Purchase.
import type { RequestHandler } from 'express';
import { supabase as ext, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../lib/supabase';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const AUX_ACIDENTE_BOARD_ID = '7db8f799-3b18-4a89-a4c3-03ed244d0e39';
const AUX_ACIDENTE_SPREADSHEET_ID = '1C8zhfLEYzBN9JTDKN2HHs2m5UJGMSqSAGAGpWtAEBAQ';

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

// --- Normalização de status (porta do src/lib/sheetStatusStages.ts) ---
const STATUS_ALIASES: Record<string, string> = {
  errado: 'n errado',
  'numero errado': 'n errado',
  'aguar doc': 'aguar. doc',
  'aguardando doc': 'aguar. doc',
};
function sheetStatusKey(raw: string | undefined | null): string {
  const s = (raw || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return 'sem status';
  return STATUS_ALIASES[s] || s;
}
const TERMINAL_MAP: Record<string, string> = {
  fechado: 'closed',
  inviavel: 'inviavel',
  cancelado: 'cancelled',
  'n errado': 'cancelled',
  'sem resposta': 'no_response',
};
function mapToLeadStatus(raw: string): string | null {
  return TERMINAL_MAP[sheetStatusKey(raw)] ?? null;
}
const STATUS_STRENGTH: Record<string, number> = { closed: 4, inviavel: 3, cancelled: 3, no_response: 1 };

function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = String(raw).replace(/^p:/i, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}
// Chave de match tolerante ao 9 do celular: DDD (2) + últimos 8 dígitos.
// Reduz colisão vs "últimos 8 crus" (inclui o DDD) e casa telefone com/sem o 9.
function matchKey(raw: string): string {
  let d = String(raw || '').replace(/^p:/i, '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return '';
  return d.slice(0, 2) + d.slice(-8);
}

interface SheetRow {
  name: string;
  phone: string;
  match_key: string;
  sheet_status: string;
  mapped: string;
  created_at: string;
  operator: string;
  tab: string;
}

async function discoverSheetTabs(spreadsheetId: string): Promise<{ tab: string; operator: string }[]> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey || !gsKey) throw new Error('Missing connector keys (LOVABLE_API_KEY / GOOGLE_SHEETS_API_KEY)');
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
    // A planilha do Aux Acidente COMPARTILHA abas BPC (ex: "BPC - ISRAEL").
    // Essas são de OUTRO funil — nunca ler no sync do Aux Acidente.
    if (lower.includes('bpc')) continue;
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
  }
  return found;
}

function rowToObj(headers: string[], r: any[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => { o[h] = String(r[i] ?? '').trim(); });
  return o;
}

async function fetchTab(spreadsheetId: string, meta: { tab: string; operator: string }): Promise<SheetRow[]> {
  const lovableKey = process.env.LOVABLE_API_KEY || '';
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY || '';
  const url = `${GATEWAY}/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(meta.tab)}'!A1:Z5000`;
  // Retry em 429 (cota do Sheets por minuto) com backoff — o cron não pode
  // perder aba por pico momentâneo de leitura.
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': gsKey } });
    if (resp.status !== 429) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (!resp || !resp.ok) throw new Error(`sheet "${meta.tab}" ${resp?.status}: ${(await resp?.text())?.slice(0, 200)}`);
  const json = (await resp.json()) as { values?: any[][] };
  const values: any[][] = json.values || [];
  if (values.length < 2) return [];
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

  const out: SheetRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || !r.length) continue;
    const o = rowToObj(headers, r);
    const rawPhone =
      o['telefone'] || o['phone_number'] || o['número_do_whatsapp'] ||
      o['qual_o_seu_número_de_contato_?'] || o['qual_o_seu_número_para_contato_?'] ||
      o['qual_seu_número_para_contato_?'] || '';
    const phone = normalizePhone(rawPhone);
    const key = matchKey(rawPhone);
    if (!key) continue;
    const mapped = mapToLeadStatus(o['status'] || '');
    if (!mapped) continue; // só desfechos terminais
    out.push({
      name: (o['nome_completo'] || o['full_name'] || '').trim(),
      phone,
      match_key: key,
      sheet_status: o['status'] || '',
      mapped,
      created_at: o['created_time'] || '',
      operator: meta.operator,
      tab: meta.tab,
    });
  }
  return out;
}

// Dispara Purchase na edge facebook-capi (Externo). Idempotente via event_id.
async function firePurchase(lead: { id: string; email?: string | null; phone?: string | null; value: number }) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/facebook-capi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        events: [{
          event_name: 'Purchase',
          event_id: `${lead.id}:Purchase`,
          action_source: 'system_generated',
          user_data: { em: lead.email || undefined, ph: lead.phone || undefined },
          custom_data: { currency: 'BRL', value: lead.value || 0 },
        }],
      }),
    });
    const j: any = await resp.json().catch(() => ({}));
    if (resp.ok && j?.success) return { ok: true, received: j.events_received as number };
    return { ok: false, error: JSON.stringify(j).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { board_id, spreadsheet_id, dry_run, fire_conversions, user_id } =
      (req.body || {}) as {
        board_id?: string; spreadsheet_id?: string; dry_run?: boolean;
        fire_conversions?: boolean; user_id?: string;
      };
    const isDryRun = dry_run !== false;
    const doFire = fire_conversions !== false;
    const boardId = (board_id || AUX_ACIDENTE_BOARD_ID).trim();
    const spreadsheetId = (spreadsheet_id || AUX_ACIDENTE_SPREADSHEET_ID).trim();

    // 1) Board + primeira etapa (pra importar órfãos)
    const { data: board, error: boardErr } = await ext
      .from('kanban_boards').select('id, name, stages').eq('id', boardId).maybeSingle();
    if (boardErr) return ok({ success: false, error: `board: ${boardErr.message}` });
    if (!board) return ok({ success: false, error: 'board não encontrado' });
    const stages = (board.stages as Array<{ id: string; name: string }>) || [];
    const initialStageId = stages[0]?.id || null;

    // 2) Lê abas → linhas com desfecho
    let tabs: { tab: string; operator: string }[] = [];
    try { tabs = await discoverSheetTabs(spreadsheetId); }
    catch (e: any) { return ok({ success: false, error: `discover tabs: ${e?.message || e}` }); }
    const rows: SheetRow[] = [];
    const tabErrors: { tab: string; error: string }[] = [];
    for (let i = 0; i < tabs.length; i += 3) {
      const chunk = tabs.slice(i, i + 3);
      const results = await Promise.allSettled(chunk.map((t) => fetchTab(spreadsheetId, t)));
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') rows.push(...r.value);
        else tabErrors.push({ tab: chunk[idx].tab, error: String(r.reason?.message || r.reason).slice(0, 200) });
      });
      if (i + 3 < tabs.length) await new Promise((r) => setTimeout(r, 300));
    }

    // 3) Dedup por telefone: mantém o desfecho MAIS FORTE
    const bestByKey = new Map<string, SheetRow>();
    for (const r of rows) {
      const cur = bestByKey.get(r.match_key);
      if (!cur || (STATUS_STRENGTH[r.mapped] || 0) > (STATUS_STRENGTH[cur.mapped] || 0)) bestByKey.set(r.match_key, r);
    }

    // 4) Leads existentes do board
    const { data: existing, error: existErr } = await ext
      .from('leads')
      .select('id, lead_name, lead_phone, lead_email, lead_status, conversion_value, capi_purchase_sent_at')
      .eq('board_id', boardId).not('lead_phone', 'is', null);
    if (existErr) return ok({ success: false, error: `leads query: ${existErr.message}` });
    const leadByKey = new Map<string, any>();
    for (const l of existing || []) {
      const k = matchKey(String(l.lead_phone || ''));
      if (k && !leadByKey.has(k)) leadByKey.set(k, l);
    }

    // 5) Classifica
    const changes: any[] = [];       // matched com status diferente → update
    const importClosed: SheetRow[] = []; // órfão "Fechado" → criar lead
    const orphansSkipped: SheetRow[] = []; // órfão negativo → ignora
    const convFromMatched: any[] = []; // matched que vira/está closed e sem carimbo → Purchase
    for (const [key, r] of bestByKey) {
      const lead = leadByKey.get(key);
      if (!lead) {
        if (r.mapped === 'closed') importClosed.push(r); else orphansSkipped.push(r);
        continue;
      }
      if ((lead.lead_status ?? null) !== r.mapped) {
        changes.push({ lead_id: lead.id, crm_name: lead.lead_name || '', sheet_name: r.name || '',
          sheet_status: r.sheet_status, phone: r.phone, from: lead.lead_status ?? null, to: r.mapped });
      }
      if (r.mapped === 'closed' && !lead.capi_purchase_sent_at) {
        convFromMatched.push({ id: lead.id, name: lead.lead_name || r.name, phone: lead.lead_phone || r.phone,
          email: lead.lead_email, value: Number(lead.conversion_value) || 0 });
      }
    }
    // Conjunto de conversões = matched(closed, sem carimbo) + órfãos importados (closed)
    const conversionSet = [
      ...convFromMatched.map((c) => ({ ...c, source: 'matched' })),
      ...importClosed.map((r) => ({ id: null as string | null, name: r.name, phone: r.phone,
        email: null, value: 0, source: 'import', created_at: r.created_at })),
    ];

    if (isDryRun) {
      return ok({
        success: true, dry_run: true, board: board.name, board_id: boardId,
        sheet_terminal_rows: rows.length, unique_phones_with_outcome: bestByKey.size,
        matched_leads: bestByKey.size - importClosed.length - orphansSkipped.length,
        would_change_status: changes.length,
        would_import_closed: importClosed.length,
        orphans_negativos_ignorados: orphansSkipped.length,
        would_fire_purchase: conversionSet.length,
        conversions_matched: convFromMatched.length,
        conversions_from_import: importClosed.length,
        tab_errors: tabErrors,
        sample_status_changes: changes.slice(0, 50),
        sample_import_closed: importClosed.slice(0, 50).map((r) => ({
          name: r.name, phone: r.phone, sheet_status: r.sheet_status, created_at: r.created_at, operator: r.operator })),
      });
    }

    // ===== ESCRITA REAL =====
    const now = new Date().toISOString();
    let importedCount = 0; const importErrors: any[] = [];
    // 6a) Importa órfãos "Fechado" como lead closed
    for (const r of importClosed) {
      const { data: ins, error: insErr } = await ext.from('leads').insert({
        lead_name: r.name || `Lead ${r.phone}`, lead_phone: r.phone, board_id: boardId,
        status: initialStageId, lead_status: 'closed', became_client_date: (r.created_at || now).slice(0, 10),
        source: `Planilha Meta Ads — ${r.operator || 'Aux Acidente'}`,
        created_at: r.created_at || now,
      }).select('id, lead_phone, lead_email').single();
      if (insErr) { importErrors.push({ phone: r.phone, error: insErr.message }); continue; }
      importedCount++;
      // adiciona à fila de conversão (novo lead, sem carimbo)
      convFromMatched.push({ id: ins.id, name: r.name, phone: ins.lead_phone || r.phone, email: ins.lead_email, value: 0 });
    }

    // 6b) Atualiza status dos matched (planilha ganha) + log
    let updatedCount = 0; const updateErrors: any[] = [];
    for (const c of changes) {
      const { error: upErr } = await ext.from('leads').update({ lead_status: c.to }).eq('id', c.lead_id);
      if (upErr) { updateErrors.push({ lead_id: c.lead_id, error: upErr.message }); continue; }
      updatedCount++;
      await ext.rpc('log_lead_result_change', {
        p_user_id: user_id || null, p_lead_id: c.lead_id, p_from: c.from, p_to: c.to,
        p_reason: 'sync planilha (funil)',
      } as any);
    }

    // 6c) Dispara Purchase (idempotente por carimbo) — matched closed + importados
    let firedCount = 0, receivedCount = 0; const fireErrors: any[] = [];
    if (doFire) {
      for (const c of convFromMatched) {
        const r = await firePurchase(c);
        if (!r.ok) { fireErrors.push({ lead_id: c.id, error: r.error }); continue; }
        firedCount++; receivedCount += r.received || 0;
        await ext.from('leads').update({ capi_purchase_sent_at: now }).eq('id', c.id);
      }
    }

    return ok({
      success: true, dry_run: false, board: board.name,
      imported_closed: importedCount, import_errors: importErrors.slice(0, 20),
      status_updated: updatedCount, update_errors: updateErrors.slice(0, 20),
      purchases_fired: firedCount, events_received: receivedCount, fire_errors: fireErrors.slice(0, 20),
      tab_errors: tabErrors,
    });
  } catch (err) {
    console.error('[sync-funnel-status-from-sheet] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};

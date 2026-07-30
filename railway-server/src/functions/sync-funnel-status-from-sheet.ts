// Sincroniza o STATUS (desfecho) que os operadores digitam na coluna "status"
// da planilha do Meta Ads → coluna leads.lead_status no CRM (Externo).
//
// FASE 1 (este arquivo): só ESCREVE os DESFECHOS terminais (fechado/inviável/
// cancelado/nº errado). Etapas em trabalho (primeiro contato, follow up, aguar. doc,
// em andamento) NÃO viram lead_status — o funil já as mostra pelo caminho de leitura.
// NÃO dispara conversão nenhuma (isso é a Fase 2).
//
// Regra de conflito: "planilha ganha" — um desfecho na planilha sobrescreve o
// lead_status atual do CRM. Match por telefone (últimos 8 dígitos), igual ao
// bpc-sheet-sync. Idempotente: se lead já está no status-alvo, não faz nada.
//
// dry_run = true (PADRÃO): não escreve nada, só devolve o que MUDARIA + órfãos.
// Passe { dry_run: false } explicitamente para gravar.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// Piloto: Auxílio Acidente. Board operacional (87 leads) + planilha vinculada.
const AUX_ACIDENTE_BOARD_ID = '7db8f799-3b18-4a89-a4c3-03ed244d0e39';
const AUX_ACIDENTE_SPREADSHEET_ID = '1C8zhfLEYzBN9JTDKN2HHs2m5UJGMSqSAGAGpWtAEBAQ';

// Descoberta de aba por operador (mesmo mapa do bpc-sheet-sync).
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

// --- Normalização de status da planilha (porta do src/lib/sheetStatusStages.ts) ---
const STATUS_ALIASES: Record<string, string> = {
  errado: 'n errado',
  'numero errado': 'n errado',
  'aguar doc': 'aguar. doc',
  'aguardando doc': 'aguar. doc',
};
function sheetStatusKey(raw: string | undefined | null): string {
  const s = (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'sem status';
  return STATUS_ALIASES[s] || s;
}

// Mapa canônico: status da planilha → lead_status do CRM.
// null = NÃO escreve (etapa em trabalho / status desconhecido / sem status).
const TERMINAL_MAP: Record<string, string> = {
  fechado: 'closed',
  inviavel: 'inviavel',
  cancelado: 'cancelled',
  'n errado': 'cancelled',
  'sem resposta': 'no_response',
};
function mapToLeadStatus(sheetStatusRaw: string): string | null {
  return TERMINAL_MAP[sheetStatusKey(sheetStatusRaw)] ?? null;
}
// Força de um desfecho p/ desempate quando o mesmo telefone tem status em várias abas.
// closed é o mais forte (conversão); depois os negativos; no_response é o mais fraco.
const STATUS_STRENGTH: Record<string, number> = {
  closed: 4,
  inviavel: 3,
  cancelled: 3,
  no_response: 1,
};

function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = String(raw).replace(/^p:/i, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}
function phoneKey(digits: string): string {
  return digits.slice(-8);
}

interface SheetStatusRow {
  name: string;
  phone: string;
  phone_key: string;
  sheet_status: string;
  mapped: string; // lead_status alvo (terminal)
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
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
  }
  return found;
}

function rowToObj(headers: string[], r: any[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = String(r[i] ?? '').trim();
  });
  return o;
}

async function fetchTab(spreadsheetId: string, meta: { tab: string; operator: string }): Promise<SheetStatusRow[]> {
  const lovableKey = process.env.LOVABLE_API_KEY || '';
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY || '';
  const url = `${GATEWAY}/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(meta.tab)}'!A1:Z5000`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': gsKey },
  });
  if (!resp.ok) throw new Error(`sheet "${meta.tab}" ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = (await resp.json()) as { values?: any[][] };
  const values: any[][] = json.values || [];
  if (values.length < 2) return [];
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

  const out: SheetStatusRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || !r.length) continue;
    const o = rowToObj(headers, r);
    const rawPhone =
      o['telefone'] || o['phone_number'] || o['número_do_whatsapp'] ||
      o['qual_o_seu_número_de_contato_?'] || o['qual_o_seu_número_para_contato_?'] ||
      o['qual_seu_número_para_contato_?'] || '';
    const phone = normalizePhone(rawPhone);
    if (phone.length < 10) continue;
    const sheetStatus = o['status'] || '';
    const mapped = mapToLeadStatus(sheetStatus);
    if (!mapped) continue; // só nos interessam desfechos terminais na Fase 1
    out.push({
      name: (o['nome_completo'] || o['full_name'] || '').trim(),
      phone,
      phone_key: phoneKey(phone),
      sheet_status: sheetStatus,
      mapped,
      operator: meta.operator,
      tab: meta.tab,
    });
  }
  return out;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const {
      board_id,
      spreadsheet_id,
      dry_run,
      user_id,
    } = (req.body || {}) as {
      board_id?: string;
      spreadsheet_id?: string;
      dry_run?: boolean;
      user_id?: string;
    };

    // dry_run é o PADRÃO seguro: só grava se vier explicitamente false.
    const isDryRun = dry_run !== false;
    const boardId = (board_id || AUX_ACIDENTE_BOARD_ID).trim();
    const spreadsheetId = (spreadsheet_id || AUX_ACIDENTE_SPREADSHEET_ID).trim();

    // 1) Valida board
    const { data: board, error: boardErr } = await ext
      .from('kanban_boards')
      .select('id, name')
      .eq('id', boardId)
      .maybeSingle();
    if (boardErr) return ok({ success: false, error: `board: ${boardErr.message}` });
    if (!board) return ok({ success: false, error: 'board não encontrado' });

    // 2) Lê abas da planilha (só linhas com desfecho terminal na coluna status)
    let tabs: { tab: string; operator: string }[] = [];
    try {
      tabs = await discoverSheetTabs(spreadsheetId);
    } catch (e: any) {
      return ok({ success: false, error: `discover tabs: ${e?.message || e}` });
    }
    const rows: SheetStatusRow[] = [];
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

    // 3) Dedup por telefone: se o mesmo número tem desfecho em várias abas,
    //    mantém o MAIS FORTE (closed > negativos > no_response).
    const bestByKey = new Map<string, SheetStatusRow>();
    for (const r of rows) {
      const cur = bestByKey.get(r.phone_key);
      if (!cur || (STATUS_STRENGTH[r.mapped] || 0) > (STATUS_STRENGTH[cur.mapped] || 0)) {
        bestByKey.set(r.phone_key, r);
      }
    }

    // 4) Leads existentes do board (id, phone, status atual)
    const { data: existing, error: existErr } = await ext
      .from('leads')
      .select('id, lead_name, lead_phone, lead_status')
      .eq('board_id', boardId)
      .not('lead_phone', 'is', null);
    if (existErr) return ok({ success: false, error: `leads query: ${existErr.message}` });
    const leadByKey = new Map<string, { id: string; name: string; status: string | null }>();
    for (const l of existing || []) {
      const k = phoneKey(String(l.lead_phone || '').replace(/\D/g, ''));
      if (k.length === 8 && !leadByKey.has(k)) {
        leadByKey.set(k, { id: l.id, name: l.lead_name || '', status: l.lead_status ?? null });
      }
    }

    // 5) Decide mudanças + órfãos
    const changes: { lead_id: string; name: string; phone: string; from: string | null; to: string }[] = [];
    const orphans: { name: string; phone: string; sheet_status: string; mapped: string; operator: string }[] = [];
    for (const [key, r] of bestByKey) {
      const lead = leadByKey.get(key);
      if (!lead) {
        orphans.push({ name: r.name, phone: r.phone, sheet_status: r.sheet_status, mapped: r.mapped, operator: r.operator });
        continue;
      }
      if ((lead.status ?? null) === r.mapped) continue; // já está no alvo → nada a fazer
      changes.push({ lead_id: lead.id, name: lead.name || r.name, phone: r.phone, from: lead.status ?? null, to: r.mapped });
    }

    // Distribuição de→para (pra leitura humana no dry-run)
    const transitions: Record<string, number> = {};
    for (const c of changes) {
      const k = `${c.from ?? '∅'} → ${c.to}`;
      transitions[k] = (transitions[k] || 0) + 1;
    }
    // Órfãos que são "fechado" = conversão que se perderia (lead não existe no CRM)
    const orphansClosed = orphans.filter((o) => o.mapped === 'closed');

    if (isDryRun) {
      return ok({
        success: true,
        dry_run: true,
        board: board.name,
        board_id: boardId,
        spreadsheet_id: spreadsheetId,
        sheet_terminal_rows: rows.length,
        unique_phones_with_outcome: bestByKey.size,
        matched_leads: bestByKey.size - orphans.length,
        would_change: changes.length,
        transitions,
        orphans_total: orphans.length,
        orphans_closed: orphansClosed.length,
        tab_errors: tabErrors,
        sample_changes: changes.slice(0, 10),
        sample_orphans_closed: orphansClosed.slice(0, 10),
      });
    }

    // 6) ESCRITA REAL (só com dry_run:false). Atualiza lead_status + loga a mudança.
    let updated = 0;
    const errors: { lead_id: string; error: string }[] = [];
    for (const c of changes) {
      const { error: upErr } = await ext
        .from('leads')
        .update({ lead_status: c.to })
        .eq('id', c.lead_id);
      if (upErr) {
        errors.push({ lead_id: c.lead_id, error: upErr.message });
        continue;
      }
      updated++;
      // Log de auditoria (origem = planilha). Best-effort, não falha o sync.
      await ext.rpc('log_lead_result_change', {
        p_user_id: user_id || null,
        p_lead_id: c.lead_id,
        p_from: c.from,
        p_to: c.to,
        p_reason: 'sync planilha (funil)',
      } as any);
    }

    return ok({
      success: true,
      dry_run: false,
      board: board.name,
      board_id: boardId,
      would_change: changes.length,
      updated,
      errors_count: errors.length,
      transitions,
      orphans_total: orphans.length,
      orphans_closed: orphansClosed.length,
      tab_errors: tabErrors,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error('[sync-funnel-status-from-sheet] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};

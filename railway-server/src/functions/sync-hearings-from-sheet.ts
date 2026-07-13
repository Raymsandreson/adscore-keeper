// Sincroniza a tabela `hearings` (Supabase Externo) com a planilha de audiências
// do escritório (aba fixa, gid 1517179812). Lê via gateway Lovable (mesmas
// credenciais do bpc-sheet-sync). Nunca deleta: insere novas, atualiza campos
// divergentes e reporta as que existem no banco mas sumiram da planilha.
//
// Modos:
//   {}                          → dry_run: estrutura da aba + parse + diff, sem escrever
//   { apply: true, confirm: 'SYNC' } → executa insert/update
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const SPREADSHEET_ID = '1ZOCeDda-qhGAGcKQxp8B3wyOlhXYhBKE0_MZN0ffjik';
const TARGET_GID = 1517179812;
const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

function gatewayHeaders(): Record<string, string> {
  const lovableKey = process.env.LOVABLE_API_KEY || '';
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY || '';
  if (!lovableKey) throw new Error('Missing LOVABLE_API_KEY');
  // Sem GOOGLE_SHEETS_API_KEY tenta só com o bearer — o gateway pode resolver a
  // conexão única de Sheets do projeto; se não, o erro dele diz o que falta.
  const headers: Record<string, string> = { Authorization: `Bearer ${lovableKey}` };
  if (gsKey) headers['X-Connection-Api-Key'] = gsKey;
  return headers;
}

async function resolveTabTitle(): Promise<{ title: string; tabs: { title: string; gid: number }[] }> {
  const resp = await fetch(
    `${GATEWAY}/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: gatewayHeaders() },
  );
  if (!resp.ok) throw new Error(`metadata ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json: any = await resp.json();
  const props = (json.sheets || []).map((s: any) => s.properties).filter(Boolean);
  const tabs = props.map((p: any) => ({ title: p.title, gid: p.sheetId }));
  const target = props.find((p: any) => p.sheetId === TARGET_GID);
  if (!target) throw new Error(`Aba gid ${TARGET_GID} não encontrada. Abas: ${tabs.map((t: any) => t.title).join(', ')}`);
  return { title: target.title, tabs };
}

async function fetchRows(tabTitle: string): Promise<string[][]> {
  const resp = await fetch(
    `${GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(tabTitle)}'!A1:Z2000`,
    { headers: gatewayHeaders() },
  );
  if (!resp.ok) throw new Error(`values ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = (await resp.json()) as { values?: any[][] };
  return (json.values || []).map((r) => r.map((c) => String(c ?? '').trim()));
}

// ---------------------------------------------------------------------------
// Parse heurístico — a planilha pode ter colunas explícitas (DATA/PROCESSO/...)
// ou linhas de texto livre no formato do import de jun/2026
// ("0000155-13.2025.5.08.0120 - CASO 237 - INSTRUÇÃO VIRTUAL - 09H").
// ---------------------------------------------------------------------------

const PROCESS_RE = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/;
const PROCESS_RE_G = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;
const CASE_RE = /\b(CASO|PREV|CÍVEL|CIVEL|CRIM)\s*\.?\s*(\d+(?:\.\d+)?)/i;
// (?!\d) em vez de \b no fim: "09:40h" tem \w dos dois lados do "h", o \b falharia
// e o backtrack capturaria só "09:" → 09:00. Só não pode seguir dígito.
const TIME_RE = /\b(\d{1,2})[:hH](\d{2})?(?!\d)/;
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const CONTROL_RE = /^(SEMANA\s*\d|RECESSO|SUSPENS|FERIADO|LEGENDA|DATA:?$|SEGUNDA|TERÇA|TERCA|QUARTA|QUINTA|SEXTA|SÁBADO|SABADO|DOMINGO)/i;
const MONTH_HEADER_RE = /AUDI[EÊ]NCIAS\s+([A-ZÇ]+)\s*\/?\s*(\d{2,4})?/i;
const MONTHS: Record<string, number> = {
  JANEIRO: 1, FEVEREIRO: 2, MARÇO: 3, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
  JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
};

interface ParsedHearing {
  process_number: string | null;
  hearing_date: string; // YYYY-MM-DD
  hearing_time: string | null;
  case_ref: string | null;
  hearing_type: string | null;
  category: string;
  location: string | null;
  status: string;
  raw: string;
  row_index: number;
}

function inferCategory(processNumber: string): string {
  // Segmento J do CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
  const m = processNumber.match(/\.(\d)\.\d{2}\./);
  if (!m) return 'outro';
  if (m[1] === '5') return 'trabalhista';
  if (m[1] === '4') return 'previdenciario';
  if (m[1] === '8') return 'civel';
  return 'outro';
}

function inferStatus(text: string): string {
  const t = text.toUpperCase();
  if (t.includes('CANCELAD')) return 'cancelada';
  if (t.includes('ADIAD') || t.includes('REDESIGNAD') || t.includes('REMARCAD')) return 'adiada';
  if (t.includes('REALIZAD') || t.includes('CONCLUÍD') || t.includes('CONCLUID')) return 'concluida';
  return 'ativa';
}

function inferType(text: string): string | null {
  const t = text.toUpperCase();
  if (t.includes('ENCERRAMENTO')) return 'Encerramento de Instrução';
  if (/\bUNA\b/.test(t)) return 'UNA';
  if (t.includes('INSTRU')) return 'Instrução';
  if (t.includes('INICIAL') || t.includes('INCIAL')) return 'Inicial';
  if (t.includes('PERÍCIA') || t.includes('PERICIA')) return 'Perícia Médica';
  if (t.includes('JULGAMENTO')) return 'Julgamento';
  if (t.includes('CONCILIA')) return 'Conciliação';
  return null;
}

function inferLocation(text: string): string | null {
  const t = text.toUpperCase();
  if (t.includes('VIRTUAL') || t.includes('VIDEOCONFER') || t.includes('ONLINE')) return 'Virtual';
  if (t.includes('PRESENCIAL')) return 'Presencial';
  return null;
}

function parseDate(raw: string, yearCtx: number): string | null {
  const m = raw.match(DATE_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = m[3] ? parseInt(m[3], 10) : yearCtx;
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTime(raw: string): string | null {
  const m = raw.match(TIME_RE);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (h > 23) return null;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

/** Extrai uma audiência de um trecho de texto de célula (uma célula = um dia). */
function parseCellSegment(seg: string, date: string, rowIndex: number): ParsedHearing | null {
  const procMatch = seg.match(PROCESS_RE);
  const caseMatch = seg.match(CASE_RE);
  if (!procMatch && !caseMatch) return null;
  const processNumber = procMatch ? procMatch[0] : null;
  return {
    process_number: processNumber,
    hearing_date: date,
    hearing_time: parseTime(seg.replace(PROCESS_RE_G, '')),
    case_ref: caseMatch ? `${caseMatch[1].toUpperCase()} ${caseMatch[2]}` : null,
    hearing_type: inferType(seg),
    category: processNumber ? inferCategory(processNumber) : 'outro',
    location: inferLocation(seg),
    status: inferStatus(seg),
    raw: seg.replace(/\s+/g, ' ').trim().slice(0, 300),
    row_index: rowIndex,
  };
}

/**
 * Parser da GRADE de calendário da planilha:
 * - "AUDIÊNCIAS <MÊS>/<AA>" define o ano corrente.
 * - Linha "DATA:" tem os dias da semana em colunas; a linha SEGUINTE tem dd/mm
 *   nas mesmas colunas → mapa coluna→data, válido até o próximo bloco.
 * - Abaixo, cada célula numa coluna datada é uma audiência daquele dia
 *   (células podem ter 2+ processos → viram registros separados).
 * - Células sem processo e sem "CASO n" viram `skipped` (a menos que sejam
 *   texto de controle: SEMANA/RECESSO/SUSPENSÃO/etc).
 */
function parseSheet(rows: string[][], defaultYear: number): { parsed: ParsedHearing[]; skipped: { row_index: number; reason: string; raw: string }[] } {
  const parsed: ParsedHearing[] = [];
  const skipped: { row_index: number; reason: string; raw: string }[] = [];
  let yearCtx = defaultYear;
  let colDates = new Map<number, string>();
  let dateRowIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    if (i === dateRowIdx) continue; // linha dd/mm já consumida pelo bloco DATA:
    const cells = rows[i];
    if (!cells || cells.every((c) => !c)) continue;

    const joined = cells.filter(Boolean).join(' ');
    const mh = joined.toUpperCase().match(MONTH_HEADER_RE);
    if (mh && MONTHS[mh[1]]) {
      if (mh[2]) yearCtx = mh[2].length === 2 ? 2000 + parseInt(mh[2], 10) : parseInt(mh[2], 10);
      continue;
    }

    if (cells.some((c) => /^DATA:?\s*$/i.test(c))) {
      colDates = new Map();
      dateRowIdx = i + 1;
      const dateRow = rows[i + 1] || [];
      const maxCols = Math.max(cells.length, dateRow.length);
      for (let c = 0; c < maxCols; c++) {
        // dd/mm normalmente na linha de baixo; às vezes embutido na própria célula do dia
        const d = parseDate(dateRow[c] || '', yearCtx) || parseDate(cells[c] || '', yearCtx);
        if (d) colDates.set(c, d);
        else if ((dateRow[c] || '').trim() && !CONTROL_RE.test(dateRow[c]) && /\d/.test(dateRow[c])) {
          skipped.push({ row_index: i + 2, reason: `data ilegível na coluna ${c}`, raw: dateRow[c].slice(0, 60) });
        }
      }
      continue;
    }

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      if (!cell) continue;
      const date = colDates.get(c);
      if (!date) {
        // Coluna sem data (legenda, rótulos) — só reporta se parecer audiência perdida
        if (PROCESS_RE.test(cell)) {
          skipped.push({ row_index: i + 1, reason: `processo em coluna ${c} sem data mapeada`, raw: cell.replace(/\s+/g, ' ').slice(0, 120) });
        }
        continue;
      }
      if (CONTROL_RE.test(cell.trim())) continue;

      // Célula com 2+ processos = audiências distintas: segmenta a partir de cada processo
      const matches = [...cell.matchAll(PROCESS_RE_G)];
      const segments: string[] = [];
      if (matches.length > 1) {
        for (let m = 0; m < matches.length; m++) {
          const start = m === 0 ? 0 : matches[m].index!;
          const end = m + 1 < matches.length ? matches[m + 1].index! : cell.length;
          segments.push(cell.slice(start, end));
        }
      } else {
        segments.push(cell);
      }

      for (const seg of segments) {
        const h = parseCellSegment(seg, date, i + 1);
        if (h) parsed.push(h);
        else skipped.push({ row_index: i + 1, reason: 'sem processo nem CASO', raw: seg.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }
  }
  return { parsed, skipped };
}

// ---------------------------------------------------------------------------

interface DbHearing {
  id: string;
  process_number: string | null;
  case_ref: string | null;
  hearing_type: string | null;
  category: string;
  hearing_date: string;
  hearing_time: string | null;
  status: string;
  location: string | null;
}

// Chave de match: nº do processo (só dígitos) ou, sem processo, o "CASO n" — sempre + data
const keyOf = (proc: string | null, caseRef: string | null, d: string): string | null => {
  if (proc) return `${proc.replace(/\D/g, '')}|${d}`;
  if (caseRef) return `c:${caseRef.toUpperCase().replace(/\s+/g, '')}|${d}`;
  return null;
};

export const handler: RequestHandler = async (req, res) => {
  try {
    const apply = req.body?.apply === true;
    if (apply && req.body?.confirm !== 'SYNC') {
      return res.status(400).json({ ok: false, error: "apply exige confirm: 'SYNC'" });
    }

    const today = new Date();
    const { title, tabs } = await resolveTabTitle();
    const rows = await fetchRows(title);

    // Modo inspeção: devolve a grade crua (célula a célula) pra calibrar o parser
    if (req.body?.raw_rows) {
      const from = Math.max(0, Number(req.body.raw_from) || 0);
      const to = Math.min(rows.length, Number(req.body.raw_to) || from + 40);
      return res.json({ ok: true, tab: title, sheet_rows: rows.length, raw: rows.slice(from, to).map((r, i) => ({ n: from + i + 1, cells: r })) });
    }
    // Ano padrão vem do título da aba ("AUD 2026"); cabeçalhos de mês refinam
    const yearFromTab = parseInt((title.match(/\b(20\d{2})\b/) || [])[1] || '', 10) || today.getFullYear();
    const { parsed, skipped } = parseSheet(rows, yearFromTab);

    const { data: dbRows, error: dbErr } = await ext
      .from('hearings')
      .select('id, process_number, case_ref, hearing_type, category, hearing_date, hearing_time, status, location')
      .is('deleted_at', null);
    if (dbErr) throw new Error(`hearings select: ${dbErr.message}`);

    const dbByKey = new Map<string, DbHearing>();
    for (const h of (dbRows || []) as DbHearing[]) {
      const k = keyOf(h.process_number, h.case_ref, h.hearing_date);
      if (k) dbByKey.set(k, h);
    }

    const toInsert: ParsedHearing[] = [];
    const toUpdate: { id: string; patch: Record<string, unknown>; before: Record<string, unknown>; raw: string }[] = [];
    const sheetKeys = new Set<string>();

    for (const p of parsed) {
      const key = keyOf(p.process_number, p.case_ref, p.hearing_date);
      if (!key || sheetKeys.has(key)) continue; // duplicata na própria planilha
      sheetKeys.add(key);
      const existing = dbByKey.get(key);
      if (!existing) {
        toInsert.push(p);
        continue;
      }
      const patch: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      if (p.hearing_time && p.hearing_time !== existing.hearing_time) { patch.hearing_time = p.hearing_time; before.hearing_time = existing.hearing_time; }
      if (p.hearing_type && p.hearing_type !== existing.hearing_type) { patch.hearing_type = p.hearing_type; before.hearing_type = existing.hearing_type; }
      if (p.location && p.location !== existing.location) { patch.location = p.location; before.location = existing.location; }
      if (p.case_ref && !existing.case_ref) { patch.case_ref = p.case_ref; before.case_ref = null; }
      if (p.status !== 'ativa' && p.status !== existing.status) { patch.status = p.status; before.status = existing.status; }
      if (Object.keys(patch).length) toUpdate.push({ id: existing.id, patch, before, raw: p.raw });
    }

    // Audiências futuras no banco que não estão (mais) na planilha — só reporta
    const todayISO = today.toISOString().slice(0, 10);
    const dbOnly = ((dbRows || []) as DbHearing[])
      .filter((h) => {
        const k = keyOf(h.process_number, h.case_ref, h.hearing_date);
        return k && h.hearing_date >= todayISO && h.status === 'ativa' && !sheetKeys.has(k);
      })
      .map((h) => ({ process_number: h.process_number, hearing_date: h.hearing_date, case_ref: h.case_ref }));

    const summary = {
      ok: true,
      dry_run: !apply,
      tab: title,
      tabs,
      sheet_rows: rows.length,
      parsed: parsed.length,
      skipped_count: skipped.length,
      to_insert: toInsert.length,
      to_update: toUpdate.length,
      db_only_future: dbOnly.length,
    };

    if (!apply) {
      return res.json({
        ...summary,
        headers: rows[0] || [],
        sample: rows.slice(0, 8),
        skipped: skipped.slice(0, 20),
        inserts_preview: toInsert.slice(0, 30),
        updates_preview: toUpdate.slice(0, 30),
        db_only_future_list: dbOnly.slice(0, 30),
      });
    }

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const p of toInsert) {
      const { error } = await ext.from('hearings').insert({
        process_number: p.process_number,
        case_ref: p.case_ref,
        hearing_type: p.hearing_type,
        category: p.category,
        hearing_date: p.hearing_date,
        hearing_time: p.hearing_time,
        location: p.location,
        status: p.status,
        notes: p.raw,
      });
      if (error) errors.push(`insert linha ${p.row_index}: ${error.message}`);
      else inserted++;
    }
    for (const u of toUpdate) {
      const { error } = await ext.from('hearings').update(u.patch).eq('id', u.id);
      if (error) errors.push(`update ${u.id}: ${error.message}`);
      else updated++;
    }

    console.log(`sync-hearings-from-sheet: ${inserted} inseridas, ${updated} atualizadas, ${dbOnly.length} só no banco`);
    return res.json({ ...summary, dry_run: false, inserted, updated, errors: errors.slice(0, 20), db_only_future_list: dbOnly.slice(0, 30) });
  } catch (err) {
    console.error('sync-hearings-from-sheet error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
};

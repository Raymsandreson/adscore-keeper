// Reads the Meta Lead Ads Google Sheet (BPC-LOAS Autismo) and returns metrics
// + the list of leads. Phones are cross-checked against External Supabase
// whatsapp_messages to decide who already wrote on WA vs. who must be called.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const SPREADSHEET_ID = "1EXB6oFovhX2LOHsC2X20LFk-JVIkjk-NR5Er4cUn6Qw";
// Mapeamento por PALAVRA-CHAVE (não por nome exato). Resiliente a renomeação
// de aba ("LEADS EDILAN" / "1LEADS EDILAN" / "EDILAN NOVO" → todos viram Edilan).
// A primeira keyword que casar (case-insensitive) define o operador.
const OPERATOR_KEYWORDS: { keyword: string; operator: string }[] = [
  { keyword: "israel", operator: "Israel" },
  { keyword: "cris", operator: "Cris" },
  { keyword: "mateus", operator: "Mateus" },
  { keyword: "edilan", operator: "Edilan" },
  { keyword: "karol", operator: "Karolyne" },
  { keyword: "andressa", operator: "Andressa" },
  { keyword: "keilane", operator: "Keilane" },
  { keyword: "api", operator: "API" },
];
// Abas ignoradas na descoberta (já tratadas em separado ou irrelevantes).
const SKIP_TABS = new Set(["BASE_UNIFICADA"]);
let SHEET_TABS: { tab: string; operator: string }[] = [];
const UNIFIED_TAB = "BASE_UNIFICADA";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

async function discoverSheetTabs(): Promise<{ tab: string; operator: string }[]> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gsKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!lovableKey || !gsKey) throw new Error("Missing connector keys");
  const resp = await fetch(
    `${GATEWAY}/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gsKey } },
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`discoverSheetTabs ${resp.status}: ${t.substring(0, 200)}`);
  }
  const json = await resp.json();
  const titles: string[] = (json.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
  const found: { tab: string; operator: string }[] = [];
  for (const title of titles) {
    if (SKIP_TABS.has(title)) continue;
    const lower = title.toLowerCase();
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
  }
  return found;
}

type SheetRow = {
  form_lead_id: string;
  created_at: string;
  campaign_name: string;
  ad_name: string;
  form_name: string;
  is_organic: boolean;
  name: string;
  phone_raw: string;
  phone_normalized: string;
  estado_civil: string;
  filho_autista: string;
  laudo: string;
  renda: string;
  possui_advogado: string;
  lead_status: string;
  operator: string;
  tab: string;
};

function normalizePhone(raw: string): string {
  if (!raw) return "";
  return raw.replace(/^p:/i, "").replace(/\D/g, "");
}

function rowToObject(headers: string[], row: any[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = String(row[i] ?? "").trim();
  });
  return o;
}

async function fetchTab(
  tab: string,
  operatorFromColumn = false,
  onHeaders?: (h: string[]) => void,
): Promise<SheetRow[]> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gsKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!lovableKey || !gsKey) throw new Error("Missing connector keys");

  const url =
    `${GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(tab)}'!A1:Z5000`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gsKey,
    },
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`sheet ${tab} ${resp.status}: ${t.substring(0, 200)}`);
  }
  const json = await resp.json();
  const values: any[][] = json.values || [];
  console.log(`[bpc-sheets-metrics] fetchTab ${tab}: ${values.length} raw rows`);
  if (values.length < 2) return [];
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
  if (onHeaders) onHeaders(headers);
  const meta = SHEET_TABS.find((s) => s.tab === tab);

  return values.slice(1).filter((r) => r.length > 0).map((r) => {
    const o = rowToObject(headers, r);
    const phoneRaw = o["telefone"] || o["phone_number"] || o["número_do_whatsapp"] || o["qual_o_seu_número_de_contato_?"] || "";
    const name = o["nome_completo"] || o["full_name"] || "";
    return {
      form_lead_id: o["id"] || "",
      created_at: o["created_time"] || "",
      campaign_name: o["campaign_name"] || "",
      ad_name: o["ad_name"] || "",
      form_name: o["form_name"] || "",
      is_organic: (o["is_organic"] || "").toLowerCase() === "true",
      name,
      phone_raw: phoneRaw,
      phone_normalized: normalizePhone(phoneRaw),
      estado_civil: o["estado_civil"] || o["marital_status"] || "",
      filho_autista: o["você_possui_filho_autista_ou_conhece_alguém_autista_?"] || "",
      laudo: o["possui_laudo_médico_ou_relatório_escolar_?"] || "",
      renda: o["qual_a_sua_renda_familiar_?"] || "",
      possui_advogado: o["possui_advogado_?"] || "",
      lead_status: o["lead_status"] || "",
      operator: operatorFromColumn
        ? (o["origem_vendedor"] || o["operador"] || o["operator"] || "—")
        : (meta?.operator ?? ""),
      tab,
    };
  }).filter((r) => r.phone_normalized.length >= 10 && !r.name.startsWith("<test"));

}

function isUnviable(row: SheetRow): boolean {
  const s = row.lead_status.toLowerCase();
  return s.includes("ctt errado") || s.includes("invi") || s === "recusado";
}

// A planilha grava timestamps em -05:00 (México, fuso Meta). O usuário conta
// leads OLHANDO a planilha, então o que importa é o "dia em -05:00", não o
// "dia em BR". Ex: 2026-05-31T22:29-05:00 → na planilha aparece como 31/05.
// Em BR seria 01/06 00:29, mas o usuário continua contando como 31/05.
//
// Para o from/to vindos do dashboard (BR start/end of day) usamos o ponto
// médio do intervalo deslocado para -05:00. Funciona para "hoje", "ontem",
// "semana", "mês" porque o midpoint sempre cai no meio do dia/período.
const SHEET_TZ_OFFSET_MIN = -5 * 60; // -05:00 (fuso México/Meta)

function sheetDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const shifted = new Date(d.getTime() + SHEET_TZ_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

// Para o range, deslocamos +12h antes para garantir que o "miolo" do dia BR
// caia no dia correto em -05:00 (BR e México têm 2h de diferença).
function rangeSheetDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const midShifted = new Date(d.getTime() + 12 * 60 * 60_000 + SHEET_TZ_OFFSET_MIN * 60_000);
  return midShifted.toISOString().slice(0, 10);
}

function inPeriod(iso: string, fromISO: string, toISO: string): boolean {
  if (!iso) return false;
  const rowDate = sheetDate(iso);
  const fromDate = rangeSheetDate(fromISO);
  const toDate = rangeSheetDate(toISO);
  if (!rowDate) return false;
  return rowDate >= fromDate && rowDate <= toDate;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Require any auth header (logged-in users only)
    if (!req.headers.get("authorization")) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const fromISO = url.searchParams.get("from") ||
      new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const toISO = url.searchParams.get("to") || new Date().toISOString();
    const instanceFilter = (url.searchParams.get("instance_name") || "").toLowerCase().trim();
    // date_type: created (default) | first_contact | last_contact
    const dateType = (url.searchParams.get("date_type") || "created").toLowerCase();
    // source: "" (abas por operador, padrão) | "unificada" (aba BASE_UNIFICADA)
    const source = (url.searchParams.get("source") || "").toLowerCase().trim();

    const tabErrors: { tab: string; error: string }[] = [];
    const allRows: SheetRow[] = [];
    const tabsReadNames: string[] = [];
    let debugHeaders: string[] = [];

    // A planilha BASE_UNIFICADA atualmente está com colunas-chave (telefone, origem_vendedor)
    // vazias. Por isso, mesmo quando o caller pede source=unificada, lemos as ABAS INDIVIDUAIS
    // (descobertas dinamicamente) e o operador vem do nome da aba — fonte confiável.
    try {
      SHEET_TABS = await discoverSheetTabs();
    } catch (e: any) {
      console.error("[bpc-sheets-metrics] discoverSheetTabs failed:", e?.message || e);
      SHEET_TABS = [];
    }
    const tabsToRead = instanceFilter
      ? SHEET_TABS.filter((s) => instanceFilter.includes(s.operator.toLowerCase()))
      : SHEET_TABS;
    tabsReadNames.push(...tabsToRead.map((t) => t.tab));
    for (let i = 0; i < tabsToRead.length; i++) {
      const s = tabsToRead[i];
      try {
        const rows = await fetchTab(s.tab, false, (h) => { if (!debugHeaders.length) debugHeaders = h; });
        allRows.push(...rows);
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error(`[bpc-sheets-metrics] tab "${s.tab}" failed:`, msg);
        tabErrors.push({ tab: s.tab, error: msg.substring(0, 200) });
      }
      if (i < tabsToRead.length - 1) await new Promise((r) => setTimeout(r, 250));
    }
    // Marcamos source=unificada no response pra compatibilidade com o caller,
    // mas a fonte real são as abas individuais.
    void source;

    // Para "created" filtramos cedo (economia). Pros outros precisamos cruzar
    // com WA antes — então usamos todas as linhas como base.
    const baseRows = dateType === "created"
      ? allRows.filter((r) => inPeriod(r.created_at, fromISO, toISO))
      : allRows;

    // Cross-check com whatsapp_messages: pegamos PRIMEIRA e ÚLTIMA mensagem por telefone.
    const phones = Array.from(new Set(baseRows.map((r) => r.phone_normalized)));
    const firstByPhone = new Map<string, { direction: string; created_at: string }>();
    const lastByPhone = new Map<string, { created_at: string }>();

    if (phones.length > 0) {
      const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
      const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
      if (extUrl && extKey) {
        const ext = createClient(extUrl, extKey, { auth: { persistSession: false } });
        const last8 = phones.map((p) => p.slice(-8)).filter((p) => p.length === 8);
        if (last8.length > 0) {
          const { data } = await ext
            .from("whatsapp_messages")
            .select("phone, direction, created_at")
            .or(last8.map((p) => `phone.like.%${p}`).join(","))
            .order("created_at", { ascending: true })
            .limit(50000);
          (data || []).forEach((r: any) => {
            const np = normalizePhone(r.phone);
            if (!np) return;
            const key = np.slice(-8);
            if (!firstByPhone.has(key)) {
              firstByPhone.set(key, {
                direction: String(r.direction || "").toLowerCase(),
                created_at: r.created_at,
              });
            }
            lastByPhone.set(key, { created_at: r.created_at }); // sobrescreve até a última
          });
        }
      }
    }

    let leads = baseRows.map((r) => {
      const first = firstByPhone.get(r.phone_normalized.slice(-8));
      const last = lastByPhone.get(r.phone_normalized.slice(-8));
      const has_whatsapp = !!first;
      let first_contact_by: "client" | "operator" | null = null;
      if (first) first_contact_by = first.direction === "inbound" ? "client" : "operator";
      return {
        ...r,
        has_whatsapp,
        first_contact_by,
        first_contact_at: first?.created_at || null,
        last_contact_at: last?.created_at || null,
        is_unviable: isUnviable(r),
      };
    });

    // Filtro de período por tipo de data (quando não for "created" — esse já foi)
    if (dateType === "first_contact") {
      leads = leads.filter((l) => l.first_contact_at && inPeriod(l.first_contact_at, fromISO, toISO));
    } else if (dateType === "last_contact") {
      leads = leads.filter((l) => l.last_contact_at && inPeriod(l.last_contact_at, fromISO, toISO));
    }

    const total = leads.length;
    const unviable = leads.filter((l) => l.is_unviable).length;
    const toCallNow = leads.filter((l) => !l.has_whatsapp && !l.is_unviable).length;
    const alreadyOnWhatsApp = leads.filter((l) => l.has_whatsapp).length;

    // Breakdown by operator. Nas abas por operador, cada aba = um operador.
    // Na unificada, os operadores vêm da coluna `origem_vendedor`.
    const operatorKeys = source === "unificada"
      ? Array.from(new Set(leads.map((l) => l.operator).filter(Boolean)))
      : SHEET_TABS.map((m) => m.operator);
    const byOperator = operatorKeys.map((op) => {
      const opLeads = leads.filter((l) => l.operator === op);
      return {
        operator: op,
        tab: source === "unificada"
          ? UNIFIED_TAB
          : (SHEET_TABS.find((m) => m.operator === op)?.tab ?? ""),
        total: opLeads.length,
        unviable: opLeads.filter((l) => l.is_unviable).length,
        toCallNow: opLeads.filter((l) => !l.has_whatsapp && !l.is_unviable).length,
        alreadyOnWhatsApp: opLeads.filter((l) => l.has_whatsapp).length,
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        period: { from: fromISO, to: toISO, date_type: dateType },
        instance_filter: instanceFilter || null,
        source: source || null,
        tabs_read: tabsReadNames,
        debug_headers: debugHeaders,
        tab_errors: tabErrors,
        metrics: { total, unviable, toCallNow, alreadyOnWhatsApp },
        byOperator,
        leads: leads.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
        fetched_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[bpc-sheets-metrics] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

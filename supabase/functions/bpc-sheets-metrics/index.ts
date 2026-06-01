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
const SHEET_TABS: { tab: string; operator: string }[] = [
  { tab: "LEADS ISRAEL", operator: "Israel" },
  { tab: "LEADS CRIS", operator: "Cris" },
  { tab: "LEADS MATEUS", operator: "Mateus" },
  { tab: "LEADS EDILAN", operator: "Edilan" },
  { tab: "LEDS KAROLYNE", operator: "Karolyne" },
];
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

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

async function fetchTab(tab: string): Promise<SheetRow[]> {
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
  if (values.length < 2) return [];
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
  const meta = SHEET_TABS.find((s) => s.tab === tab)!;

  return values.slice(1).filter((r) => r.length > 0).map((r) => {
    const o = rowToObject(headers, r);
    const phoneRaw = o["telefone"] || o["phone_number"] || o["qual_o_seu_número_de_contato_?"] || "";
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
      operator: meta.operator,
      tab,
    };
  }).filter((r) => r.phone_normalized.length >= 10 && !r.name.startsWith("<test"));

}

function isUnviable(row: SheetRow): boolean {
  const s = row.lead_status.toLowerCase();
  return s.includes("ctt errado") || s.includes("invi") || s === "recusado";
}

// The sheet stores timestamps with -05:00 offset (Meta's TZ). To match what the
// user SEES in the sheet (the YYYY-MM-DD prefix of the cell), we compare the
// LOCAL date portion of the timestamp directly, in the sheet's own timezone.
const SHEET_TZ_OFFSET_MIN = -5 * 60; // -05:00

function localDateInSheetTZ(iso: string): string {
  // iso example: "2026-06-01T04:26:25-05:00" -> "2026-06-01"
  // Or any other tz -> shift to -05:00 first
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!m) return "";
  // If the ISO already ends with -05:00, the date prefix is already correct.
  if (iso.endsWith("-05:00")) return m[1];
  // Otherwise compute manually
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const shifted = new Date(d.getTime() + SHEET_TZ_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function inPeriod(iso: string, fromISO: string, toISO: string): boolean {
  if (!iso) return false;
  const rowDate = localDateInSheetTZ(iso);
  const fromDate = localDateInSheetTZ(fromISO);
  const toDate = localDateInSheetTZ(toISO);
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

    // 1. Decide which tabs to read based on instance filter.
    // Each operator tab corresponds to that operator's WhatsApp instance
    // (e.g. tab "LEADS MATEUS" -> instance "mateus atendimento"). Match by
    // checking if the operator name appears inside the instance name.
    const tabsToRead = instanceFilter
      ? SHEET_TABS.filter((s) => instanceFilter.includes(s.operator.toLowerCase()))
      : SHEET_TABS;

    // If a filter was set but no operator matched, return empty.
    const allRows = tabsToRead.length === 0
      ? []
      : (await Promise.all(tabsToRead.map((s) => fetchTab(s.tab)))).flat();

    // 2. Filter by period
    const periodRows = allRows.filter((r) => inPeriod(r.created_at, fromISO, toISO));

    // 3. Cross-check phones against whatsapp_messages on External
    const phones = Array.from(new Set(periodRows.map((r) => r.phone_normalized)));
    let whatsappPhones = new Set<string>();

    if (phones.length > 0) {
      const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
      const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
      if (extUrl && extKey) {
        const ext = createClient(extUrl, extKey, { auth: { persistSession: false } });
        // Build OR list of last-8-digits patterns to match Brazilian numbers
        const last8 = phones.map((p) => p.slice(-8)).filter((p) => p.length === 8);
        if (last8.length > 0) {
          // Single IN query on the right-trimmed phone is cheaper than N ilikes.
          // We fetch all matching phones from messages and keep the set.
          const { data } = await ext
            .from("whatsapp_messages")
            .select("phone")
            .or(last8.map((p) => `phone.like.%${p}`).join(","))
            .limit(10000);
          (data || []).forEach((r: any) => {
            const np = normalizePhone(r.phone);
            if (np) whatsappPhones.add(np.slice(-8));
          });
        }
      }
    }

    const leads = periodRows.map((r) => ({
      ...r,
      has_whatsapp: whatsappPhones.has(r.phone_normalized.slice(-8)),
      is_unviable: isUnviable(r),
    }));

    const total = leads.length;
    const unviable = leads.filter((l) => l.is_unviable).length;
    const toCallNow = leads.filter((l) => !l.has_whatsapp && !l.is_unviable).length;
    const alreadyOnWhatsApp = leads.filter((l) => l.has_whatsapp).length;

    return new Response(
      JSON.stringify({
        success: true,
        period: { from: fromISO, to: toISO },
        metrics: { total, unviable, toCallNow, alreadyOnWhatsApp },
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ABDER_OLD = "7f41a35e-7d98-4ade-8270-52d727433e6a";
const ABDER_NEW = "b68dab6e-007f-45fc-ba27-eb378a711124";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const sb = createClient(url, key);

    // 1) Listar TODAS as tabelas
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const j: any = await r.json();
    const tables: string[] = j?.definitions ? Object.keys(j.definitions) : [];

    // 2) Para cada tabela, escanear até 5000 linhas e procurar o ID antigo
    const hits: Record<string, { count: number; sample: any; columnsWithMatch: Set<string> }> = {};
    for (const t of tables) {
      try {
        const { data, error } = await sb.from(t).select("*").limit(5000);
        if (error || !data) continue;
        let count = 0;
        let sample: any = null;
        const cols = new Set<string>();
        for (const row of data) {
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === "string" && v === ABDER_OLD) { count++; sample = sample || row; cols.add(k); }
            else if (v && typeof v === "object") {
              const s = JSON.stringify(v);
              if (s.includes(ABDER_OLD)) { count++; sample = sample || row; cols.add(k); }
            }
          }
        }
        if (count > 0) hits[t] = { count, sample, columnsWithMatch: cols };
      } catch {}
    }

    // 3) Comparativo: quantos OUTROS acolhedores têm o mesmo problema (id em automation/stage que não existe em profiles)?
    const { data: profs } = await sb.from("profiles").select("user_id, id, full_name").limit(2000);
    const profIds = new Set<string>();
    (profs || []).forEach((p: any) => { if (p.user_id) profIds.add(p.user_id); if (p.id) profIds.add(p.id); });

    const orphans: any[] = [];
    for (const tbl of ["agent_automation_rules", "agent_stage_assignments", "card_assignments", "checklist_templates"]) {
      try {
        const { data } = await sb.from(tbl).select("*").limit(2000);
        for (const row of data || []) {
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) {
              if ((k.includes("user") || k.includes("assign") || k.includes("owner") || k.includes("member") || k.includes("created_by")) && !profIds.has(v)) {
                orphans.push({ table: tbl, column: k, orphanId: v, rowId: row.id });
              }
            }
          }
        }
      } catch {}
    }

    return new Response(JSON.stringify({
      hits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, { count: v.count, columns: [...v.columnsWithMatch], sample: v.sample }])),
      tabelasComIdAntigo: Object.keys(hits),
      totalLinhasComIdAntigo: Object.values(hits).reduce((a, h) => a + h.count, 0),
      outrosAcolhedoresOrfaos: {
        total: orphans.length,
        amostra: orphans.slice(0, 30),
        idsUnicos: [...new Set(orphans.map((o) => o.orphanId))],
      },
      abderNew: ABDER_NEW,
      abderOld: ABDER_OLD,
    }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
});

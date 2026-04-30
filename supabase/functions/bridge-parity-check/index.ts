// Lê paridade Lovable x Externo apenas para as 9 tabelas com bridge ativo.
// READ-ONLY. Sem auth. Use para diagnóstico antes de migrar writes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const TABLES = [
  "lead_activities",
  "lead_stage_history",
  "lead_processes",
  "legal_cases",
  "process_parties",
  "activity_attachments",
  "activity_chat_messages",
  "team_chat_messages",
  "team_chat_mentions",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const internal = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const external = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];

  for (const t of TABLES) {
    const row: any = { table: t };

    // Count Lovable
    const { count: cInt, error: eInt } = await internal
      .from(t).select("*", { count: "exact", head: true });
    row.lovable_count = eInt ? `ERR:${eInt.message}` : cInt ?? 0;

    // Count Externo
    const { count: cExt, error: eExt } = await external
      .from(t).select("*", { count: "exact", head: true });
    row.external_count = eExt ? `ERR:${eExt.message}` : cExt ?? 0;
    row.external_exists = !eExt;

    // Schema columns Externo (pega 1 row para descobrir colunas)
    if (!eExt) {
      const { data: sample } = await external.from(t).select("*").limit(1);
      row.external_columns = sample?.[0] ? Object.keys(sample[0]).sort() : [];
    }

    // Schema columns Lovable
    const { data: sampleInt } = await internal.from(t).select("*").limit(1);
    row.lovable_columns = sampleInt?.[0] ? Object.keys(sampleInt[0]).sort() : [];

    // Diff
    if (row.external_columns && row.lovable_columns) {
      const lov = new Set(row.lovable_columns);
      const ext = new Set(row.external_columns);
      row.only_in_lovable = [...lov].filter((c) => !ext.has(c));
      row.only_in_external = [...ext].filter((c) => !lov.has(c));
    }

    results.push(row);
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});

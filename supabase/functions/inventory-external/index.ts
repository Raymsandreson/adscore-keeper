// Conta linhas das tabelas críticas no Supabase EXTERNO para comparar com Cloud.
// Saída: { table, total_external, oldest, newest } por tabela.

import { getExternalClient } from "../_shared/external-client.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const TABLES = [
  "whatsapp_messages",
  "webhook_logs",
  "contacts",
  "whatsapp_command_history",
  "leads",
  "lead_activities",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ext = getExternalClient();
    const results: Array<Record<string, unknown>> = [];

    for (const table of TABLES) {
      try {
        const { count, error: countErr } = await ext
          .from(table)
          .select("*", { count: "exact", head: true });

        if (countErr) {
          results.push({ table, error: countErr.message });
          continue;
        }

        // Mais antigo / mais recente (1 row cada)
        const { data: oldest } = await ext
          .from(table)
          .select("created_at")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const { data: newest } = await ext
          .from(table)
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        results.push({
          table,
          total_external: count ?? 0,
          oldest: (oldest as any)?.created_at ?? null,
          newest: (newest as any)?.created_at ?? null,
        });
      } catch (e) {
        results.push({ table, error: String(e).slice(0, 200) });
      }
    }

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

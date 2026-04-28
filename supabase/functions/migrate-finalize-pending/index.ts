// Finaliza migração das tabelas pendentes restantes em uma única chamada.
// Hardcoded: team_chat_mentions (PK id) + system_settings (PK key).
// Marca user_sessions como done (Cloud-only, NEVER_MIGRATE).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

async function migrate(table: string, conflictKey: string) {
  // Lê tudo de uma vez (tabelas pequenas)
  const { data, error } = await cloud.from(table).select("*");
  if (error) return { table, success: false, error: error.message, read: 0, upserted: 0 };
  if (!data || data.length === 0) return { table, success: true, read: 0, upserted: 0, note: "empty" };

  const { error: upErr } = await ext.from(table).upsert(data, { onConflict: conflictKey });
  if (upErr) return { table, success: false, error: upErr.message, read: data.length, upserted: 0 };

  // Marca como done no progress
  await cloud.from("migration_progress").update({
    status: "done",
    finished_at: new Date().toISOString(),
    last_error: null,
  }).eq("table_name", table);

  return { table, success: true, read: data.length, upserted: data.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const results: any[] = [];
    results.push(await migrate("team_chat_mentions", "id"));
    results.push(await migrate("system_settings", "key"));

    // Marca user_sessions como done (Cloud-only)
    const { error: usErr } = await cloud.from("migration_progress").update({
      status: "done",
      finished_at: new Date().toISOString(),
      last_error: "skipped: Cloud-only NEVER_MIGRATE",
    }).eq("table_name", "user_sessions");
    results.push({ table: "user_sessions", skipped: true, error: usErr?.message ?? null });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

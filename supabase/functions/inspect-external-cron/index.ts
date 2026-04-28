// TEMPORARY inspection function — to be deleted after pg_cron migration planning
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ext = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const out: Record<string, unknown> = {};

  // 1) extensions installed
  const { data: exts, error: extErr } = await ext.rpc("exec_sql_readonly", {
    sql: "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY extname",
  }).catch((e) => ({ data: null, error: e }));
  out.extensions = extErr ? { error: String(extErr) } : exts;

  // 2) Try direct query via raw SQL function we may not have. Fallback: list known tables.
  // Check tables we care about
  for (const t of ["wjia_chat_sessions", "comment_schedules", "wjia_command_shortcuts", "webhook_logs", "lead_activities", "agent_reply_locks"]) {
    const { error, count } = await ext.from(t).select("*", { count: "exact", head: true });
    out[`table_${t}`] = error ? `ERR: ${error.message}` : `OK count=${count}`;
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

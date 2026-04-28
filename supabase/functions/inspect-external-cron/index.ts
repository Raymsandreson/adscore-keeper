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

  for (const t of [
    "wjia_chat_sessions",
    "comment_schedules",
    "wjia_command_shortcuts",
    "webhook_logs",
    "lead_activities",
    "agent_reply_locks",
    "auth_uuid_mapping",
  ]) {
    try {
      const { error, count } = await ext.from(t).select("*", { count: "exact", head: true });
      out[`table_${t}`] = error ? `ERR: ${error.message}` : `OK count=${count}`;
    } catch (e) {
      out[`table_${t}`] = `EXC: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

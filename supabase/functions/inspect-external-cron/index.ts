import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inspeciona pg_cron e pg_net no Externo via RPC.
// Se a RPC não existir ainda, tenta criá-la (idempotente) usando uma RPC genérica de exec.
// Como não temos exec genérico, retorna instruções.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ext = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const out: Record<string, unknown> = {};

  // 1) Tenta a RPC de inspeção
  const { data: extensions, error: extErr } = await ext.rpc("_admin_list_extensions");
  out.extensions = extErr ? { error: extErr.message, code: extErr.code } : extensions;

  const { data: jobs, error: jobErr } = await ext.rpc("_admin_list_cron_jobs");
  out.cron_jobs = jobErr ? { error: jobErr.message, code: jobErr.code } : jobs;

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

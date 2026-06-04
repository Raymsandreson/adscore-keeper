import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Trampoline pro Railway: cron Cloud chama esta função, que faz POST autenticado
 * no Railway /functions/meta-call-queue-processor.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const RAILWAY = "https://adscore-keeper-production.up.railway.app/functions/meta-call-queue-processor";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const railwayKey = Deno.env.get("RAILWAY_API_KEY") ?? "";
  if (!railwayKey) {
    return new Response(
      JSON.stringify({ success: false, error: "RAILWAY_API_KEY not configured" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const resp = await fetch(RAILWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": railwayKey },
      body: "{}",
    });
    const text = await resp.text();
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

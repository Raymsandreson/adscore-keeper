import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * LEGACY STUB — kept for 24h after migration to Railway (call-queue-processor).
 * This function used to do the actual work. Now Railway handles it via pg_cron.
 * Do not delete: rollback path relies on pg_cron pointing back here if Railway fails.
 *
 * Original logic: see git history / railway-server/src/functions/call-queue-processor.ts
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[whatsapp-call-queue-processor] LEGACY stub invoked — work now done in Railway");

  return new Response(
    JSON.stringify({
      legacy: true,
      message: "Migrated to Railway. This stub returns 200 to keep callers happy.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

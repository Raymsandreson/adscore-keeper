import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ext = createClient(
      Deno.env.get('EXTERNAL_SUPABASE_URL')!,
      Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Yesterday in BRT (UTC-3)
    const nowBRT = new Date(Date.now() - 3 * 3600 * 1000);
    const yStart = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate() - 1, 3, 0, 0));
    const yEnd = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate(), 3, 0, 0));

    const tables = ['leads', 'contacts', 'lead_activities', 'webhook_logs'];
    const results: Record<string, number | string> = {};

    for (const t of tables) {
      const { count, error } = await ext.from(t)
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yStart.toISOString())
        .lt('created_at', yEnd.toISOString());
      results[t] = error ? `ERROR: ${error.message}` : (count ?? 0);
    }

    return new Response(JSON.stringify({
      banco: 'EXTERNAL',
      janela_brt: { inicio: yStart.toISOString(), fim: yEnd.toISOString() },
      counts: results,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

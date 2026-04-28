import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const externalUrl = Deno.env.get('EXTERNAL_SUPABASE_URL')!;
    const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!;
    const ext = createClient(externalUrl, externalKey);

    // Yesterday in São Paulo timezone
    // BRT is UTC-3. Yesterday 00:00 BRT = (today UTC date - 1) 03:00 UTC
    // Compute boundaries in UTC
    const nowBRT = new Date(Date.now() - 3 * 3600 * 1000);
    const yStart = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate() - 1, 3, 0, 0));
    const yEnd = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate(), 3, 0, 0));

    const { count: total } = await ext.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yStart.toISOString())
      .lt('created_at', yEnd.toISOString());

    const { count: inbound } = await ext.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yStart.toISOString())
      .lt('created_at', yEnd.toISOString())
      .eq('direction', 'inbound');

    const { count: outbound } = await ext.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yStart.toISOString())
      .lt('created_at', yEnd.toISOString())
      .eq('direction', 'outbound');

    const { data: first } = await ext.from('whatsapp_messages')
      .select('created_at').gte('created_at', yStart.toISOString()).lt('created_at', yEnd.toISOString())
      .order('created_at', { ascending: true }).limit(1);
    const { data: last } = await ext.from('whatsapp_messages')
      .select('created_at').gte('created_at', yStart.toISOString()).lt('created_at', yEnd.toISOString())
      .order('created_at', { ascending: false }).limit(1);

    const { count: totalAll } = await ext.from('whatsapp_messages')
      .select('*', { count: 'exact', head: true });

    return new Response(JSON.stringify({
      banco: 'EXTERNAL (kmedldlepwiityjsdahz)',
      janela_brt: { inicio: yStart.toISOString(), fim: yEnd.toISOString() },
      mensagens_ontem_brt: total,
      inbound, outbound,
      primeira: first?.[0]?.created_at,
      ultima: last?.[0]?.created_at,
      total_geral_externo: totalAll,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

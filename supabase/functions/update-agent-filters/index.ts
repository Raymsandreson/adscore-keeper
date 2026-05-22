// v5 - Grava em agent_filter_settings (Cloud), tabela criada exatamente pra isso
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { agent_id, lead_status_board_ids, lead_status_filter, audience_mode } = await req.json();

    if (!agent_id) {
      return new Response(JSON.stringify({ error: 'agent_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Cloud Supabase (onde existe a tabela agent_filter_settings)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const boardIds = lead_status_board_ids && lead_status_board_ids.length > 0
      ? lead_status_board_ids
      : null;
    const statusFilter = lead_status_filter && lead_status_filter.length > 0
      ? lead_status_filter
      : null;

    // audience_mode: 'ctwa_only' | 'outbound_only' | 'both' (default 'both')
    const validModes = ['ctwa_only', 'outbound_only', 'both'];
    const safeMode = validModes.includes(audience_mode) ? audience_mode : 'both';

    // Upsert por agent_id (constraint unique já existe)
    const { error } = await supabase
      .from('agent_filter_settings')
      .upsert({
        agent_id,
        lead_status_board_ids: boardIds,
        lead_status_filter: statusFilter,
        audience_mode: safeMode,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_id' });


    if (error) {
      console.error('Upsert error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

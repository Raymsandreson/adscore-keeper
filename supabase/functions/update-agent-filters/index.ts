const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { agent_id, lead_status_board_ids, lead_status_filter } = await req.json();
    
    if (!agent_id) {
      return new Response(JSON.stringify({ error: 'agent_id is required' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Use EXTERNAL_SUPABASE_URL + SERVICE_ROLE_KEY via REST API instead of direct DB connection
    const extUrl = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const extKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();

    if (!extUrl || !extKey) {
      return new Response(JSON.stringify({ error: 'External Supabase credentials not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(extUrl, extKey);

    const boardIds = lead_status_board_ids && lead_status_board_ids.length > 0 
      ? lead_status_board_ids 
      : null;
    const statusFilter = lead_status_filter && lead_status_filter.length > 0 
      ? lead_status_filter 
      : null;

    await sql`
      UPDATE public.wjia_command_shortcuts 
      SET lead_status_board_ids = ${boardIds},
          lead_status_filter = ${statusFilter},
          updated_at = now()
      WHERE id = ${agent_id}::uuid
    `;

    // Refresh PostgREST schema cache
    await sql`NOTIFY pgrst, 'reload schema'`;

    await sql.end();

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack?.substring(0, 300) }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

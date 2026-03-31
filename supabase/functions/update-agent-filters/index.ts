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

    const connStr = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const serviceKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    
    // Use direct REST API with service role key to bypass PostgREST cache
    // by using raw SQL via postgrest rpc, or direct postgres connection
    
    // Try PostgREST PATCH first
    const patchUrl = `${connStr}/rest/v1/wjia_command_shortcuts?id=eq.${agent_id}`;
    const patchBody: Record<string, any> = {};
    
    if (lead_status_board_ids !== undefined) {
      patchBody.lead_status_board_ids = lead_status_board_ids;
    }
    if (lead_status_filter !== undefined) {
      patchBody.lead_status_filter = lead_status_filter;
    }

    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(patchBody),
    });

    if (patchRes.ok) {
      return new Response(JSON.stringify({ success: true, method: 'rest_api' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const patchError = await patchRes.text();
    
    // Fallback: direct postgres connection
    const dbUrl = Deno.env.get('SUPABASE_DB_URL') || '';
    // Parse external DB connection from the external URL
    const externalRef = connStr.replace('https://', '').replace('.supabase.co', '');
    const pgConnStr = `postgresql://postgres.${externalRef}:${serviceKey}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
    
    // Use simpler approach: try the postgrest reload then retry
    // First, reload schema
    const reloadRes = await fetch(`${connStr}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    });
    
    // Retry the PATCH
    const retryRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(patchBody),
    });

    if (retryRes.ok) {
      return new Response(JSON.stringify({ success: true, method: 'rest_api_retry' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const retryError = await retryRes.text();
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'PostgREST cache stale', 
      patch_error: patchError,
      retry_error: retryError 
    }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

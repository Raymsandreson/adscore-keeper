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

    // Use direct PostgreSQL connection via the internal Lovable Cloud DB
    // The wjia_command_shortcuts table is on the EXTERNAL Supabase project
    // We connect using the Supabase Management API approach: 
    // external project ref = kmedldlepwiityjsdahz
    const externalUrl = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const serviceKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();

    if (!externalUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'External credentials not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Use PostgreSQL direct connection via the pooler
    // External project: kmedldlepwiityjsdahz
    // Connection: postgresql://postgres.kmedldlepwiityjsdahz:[password]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
    // We can extract the ref from EXTERNAL_SUPABASE_URL
    const refMatch = externalUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
    if (!refMatch) {
      return new Response(JSON.stringify({ error: 'Cannot parse external ref from URL' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const externalRef = refMatch[1];

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres({
      host: `aws-0-sa-east-1.pooler.supabase.com`,
      port: 6543,
      database: 'postgres',
      username: `postgres.${externalRef}`,
      password: serviceKey,
      ssl: 'require',
    });

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

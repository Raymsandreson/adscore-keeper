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

    // Use SUPABASE_DB_URL for direct PostgreSQL connection to external DB
    const dbUrl = (Deno.env.get('SUPABASE_DB_URL') || '').trim();

    if (!dbUrl) {
      return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Parse connection string: postgresql://user:password@host:port/dbname
    const match = dbUrl.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Cannot parse SUPABASE_DB_URL' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const [, user, password, host, port, database] = match;

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres({
      host,
      port: parseInt(port),
      database,
      username: user,
      password,
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

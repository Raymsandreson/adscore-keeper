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

    // Use EXTERNAL_DB_URL for direct PostgreSQL connection to external DB
    const dbUrl = (Deno.env.get('EXTERNAL_DB_URL') || '').trim();

    if (!dbUrl) {
      return new Response(JSON.stringify({ error: 'EXTERNAL_DB_URL not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Parse connection string: postgresql://user:password@host:port/dbname
    // Use lastIndexOf to handle passwords with @ in them
    const withoutScheme = dbUrl.replace(/^postgresql:\/\//, '');
    const lastAtIndex = withoutScheme.lastIndexOf('@');
    if (lastAtIndex === -1) {
      return new Response(JSON.stringify({ error: 'Cannot parse EXTERNAL_DB_URL: no @ found' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const userPass = withoutScheme.substring(0, lastAtIndex);
    const hostPortDb = withoutScheme.substring(lastAtIndex + 1);
    const firstColon = userPass.indexOf(':');
    const user = userPass.substring(0, firstColon);
    const password = userPass.substring(firstColon + 1);
    const hostMatch = hostPortDb.match(/^([^:]+):(\d+)\/(.+)$/);
    if (!hostMatch) {
      return new Response(JSON.stringify({ error: 'Cannot parse SUPABASE_DB_URL host portion' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const [, host, port, database] = hostMatch;

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

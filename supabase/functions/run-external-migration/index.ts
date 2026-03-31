const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const dbUrl = Deno.env.get('SUPABASE_DB_URL') || '';
    // Extract host from connection string for debugging (hide password)
    const hostMatch = dbUrl.match(/@([^:\/]+)/);
    const host = hostMatch ? hostMatch[1] : 'unknown';
    
    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres(dbUrl, { ssl: 'require' });

    // Check current database info
    const dbInfo = await sql`SELECT current_database(), inet_server_addr()::text as addr`;
    
    // Check the column
    const cols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts'
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;

    await sql`NOTIFY pgrst, 'reload schema'`;
    
    await sql.end();

    return new Response(JSON.stringify({ 
      db_host: host,
      db_info: dbInfo[0],
      columns_found: cols.map((r: any) => r.column_name),
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

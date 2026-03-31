const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // EXTERNAL_SUPABASE_URL actually contains the postgres connection string!
    const connStr = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const serviceKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    
    const results: any = {};

    // Determine which is the postgres URL and which is the API URL
    let dbConnStr = '';
    
    if (connStr.startsWith('postgresql://')) {
      dbConnStr = connStr;
      results.source = 'EXTERNAL_SUPABASE_URL contains postgres conn string';
    } else {
      // Check SUPABASE_DB_URL 
      const dbUrl = Deno.env.get('SUPABASE_DB_URL') || '';
      if (dbUrl.startsWith('postgresql://')) {
        dbConnStr = dbUrl;
        results.source = 'Using SUPABASE_DB_URL';
      }
    }

    // Extract host to see which project
    const hostMatch = dbConnStr.match(/@([^:\/]+)/);
    results.db_host = hostMatch ? hostMatch[1] : 'unknown';

    if (!dbConnStr) {
      return new Response(JSON.stringify({ error: 'No postgres connection string found', ...results }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres(dbConnStr, { ssl: 'require' });

    // Check which DB we're on
    const dbCheck = await sql`SELECT current_database()`;
    results.database = dbCheck[0]?.current_database;

    // Check if columns exist
    const cols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts'
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;
    results.existing_columns = cols.map((r: any) => r.column_name);

    // Add columns if missing
    if (!cols.some((r: any) => r.column_name === 'lead_status_board_ids')) {
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_board_ids text[] DEFAULT NULL`;
      results.added_lead_status_board_ids = true;
    }
    if (!cols.some((r: any) => r.column_name === 'lead_status_filter')) {
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_filter text[] DEFAULT NULL`;
      results.added_lead_status_filter = true;
    }

    // Force schema refresh
    await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS _temp_refresh boolean DEFAULT NULL`;
    await sql`ALTER TABLE public.wjia_command_shortcuts DROP COLUMN IF EXISTS _temp_refresh`;
    await sql`NOTIFY pgrst, 'reload schema'`;
    results.schema_refreshed = true;

    // Verify
    const verify = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts'
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;
    results.final_columns = verify.map((r: any) => r.column_name);

    await sql.end();

    return new Response(JSON.stringify({ success: true, ...results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

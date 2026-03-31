const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const connStr = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const results: any = {};

    // Parse the connection string manually to handle special chars in password
    const withoutScheme = connStr.replace(/^postgresql:\/\//, '');
    const lastAtIndex = withoutScheme.lastIndexOf('@');
    if (lastAtIndex === -1) {
      return new Response(JSON.stringify({ error: 'Cannot parse connection string' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const userPass = withoutScheme.substring(0, lastAtIndex);
    const hostPortDb = withoutScheme.substring(lastAtIndex + 1);
    const firstColon = userPass.indexOf(':');
    const user = decodeURIComponent(userPass.substring(0, firstColon));
    const password = decodeURIComponent(userPass.substring(firstColon + 1));
    const hostMatch = hostPortDb.match(/^([^:]+):(\d+)\/(.+)$/);
    if (!hostMatch) {
      return new Response(JSON.stringify({ error: 'Cannot parse host portion' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    const [, host, port, database] = hostMatch;
    results.host = host;
    results.user = user;

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres({
      host,
      port: parseInt(port),
      database,
      username: user,
      password,
      ssl: 'require',
    });

    // Check which DB we're on
    const dbCheck = await sql`SELECT current_database()`;
    results.database = dbCheck[0]?.current_database;

    // Check columns
    const cols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts'
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;
    results.existing_columns = cols.map((r: any) => r.column_name);

    // Add columns if missing
    if (!cols.some((r: any) => r.column_name === 'lead_status_board_ids')) {
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_board_ids text[] DEFAULT NULL`;
      results.added_board_ids = true;
    }
    if (!cols.some((r: any) => r.column_name === 'lead_status_filter')) {
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_filter text[] DEFAULT NULL`;
      results.added_status_filter = true;
    }

    // Force schema refresh - multiple techniques
    await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS _temp boolean DEFAULT NULL`;
    await sql`ALTER TABLE public.wjia_command_shortcuts DROP COLUMN IF EXISTS _temp`;
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
    return new Response(JSON.stringify({ error: error.message, stack: error.stack?.substring(0, 300) }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

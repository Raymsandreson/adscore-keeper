const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const dbUrl = Deno.env.get('SUPABASE_DB_URL');
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL not set' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres(dbUrl, { ssl: 'require' });

    // Multiple approaches to force PostgREST schema cache refresh
    const results: any = {};

    // 1. Add comment to force detection
    await sql`COMMENT ON COLUMN public.wjia_command_shortcuts.lead_status_board_ids IS 'Board IDs for lead status filtering'`;
    await sql`COMMENT ON COLUMN public.wjia_command_shortcuts.lead_status_filter IS 'Lead status filter values'`;
    results.comments_added = true;

    // 2. NOTIFY pgrst
    await sql`NOTIFY pgrst, 'reload schema'`;
    results.notify_sent = true;

    // 3. Also try NOTIFY on the specific channel Supabase uses
    await sql`NOTIFY pgrst, 'reload config'`;
    results.config_reload_sent = true;

    // 4. Touch the table to invalidate any statement cache
    await sql`ALTER TABLE public.wjia_command_shortcuts ALTER COLUMN lead_status_board_ids SET DEFAULT NULL`;
    await sql`ALTER TABLE public.wjia_command_shortcuts ALTER COLUMN lead_status_filter SET DEFAULT NULL`;
    results.defaults_reset = true;

    // 5. Try altering and re-altering to force schema version change
    try {
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS _schema_refresh_temp boolean DEFAULT NULL`;
      await sql`ALTER TABLE public.wjia_command_shortcuts DROP COLUMN IF EXISTS _schema_refresh_temp`;
      results.schema_version_bumped = true;
    } catch (e) {
      results.schema_bump_error = e.message;
    }

    // 6. Final NOTIFY
    await sql`NOTIFY pgrst, 'reload schema'`;

    // Verify columns
    const verify = await sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts' 
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;
    results.verified_columns = verify;

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Connect to the EXTERNAL database (kmedldlepwiityjsdahz), NOT Lovable Cloud
    const externalUrl = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const externalKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    
    // Extract project ref from URL to build DB connection string
    const refMatch = externalUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
    const projectRef = refMatch ? refMatch[1] : null;
    
    if (!projectRef) {
      return new Response(JSON.stringify({ 
        error: 'Cannot extract project ref from EXTERNAL_SUPABASE_URL', 
        url_preview: externalUrl?.substring(0, 40) 
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Use the Supabase Management API or direct DB approach
    // Since we need DDL, we'll use the postgres connection to the EXTERNAL project
    // The DB URL for external project would be: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
    // But we don't have that password. Let's try a different approach - use supabase SQL editor API via service role

    // Actually, let's use the service role key to call the external project's SQL endpoint
    // Supabase has a pg_rest endpoint that can run SQL via the service role
    
    // Try using the external DB URL if it's a postgres connection string
    const dbUrl = Deno.env.get('SUPABASE_DB_URL') || '';
    
    // Check: is SUPABASE_DB_URL pointing to external or internal?
    const dbHost = dbUrl.match(/@([^:\/]+)/)?.[1] || '';
    
    const results: any = {
      external_project_ref: projectRef,
      db_url_host: dbHost,
      db_points_to_external: dbHost.includes(projectRef),
    };

    if (!dbHost.includes(projectRef)) {
      // DB URL points to wrong database! We need to connect to external DB
      // Try constructing the external DB URL from the known info
      // We'll try using the external service role key as DB password via Supabase's postgres API
      
      // Alternative: Use the external REST API to add columns via RPC
      // Let's try the pg-meta endpoint
      const metaUrl = `${externalUrl}/pg`;
      
      // Actually, the most reliable way: use the external project's SQL via REST
      // Supabase exposes /rest/v1/rpc for custom functions
      // We need to create a function first... but we can't without DB access
      
      // Final approach: we know the external project ref, try connecting via pooler
      const externalDbUrl = `postgresql://postgres.${projectRef}:${externalKey}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
      
      try {
        const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
        const sql = postgres(externalDbUrl, { ssl: 'require' });
        
        // Verify we're on the right DB
        const check = await sql`SELECT current_database()`;
        results.connected_to_external = true;
        
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
        await sql`COMMENT ON COLUMN public.wjia_command_shortcuts.lead_status_board_ids IS 'Board IDs for lead status filtering'`;
        await sql`NOTIFY pgrst, 'reload schema'`;
        
        // Add temp column and drop to bump schema version
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
      } catch (dbError) {
        results.db_error = dbError.message;
        
        // Try alternative pooler regions
        const regions = ['aws-0-us-east-1', 'aws-0-eu-west-1', 'aws-0-ap-southeast-1'];
        for (const region of regions) {
          try {
            const altUrl = `postgresql://postgres.${projectRef}:${externalKey}@${region}.pooler.supabase.com:6543/postgres`;
            const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
            const sql = postgres(altUrl, { ssl: 'require' });
            await sql`SELECT 1`;
            results.connected_via = region;
            
            await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_board_ids text[] DEFAULT NULL`;
            await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_filter text[] DEFAULT NULL`;
            await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS _temp boolean DEFAULT NULL`;
            await sql`ALTER TABLE public.wjia_command_shortcuts DROP COLUMN IF EXISTS _temp`;
            await sql`NOTIFY pgrst, 'reload schema'`;
            results.migration_done = true;
            
            await sql.end();
            break;
          } catch (e) {
            results[`error_${region}`] = e.message;
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

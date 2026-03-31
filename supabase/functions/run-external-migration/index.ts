import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const dbUrl = Deno.env.get('SUPABASE_DB_URL');
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL not set' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres(dbUrl, { ssl: 'require' });

    // Check if wjia_command_shortcuts is a table or a view
    const tableType = await sql`
      SELECT table_type FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts'
    `;
    
    const isView = tableType.length > 0 && tableType[0].table_type === 'VIEW';
    
    let results: any = { table_type: isView ? 'VIEW' : 'TABLE' };

    if (isView) {
      // It's a view - check the base table (whatsapp_ai_agents)
      const baseCheck = await sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_agents' 
        AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
      `;
      results.base_table_columns = baseCheck.map((r: any) => r.column_name);
      
      // Add missing columns to base table
      if (!baseCheck.some((r: any) => r.column_name === 'lead_status_board_ids')) {
        await sql`ALTER TABLE public.whatsapp_ai_agents ADD COLUMN IF NOT EXISTS lead_status_board_ids text[] DEFAULT NULL`;
        results.added_lead_status_board_ids = true;
      }
      if (!baseCheck.some((r: any) => r.column_name === 'lead_status_filter')) {
        await sql`ALTER TABLE public.whatsapp_ai_agents ADD COLUMN IF NOT EXISTS lead_status_filter text[] DEFAULT NULL`;
        results.added_lead_status_filter = true;
      }
      
      // Get current view definition
      const viewDef = await sql`
        SELECT definition FROM pg_views WHERE schemaname = 'public' AND viewname = 'wjia_command_shortcuts'
      `;
      results.current_view_def = viewDef[0]?.definition?.substring(0, 200);
      
      // Check if view includes the columns
      const viewDefStr = viewDef[0]?.definition || '';
      if (!viewDefStr.includes('lead_status_board_ids') || !viewDefStr.includes('lead_status_filter')) {
        // Need to recreate the view to include the new columns
        // First get all columns from the base table
        const allCols = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_agents'
          ORDER BY ordinal_position
        `;
        const colNames = allCols.map((r: any) => r.column_name);
        results.all_base_columns = colNames;
        
        // Recreate the view with all columns
        const colList = colNames.map((c: string) => `"${c}"`).join(', ');
        await sql.unsafe(`CREATE OR REPLACE VIEW public.wjia_command_shortcuts AS SELECT ${colList} FROM public.whatsapp_ai_agents`);
        results.view_recreated = true;
        
        // Re-grant permissions
        await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON public.wjia_command_shortcuts TO authenticated`;
        await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON public.wjia_command_shortcuts TO service_role`;
        await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON public.wjia_command_shortcuts TO anon`;
        results.grants_applied = true;
      }
    } else {
      // It's a regular table - just ensure columns exist
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_board_ids text[] DEFAULT NULL`;
      await sql`ALTER TABLE public.wjia_command_shortcuts ADD COLUMN IF NOT EXISTS lead_status_filter text[] DEFAULT NULL`;
      results.columns_ensured = true;
    }

    // Force PostgREST schema cache refresh
    await sql`NOTIFY pgrst, 'reload schema'`;
    results.pgrst_refreshed = true;

    // Verify the columns are now visible
    const verify = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'wjia_command_shortcuts' 
      AND column_name IN ('lead_status_board_ids', 'lead_status_filter')
    `;
    results.verified_columns = verify.map((r: any) => r.column_name);

    await sql.end();

    return new Response(JSON.stringify({ success: true, ...results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

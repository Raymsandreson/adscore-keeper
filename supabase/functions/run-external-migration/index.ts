const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const sqlStatements: string[] = body.sql ? (Array.isArray(body.sql) ? body.sql : [body.sql]) : [];

    if (sqlStatements.length === 0) {
      return new Response(JSON.stringify({ error: 'No SQL statements provided. Send { "sql": "ALTER TABLE ..." } or { "sql": ["stmt1", "stmt2"] }' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Use the external Supabase Management API via service role + rpc
    const externalUrl = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
    const serviceKey = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();

    if (!externalUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'External Supabase credentials not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Try direct PostgreSQL first, fallback to REST API
    let useDirectPg = false;
    const connStr = (Deno.env.get('EXTERNAL_DB_URL') || '').trim();
    
    if (connStr) {
      try {
        const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
        const sql = postgres(connStr, { ssl: 'require', connect_timeout: 5 });
        
        const results: any[] = [];
        for (const stmt of sqlStatements) {
          try {
            const res = await sql.unsafe(stmt);
            results.push({ sql: stmt.substring(0, 100), success: true, rows: res?.length || 0 });
          } catch (e: any) {
            results.push({ sql: stmt.substring(0, 100), success: false, error: e.message });
          }
        }

        await sql.unsafe("NOTIFY pgrst, 'reload schema'");
        await sql.end();
        useDirectPg = true;

        return new Response(JSON.stringify({ success: true, method: 'direct_pg', results, schema_cache_reloaded: true }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (pgErr: any) {
        console.log('Direct PG failed, trying REST API:', pgErr.message);
      }
    }

    // Fallback: Use Supabase REST API with service role to call rpc
    // For DDL we need to use the pg_execute approach or just report failure
    return new Response(JSON.stringify({ 
      error: 'Direct PostgreSQL connection failed. Please update the EXTERNAL_DB_URL secret with the correct database password.',
      hint: 'Go to your external Supabase project > Settings > Database > Connection string and copy the correct URI'
    }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

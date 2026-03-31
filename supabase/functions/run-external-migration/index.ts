const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const connStr = (Deno.env.get('EXTERNAL_DB_URL') || '').trim();
    if (!connStr) {
      return new Response(JSON.stringify({ error: 'EXTERNAL_DB_URL not configured' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const body = await req.json().catch(() => ({}));
    const sqlStatements: string[] = body.sql ? (Array.isArray(body.sql) ? body.sql : [body.sql]) : [];

    if (sqlStatements.length === 0) {
      return new Response(JSON.stringify({ error: 'No SQL statements provided. Send { "sql": "ALTER TABLE ..." } or { "sql": ["stmt1", "stmt2"] }' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { default: postgres } = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    const sql = postgres(connStr, { ssl: 'require' });

    const results: any[] = [];
    for (const stmt of sqlStatements) {
      try {
        const res = await sql.unsafe(stmt);
        results.push({ sql: stmt.substring(0, 100), success: true, rows: res?.length || 0 });
      } catch (e: any) {
        results.push({ sql: stmt.substring(0, 100), success: false, error: e.message });
      }
    }

    // Always reload PostgREST schema cache after migrations
    await sql.unsafe("NOTIFY pgrst, 'reload schema'");

    await sql.end();

    return new Response(JSON.stringify({ success: true, results, schema_cache_reloaded: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack?.substring(0, 300) }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Each statement runs in its own connection because CREATE INDEX CONCURRENTLY
// cannot run inside a transaction block.
const STATEMENTS: { label: string; sql: string; concurrent?: boolean }[] = [
  {
    label: 'idx_wam_inst_phone_created',
    concurrent: true,
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_phone_created
          ON public.whatsapp_messages (instance_name, phone, created_at DESC)`,
  },
  {
    label: 'idx_wam_inst_lower',
    concurrent: true,
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_lower
          ON public.whatsapp_messages (LOWER(instance_name))`,
  },
  {
    label: 'idx_wam_unread',
    concurrent: true,
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_unread
          ON public.whatsapp_messages (instance_name, phone)
          WHERE direction = 'inbound' AND read_at IS NULL`,
  },
  {
    label: 'replace_get_conversation_summaries',
    sql: `
CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_instance_names text[])
RETURNS TABLE(
  phone text,
  contact_name text,
  contact_id text,
  lead_id text,
  last_message_text text,
  last_message_at timestamp with time zone,
  last_direction text,
  instance_name text,
  unread_count bigint,
  message_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  WITH normalized AS (
    SELECT LOWER(unnest(p_instance_names)) AS name
  ),
  base AS (
    SELECT m.phone,
           m.instance_name,
           m.contact_name,
           m.contact_id,
           m.lead_id,
           m.message_text,
           m.created_at,
           m.direction,
           m.read_at
    FROM public.whatsapp_messages m
    WHERE LOWER(m.instance_name) IN (SELECT name FROM normalized)
      AND m.created_at > now() - interval '90 days'
  ),
  agg AS (
    SELECT
      b.phone,
      b.instance_name,
      COUNT(*) AS msg_count,
      COUNT(*) FILTER (WHERE b.direction = 'inbound' AND b.read_at IS NULL) AS unread
    FROM base b
    GROUP BY b.phone, b.instance_name
  ),
  latest AS (
    SELECT DISTINCT ON (b.phone, b.instance_name)
      b.phone,
      b.contact_name,
      b.contact_id::text AS contact_id,
      b.lead_id::text AS lead_id,
      b.message_text,
      b.created_at,
      b.direction,
      b.instance_name
    FROM base b
    ORDER BY b.phone, b.instance_name, b.created_at DESC
  )
  SELECT
    l.phone,
    COALESCE(NULLIF(l.contact_name, ''), c.full_name, '') AS contact_name,
    COALESCE(l.contact_id, '') AS contact_id,
    COALESCE(l.lead_id, '') AS lead_id,
    l.message_text AS last_message_text,
    l.created_at AS last_message_at,
    l.direction AS last_direction,
    l.instance_name,
    COALESCE(a.unread, 0) AS unread_count,
    COALESCE(a.msg_count, 0) AS message_count
  FROM latest l
  LEFT JOIN agg a
    ON a.phone = l.phone AND a.instance_name = l.instance_name
  LEFT JOIN public.contacts c
    ON c.id::text = l.contact_id
  ORDER BY l.created_at DESC
$fn$;`,
  },
  {
    label: 'reload_schema_cache',
    sql: `NOTIFY pgrst, 'reload schema'`,
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const connStr = (Deno.env.get('EXTERNAL_DB_URL') || '').trim();
  if (!connStr) {
    return new Response(
      JSON.stringify({ error: 'EXTERNAL_DB_URL secret is not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const results: any[] = [];
  let postgres: any;
  try {
    const mod = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
    postgres = mod.default;
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Failed to import postgresjs: ${e.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  for (const stmt of STATEMENTS) {
    const startedAt = Date.now();
    // Fresh connection per statement so CONCURRENTLY works (no implicit tx reuse)
    const sql = postgres(connStr, {
      ssl: 'require',
      connect_timeout: 10,
      max: 1,
      // Disable prepared statements to allow utility commands like CREATE INDEX CONCURRENTLY / NOTIFY
      prepare: false,
    });
    try {
      await sql.unsafe(stmt.sql);
      results.push({
        label: stmt.label,
        success: true,
        duration_ms: Date.now() - startedAt,
      });
    } catch (e: any) {
      results.push({
        label: stmt.label,
        success: false,
        duration_ms: Date.now() - startedAt,
        error: e?.message || String(e),
        code: e?.code,
      });
    } finally {
      try { await sql.end({ timeout: 5 }); } catch (_) { /* ignore */ }
    }
  }

  const allOk = results.every(r => r.success);
  return new Response(
    JSON.stringify({
      success: allOk,
      target: 'external_supabase',
      results,
      hint: allOk
        ? 'Indexes applied and function replaced. Schema cache reloaded.'
        : 'One or more statements failed — check the results array.',
    }, null, 2),
    {
      status: allOk ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});

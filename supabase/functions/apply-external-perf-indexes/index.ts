const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STATEMENTS: { label: string; sql: string }[] = [
  {
    label: 'idx_wam_inst_phone_created',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_phone_created
          ON public.whatsapp_messages (instance_name, phone, created_at DESC)`,
  },
  {
    label: 'idx_wam_inst_lower',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_lower
          ON public.whatsapp_messages (LOWER(instance_name))`,
  },
  {
    label: 'idx_wam_unread',
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
    SELECT m.phone, m.instance_name, m.contact_name, m.contact_id, m.lead_id,
           m.message_text, m.created_at, m.direction, m.read_at
    FROM public.whatsapp_messages m
    WHERE LOWER(m.instance_name) IN (SELECT name FROM normalized)
      AND m.created_at > now() - interval '90 days'
  ),
  agg AS (
    SELECT b.phone, b.instance_name,
           COUNT(*) AS msg_count,
           COUNT(*) FILTER (WHERE b.direction = 'inbound' AND b.read_at IS NULL) AS unread
    FROM base b
    GROUP BY b.phone, b.instance_name
  ),
  latest AS (
    SELECT DISTINCT ON (b.phone, b.instance_name)
      b.phone, b.contact_name, b.contact_id::text AS contact_id, b.lead_id::text AS lead_id,
      b.message_text, b.created_at, b.direction, b.instance_name
    FROM base b
    ORDER BY b.phone, b.instance_name, b.created_at DESC
  )
  SELECT l.phone,
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
  LEFT JOIN agg a ON a.phone = l.phone AND a.instance_name = l.instance_name
  LEFT JOIN public.contacts c ON c.id::text = l.contact_id
  ORDER BY l.created_at DESC
$fn$;`,
  },
  {
    label: 'reload_schema_cache',
    sql: `NOTIFY pgrst, 'reload schema'`,
  },
];

const STATUS_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM pg_indexes
       WHERE schemaname='public' AND tablename='whatsapp_messages'
         AND indexname IN ('idx_wam_inst_phone_created','idx_wam_inst_lower','idx_wam_unread')) AS indexes_present,
    (SELECT pg_get_functiondef(p.oid)
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='get_conversation_summaries' LIMIT 1) AS function_def
`;

async function loadPg() {
  const mod = await import('https://deno.land/x/postgresjs@v3.4.4/mod.js');
  return mod.default;
}

async function runAll(connStr: string) {
  const postgres = await loadPg();
  const results: any[] = [];
  for (const stmt of STATEMENTS) {
    const startedAt = Date.now();
    const sql = postgres(connStr, { ssl: 'require', connect_timeout: 10, max: 1, prepare: false });
    try {
      await sql.unsafe(stmt.sql);
      results.push({ label: stmt.label, success: true, duration_ms: Date.now() - startedAt });
      console.log(`OK ${stmt.label} in ${Date.now() - startedAt}ms`);
    } catch (e: any) {
      results.push({ label: stmt.label, success: false, duration_ms: Date.now() - startedAt, error: e?.message, code: e?.code });
      console.error(`FAIL ${stmt.label}: ${e?.message}`);
    } finally {
      try { await sql.end({ timeout: 5 }); } catch (_) { /* ignore */ }
    }
  }
  console.log('FINAL_RESULTS', JSON.stringify(results));
  return results;
}

async function getStatus(connStr: string) {
  const postgres = await loadPg();
  const sql = postgres(connStr, { ssl: 'require', connect_timeout: 10, max: 1, prepare: false });
  try {
    const rows = await sql.unsafe(STATUS_QUERY);
    const row = rows?.[0] || {};
    const def: string = row.function_def || '';
    const indexes_present = Number(row.indexes_present || 0);
    const function_uses_90day_window = def.includes("interval '90 days'");
    return { indexes_present, expected_indexes: 3, function_uses_90day_window };
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (_) { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const connStr = (Deno.env.get('EXTERNAL_DB_URL') || '').trim();
  if (!connStr) {
    return new Response(JSON.stringify({ error: 'EXTERNAL_DB_URL not set' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'apply';

  if (mode === 'status') {
    try {
      const status = await getStatus(connStr);
      return new Response(JSON.stringify(status, null, 2),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // mode=apply (default): run in background, return immediately
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
  EdgeRuntime.waitUntil(runAll(connStr).catch((e) => console.error('runAll fatal', e)));
  return new Response(JSON.stringify({
    started: true,
    message: 'Applying indexes and function in background. Poll ?mode=status to verify.',
    statements: STATEMENTS.map(s => s.label),
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

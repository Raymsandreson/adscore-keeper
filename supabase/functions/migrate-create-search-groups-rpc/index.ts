// Cria RPC `search_whatsapp_groups_by_tokens` no Supabase Externo.
// Idempotente (CREATE OR REPLACE). POST {} aplica; POST { dry_run: true } só retorna o SQL.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const RPC_SQL = `
CREATE OR REPLACE FUNCTION public.search_whatsapp_groups_by_tokens(
  p_tokens text[],
  p_instance_names text[] DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE(
  group_jid text,
  contact_name text,
  instance_name text,
  last_seen timestamptz,
  message_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token text;
  v_where text := '';
BEGIN
  -- Sanitiza/normaliza tokens (sem emoji/símbolos), descarta vazios
  IF p_tokens IS NULL OR array_length(p_tokens, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      COALESCE(
        m.metadata->'chat'->>'wa_chatid',
        m.metadata->'message'->>'chatid',
        CASE WHEN m.phone ~ '^[0-9]+$' THEN m.phone || '@g.us' ELSE m.phone END
      ) AS group_jid,
      m.contact_name,
      m.instance_name,
      m.created_at
    FROM whatsapp_messages m
    WHERE m.contact_name IS NOT NULL
      AND (
        m.metadata->'chat'->>'wa_isGroup' = 'true'
        OR m.metadata->'chat'->>'wa_chatid' LIKE '%@g.us'
        OR m.metadata->'message'->>'chatid' LIKE '%@g.us'
        OR m.phone LIKE '%@g.us'
      )
      AND (p_instance_names IS NULL OR LOWER(m.instance_name) = ANY (
        SELECT LOWER(x) FROM unnest(p_instance_names) x
      ))
      AND (
        SELECT bool_and(m.contact_name ILIKE '%' || t || '%')
        FROM unnest(p_tokens) t
        WHERE length(btrim(t)) > 0
      )
  )
  SELECT
    b.group_jid,
    (array_agg(b.contact_name ORDER BY b.created_at DESC))[1] AS contact_name,
    b.instance_name,
    MAX(b.created_at) AS last_seen,
    COUNT(*)::bigint AS message_count
  FROM base b
  GROUP BY b.group_jid, b.instance_name
  ORDER BY MAX(b.created_at) DESC
  LIMIT p_limit;
END;
$$;
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.dry_run) {
      return new Response(JSON.stringify({ success: true, dry_run: true, sql: RPC_SQL }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sql = postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });
    try {
      await sql.unsafe(RPC_SQL);
      await sql.unsafe(
        `GRANT EXECUTE ON FUNCTION public.search_whatsapp_groups_by_tokens(text[], text[], int) TO authenticated, anon, service_role;`
      );
    } finally {
      await sql.end();
    }
    return new Response(JSON.stringify({ success: true, applied: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

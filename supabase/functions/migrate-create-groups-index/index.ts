// Cria tabela `whatsapp_groups_index` no Supabase Externo, faz backfill em lotes,
// cria trigger AFTER INSERT em whatsapp_messages, e reescreve a RPC
// `search_whatsapp_groups_by_tokens` para ler dessa tabela enxuta.
//
// Modes (POST body):
//   {}                 -> aplica DDL (tabela + índices + trigger + RPC). Idempotente.
//   { backfill: true } -> roda backfill em lotes (DISTINCT ON). Pode rodar várias vezes.
//   { test: true, tokens: [...] } -> chama a RPC e retorna resultado.
//   { dry_run: true }  -> só retorna o SQL.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const DDL_SQL = `
-- 1. Tabela enxuta de grupos distintos
CREATE TABLE IF NOT EXISTS public.whatsapp_groups_index (
  group_jid     text NOT NULL,
  instance_name text NOT NULL,
  contact_name  text,
  last_seen     timestamptz NOT NULL DEFAULT now(),
  message_count bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_jid, instance_name)
);

-- 2. Índices p/ busca por nome (ILIKE multi-token) e por instância
CREATE INDEX IF NOT EXISTS idx_wgi_contact_name_lower
  ON public.whatsapp_groups_index (lower(contact_name));
CREATE INDEX IF NOT EXISTS idx_wgi_instance_lower
  ON public.whatsapp_groups_index (lower(instance_name));
CREATE INDEX IF NOT EXISTS idx_wgi_last_seen
  ON public.whatsapp_groups_index (last_seen DESC);

-- 3. Função trigger: upsert quando a mensagem for de grupo
CREATE OR REPLACE FUNCTION public.upsert_whatsapp_group_index()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_jid text;
  v_is_group boolean;
BEGIN
  v_jid := COALESCE(
    NEW.metadata->'chat'->>'wa_chatid',
    NEW.metadata->'message'->>'chatid',
    CASE WHEN NEW.phone LIKE '%@g.us' THEN NEW.phone ELSE NULL END
  );
  v_is_group := (
    NEW.metadata->'chat'->>'wa_isGroup' = 'true'
    OR (v_jid IS NOT NULL AND v_jid LIKE '%@g.us')
  );

  IF NOT v_is_group OR v_jid IS NULL OR NEW.contact_name IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_groups_index AS g
    (group_jid, instance_name, contact_name, last_seen, message_count, updated_at)
  VALUES
    (v_jid, NEW.instance_name, NEW.contact_name, NEW.created_at, 1, now())
  ON CONFLICT (group_jid, instance_name) DO UPDATE
    SET contact_name  = COALESCE(EXCLUDED.contact_name, g.contact_name),
        last_seen     = GREATEST(g.last_seen, EXCLUDED.last_seen),
        message_count = g.message_count + 1,
        updated_at    = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'upsert_whatsapp_group_index skipped: %', SQLERRM;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_upsert_whatsapp_group_index ON public.whatsapp_messages;
CREATE TRIGGER trg_upsert_whatsapp_group_index
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.upsert_whatsapp_group_index();

-- 4. RPC enxuta lendo da tabela index
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
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT g.group_jid, g.contact_name, g.instance_name, g.last_seen, g.message_count
  FROM public.whatsapp_groups_index g
  WHERE g.contact_name IS NOT NULL
    AND (p_instance_names IS NULL OR lower(g.instance_name) = ANY (
      SELECT lower(x) FROM unnest(p_instance_names) x
    ))
    AND (
      p_tokens IS NULL
      OR (
        SELECT bool_and(g.contact_name ILIKE '%' || t || '%')
        FROM unnest(p_tokens) t
        WHERE length(btrim(t)) > 0
      )
    )
  ORDER BY g.last_seen DESC
  LIMIT p_limit;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_whatsapp_groups_by_tokens(text[], text[], int)
  TO authenticated, anon, service_role;
`;

// Backfill em lotes por created_at — evita statement_timeout
const BACKFILL_BATCH_SQL = `
WITH src AS (
  SELECT
    COALESCE(
      m.metadata->'chat'->>'wa_chatid',
      m.metadata->'message'->>'chatid',
      CASE WHEN m.phone LIKE '%@g.us' THEN m.phone ELSE NULL END
    ) AS group_jid,
    m.instance_name,
    m.contact_name,
    m.created_at
  FROM public.whatsapp_messages m
  WHERE m.created_at >= $1 AND m.created_at < $2
    AND m.contact_name IS NOT NULL
    AND (
      m.metadata->'chat'->>'wa_isGroup' = 'true'
      OR m.metadata->'chat'->>'wa_chatid' LIKE '%@g.us'
      OR m.metadata->'message'->>'chatid' LIKE '%@g.us'
      OR m.phone LIKE '%@g.us'
    )
),
agg AS (
  SELECT group_jid, instance_name,
         (array_agg(contact_name ORDER BY created_at DESC))[1] AS contact_name,
         MAX(created_at) AS last_seen,
         COUNT(*)::bigint AS message_count
  FROM src
  WHERE group_jid IS NOT NULL
  GROUP BY group_jid, instance_name
)
INSERT INTO public.whatsapp_groups_index AS g
  (group_jid, instance_name, contact_name, last_seen, message_count, updated_at)
SELECT group_jid, instance_name, contact_name, last_seen, message_count, now()
FROM agg
ON CONFLICT (group_jid, instance_name) DO UPDATE
  SET contact_name  = COALESCE(EXCLUDED.contact_name, g.contact_name),
      last_seen     = GREATEST(g.last_seen, EXCLUDED.last_seen),
      message_count = g.message_count + EXCLUDED.message_count,
      updated_at    = now()
RETURNING 1;
`;

async function runBackfill(sql: any, daysBack = 90, stepDays = 3) {
  const results: any[] = [];
  const now = new Date();
  for (let offset = 0; offset < daysBack; offset += stepDays) {
    const end = new Date(now.getTime() - offset * 86400_000);
    const start = new Date(end.getTime() - stepDays * 86400_000);
    const t0 = Date.now();
    try {
      const rows = await sql.unsafe(BACKFILL_BATCH_SQL, [start.toISOString(), end.toISOString()]);
      results.push({
        window: [start.toISOString(), end.toISOString()],
        upserts: rows.length,
        ms: Date.now() - t0,
      });
    } catch (e: any) {
      results.push({
        window: [start.toISOString(), end.toISOString()],
        error: String(e?.message || e),
        ms: Date.now() - t0,
      });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.dry_run) {
      return new Response(JSON.stringify({ success: true, dry_run: true, sql: DDL_SQL }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sql = postgres(EXTERNAL_DB_URL, {
      max: 1, idle_timeout: 20, prepare: false, connect_timeout: 10,
    });
    try {
      if (body.test) {
        const tokens: string[] = body.tokens || ["prev", "372"];
        const limit: number = body.limit || 20;
        const rows = await sql`
          SELECT group_jid, contact_name, instance_name, last_seen, message_count
          FROM public.search_whatsapp_groups_by_tokens(${tokens}::text[], NULL, ${limit}::int)
        `;
        return new Response(JSON.stringify({ success: true, test: true, tokens, count: rows.length, rows }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (body.backfill) {
        const days = body.days_back ?? 90;
        const step = body.step_days ?? 3;
        const batches = await runBackfill(sql, days, step);
        const total = batches.reduce((acc, b) => acc + (b.upserts || 0), 0);
        const countRow = await sql`SELECT COUNT(*)::bigint AS n FROM public.whatsapp_groups_index`;
        return new Response(JSON.stringify({
          success: true, backfill: true, total_upserts: total,
          table_rows: Number(countRow[0]?.n || 0), batches,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Default: aplica DDL
      await sql.unsafe(DDL_SQL);
      const countRow = await sql`SELECT COUNT(*)::bigint AS n FROM public.whatsapp_groups_index`;
      return new Response(JSON.stringify({
        success: true, applied: true,
        table_rows: Number(countRow[0]?.n || 0),
        next_step: "POST { \"backfill\": true } para popular a tabela com histórico.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } finally {
      await sql.end();
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

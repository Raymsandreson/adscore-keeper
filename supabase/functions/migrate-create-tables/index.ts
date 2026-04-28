// Cria schema (CREATE TABLE + indexes + triggers + RLS) das tabelas Cloud-only no Externo,
// extraindo DDL do Cloud via pg_catalog (conexão direta postgres) e aplicando no Externo idem.
//
// POST { tables?: string[], table?: string, dry_run?: boolean }
// POST { list_default: true }  -> retorna lista padrão das 18 tabelas-alvo

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const DEFAULT_TABLES = [
  "field_variable_aliases", "agent_reply_locks",
  "team_messages", "team_conversations", "team_conversation_members",
  "whatsapp_groups_cache", "whatsapp_muted_chats", "lead_group_audit_log",
  "instance_connection_log", "campaign_status_log", "access_profiles",
  "agent_group_redirections", "agent_filter_settings", "meta_ad_accounts",
  "adset_geo_rules", "process_documents", "onboarding_meeting_configs",
  "activity_message_templates",
  "team_chat_messages", "team_chat_mentions",
];

interface ExtractedDDL {
  ddl: string;
  hasUpdatedAt: boolean;
  indexes: string[];
}

// Extrai DDL completo via conexão direta no Cloud
async function extractDDL(cloudSql: any, tableName: string): Promise<ExtractedDDL> {
  // 1) Colunas com formato/default
  const cols = await cloudSql`
    SELECT 
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ('public.' || ${tableName})::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `;

  if (!cols || cols.length === 0) {
    throw new Error(`No columns found for ${tableName}`);
  }

  // 2) Primary key
  const pk = await cloudSql`
    SELECT a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = ('public.' || ${tableName})::regclass
      AND c.contype = 'p'
    ORDER BY array_position(c.conkey, a.attnum)
  `;
  const pkCols: string[] = pk.map((r: any) => r.column_name);

  // 3) Build CREATE TABLE
  let hasUpdatedAt = false;
  const colDefs: string[] = [];
  for (const c of cols) {
    if (c.column_name === "updated_at") hasUpdatedAt = true;
    let line = `  "${c.column_name}" ${c.data_type}`;
    if (c.default_expr) line += ` DEFAULT ${c.default_expr}`;
    if (c.not_null) line += ` NOT NULL`;
    colDefs.push(line);
  }
  if (pkCols.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(", ")})`);
  }

  const ddl = `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(",\n")}\n);`;

  // 4) Indexes (excluindo PK que já vem no CREATE TABLE)
  const idx = await cloudSql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ${tableName}
      AND indexname NOT IN (
        SELECT conname FROM pg_constraint 
        WHERE conrelid = ('public.' || ${tableName})::regclass AND contype = 'p'
      )
  `;
  const indexes: string[] = idx.map((r: any) => 
    r.indexdef.replace(/^CREATE /i, "CREATE ").replace(/INDEX (\w+)/i, "INDEX IF NOT EXISTS $1")
  );

  return { ddl, hasUpdatedAt, indexes };
}

function buildAuxDDL(tableName: string, hasUpdatedAt: boolean): string[] {
  const stmts: string[] = [];
  stmts.push(`ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;`);
  stmts.push(`DROP POLICY IF EXISTS "${tableName}_authenticated_all" ON public."${tableName}";`);
  stmts.push(`CREATE POLICY "${tableName}_authenticated_all" ON public."${tableName}" FOR ALL TO authenticated USING (true) WITH CHECK (true);`);

  if (hasUpdatedAt) {
    stmts.push(`DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON public."${tableName}";`);
    stmts.push(`CREATE TRIGGER update_${tableName}_updated_at BEFORE UPDATE ON public."${tableName}" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();`);
  }

  if (tableName === "agent_reply_locks") {
    stmts.push(`
CREATE OR REPLACE FUNCTION public.cleanup_expired_reply_locks() 
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.agent_reply_locks WHERE expires_at < now();
  RETURN NEW;
END;
$$;`);
    stmts.push(`DROP TRIGGER IF EXISTS cleanup_locks_trigger ON public.agent_reply_locks;`);
    stmts.push(`CREATE TRIGGER cleanup_locks_trigger BEFORE INSERT ON public.agent_reply_locks FOR EACH ROW EXECUTE FUNCTION public.cleanup_expired_reply_locks();`);
  }

  return stmts;
}

async function ensureUpdatedAtFunction(sql: any): Promise<void> {
  await sql.unsafe(`
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
  `);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.list_default) {
      return new Response(JSON.stringify({ success: true, tables: DEFAULT_TABLES }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tables: string[] = body.tables || (body.table ? [body.table] : DEFAULT_TABLES);
    const dryRun = !!body.dry_run;

    const cloudSql = postgres(CLOUD_DB_URL, { max: 1, idle_timeout: 20, prepare: false });
    const extSql = dryRun ? null : postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });

    const results: any[] = [];
    try {
      if (!dryRun && extSql) await ensureUpdatedAtFunction(extSql);

      for (const tableName of tables) {
        const r: any = { table: tableName, ddl: "", indexes: [] as string[], aux_count: 0, applied: false, errors: [] as string[] };

        try {
          const { ddl, hasUpdatedAt, indexes } = await extractDDL(cloudSql, tableName);
          r.ddl = ddl;
          r.indexes = indexes;
          const aux = buildAuxDDL(tableName, hasUpdatedAt);
          r.aux_count = aux.length;

          if (dryRun) {
            r.aux_preview = aux;
            results.push(r);
            continue;
          }

          if (extSql) {
            try {
              await extSql.unsafe(ddl);
              for (const idxStmt of indexes) {
                try { await extSql.unsafe(idxStmt); } 
                catch (e: any) { r.errors.push(`index: ${String(e?.message || e).slice(0, 200)}`); }
              }
              for (const stmt of aux) {
                try { await extSql.unsafe(stmt); } 
                catch (e: any) { r.errors.push(`aux: ${String(e?.message || e).slice(0, 200)}`); }
              }
              r.applied = true;
            } catch (e: any) {
              r.errors.push(`create: ${String(e?.message || e).slice(0, 200)}`);
            }
          }
        } catch (e: any) {
          r.errors.push(`extract: ${String(e?.message || e).slice(0, 200)}`);
        }

        results.push(r);
      }
    } finally {
      await cloudSql.end();
      if (extSql) await extSql.end();
    }

    return new Response(JSON.stringify({ success: true, dry_run: dryRun, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

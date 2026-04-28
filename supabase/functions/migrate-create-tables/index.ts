// Cria schema (CREATE TABLE + indexes + triggers + RLS) das tabelas Cloud-only no Externo,
// extraindo DDL do Cloud via information_schema/pg_catalog e aplicando no Externo via postgres direto.
//
// POST { tables: string[], dry_run?: boolean }
//   -> retorna { results: [{table, ddl, applied, errors}] }
// POST { table: string, dry_run?: boolean }  (atalho single-table)
// POST { list_default: true }  -> retorna lista padrão das 18 tabelas-alvo

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });

const DEFAULT_TABLES = [
  "field_variable_aliases", "agent_reply_locks",
  "team_messages", "team_conversations", "team_conversation_members",
  "whatsapp_groups_cache", "whatsapp_muted_chats", "lead_group_audit_log",
  "instance_connection_log", "campaign_status_log", "access_profiles",
  "agent_group_redirections", "agent_filter_settings", "meta_ad_accounts",
  "adset_geo_rules", "process_documents", "onboarding_meeting_configs",
  "activity_message_templates",
];

// Extrai DDL via SQL no Cloud usando uma sequência de queries em information_schema
async function extractDDL(tableName: string): Promise<{ ddl: string; hasUpdatedAt: boolean; errors: string[] }> {
  const errors: string[] = [];
  let hasUpdatedAt = false;

  // 1) Colunas
  const { data: cols, error: colErr } = await cloud
    .schema("information_schema" as any)
    .from("columns" as any)
    .select("column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale")
    .eq("table_schema", "public")
    .eq("table_name", tableName)
    .order("ordinal_position", { ascending: true });

  if (colErr || !cols || cols.length === 0) {
    return { ddl: "", hasUpdatedAt: false, errors: [`columns: ${colErr?.message || "no columns found"}`] };
  }

  // 2) Primary key
  // PostgREST não permite query direta em pg_catalog facilmente; usamos um approach: tentar via tc/kcu em information_schema
  const { data: pkRows } = await cloud
    .schema("information_schema" as any)
    .from("table_constraints" as any)
    .select("constraint_name, constraint_type")
    .eq("table_schema", "public")
    .eq("table_name", tableName)
    .eq("constraint_type", "PRIMARY KEY");

  let pkColumns: string[] = [];
  if (pkRows && pkRows.length > 0) {
    const pkName = (pkRows[0] as any).constraint_name;
    const { data: pkCols } = await cloud
      .schema("information_schema" as any)
      .from("key_column_usage" as any)
      .select("column_name, ordinal_position")
      .eq("table_schema", "public")
      .eq("table_name", tableName)
      .eq("constraint_name", pkName)
      .order("ordinal_position", { ascending: true });
    pkColumns = (pkCols || []).map((r: any) => r.column_name);
  }

  // 3) Build CREATE TABLE
  const colDefs: string[] = [];
  for (const c of cols as any[]) {
    if (c.column_name === "updated_at") hasUpdatedAt = true;

    let typeStr = c.data_type;
    // Mapeia para tipo nativo Postgres correto
    if (c.data_type === "USER-DEFINED" || c.data_type === "ARRAY") {
      typeStr = c.udt_name === "_text" ? "text[]" : (c.udt_name || c.data_type);
    } else if (c.data_type === "character varying") {
      typeStr = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "text";
    } else if (c.data_type === "timestamp with time zone") {
      typeStr = "timestamptz";
    } else if (c.data_type === "timestamp without time zone") {
      typeStr = "timestamp";
    } else if (c.data_type === "numeric" && c.numeric_precision) {
      typeStr = `numeric(${c.numeric_precision},${c.numeric_scale || 0})`;
    }

    let line = `  "${c.column_name}" ${typeStr}`;
    if (c.column_default !== null && c.column_default !== undefined) {
      line += ` DEFAULT ${c.column_default}`;
    }
    if (c.is_nullable === "NO") {
      line += ` NOT NULL`;
    }
    colDefs.push(line);
  }

  if (pkColumns.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkColumns.map((c) => `"${c}"`).join(", ")})`);
  }

  const ddl = `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(",\n")}\n);`;
  return { ddl, hasUpdatedAt, errors };
}

function buildAuxDDL(tableName: string, hasUpdatedAt: boolean): string[] {
  const stmts: string[] = [];

  // RLS aberta para authenticated (escolha do usuário)
  stmts.push(`ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;`);
  stmts.push(`DROP POLICY IF EXISTS "${tableName}_authenticated_all" ON public."${tableName}";`);
  stmts.push(`CREATE POLICY "${tableName}_authenticated_all" ON public."${tableName}" FOR ALL TO authenticated USING (true) WITH CHECK (true);`);

  // Trigger updated_at se aplicável
  if (hasUpdatedAt) {
    stmts.push(`DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON public."${tableName}";`);
    stmts.push(`CREATE TRIGGER update_${tableName}_updated_at BEFORE UPDATE ON public."${tableName}" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();`);
  }

  // Trigger especial para agent_reply_locks
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

    // Conecta no Externo via postgres direto
    const sql = postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });

    const results: any[] = [];
    try {
      if (!dryRun) await ensureUpdatedAtFunction(sql);

      for (const tableName of tables) {
        const r: any = { table: tableName, ddl: "", aux_count: 0, applied: false, errors: [] as string[] };

        const { ddl, hasUpdatedAt, errors } = await extractDDL(tableName);
        if (errors.length > 0) {
          r.errors.push(...errors);
          results.push(r);
          continue;
        }
        r.ddl = ddl;
        const aux = buildAuxDDL(tableName, hasUpdatedAt);
        r.aux_count = aux.length;

        if (dryRun) {
          r.aux_preview = aux;
          results.push(r);
          continue;
        }

        try {
          await sql.unsafe(ddl);
          for (const stmt of aux) {
            try {
              await sql.unsafe(stmt);
            } catch (e: any) {
              r.errors.push(`aux: ${String(e?.message || e).slice(0, 200)}`);
            }
          }
          r.applied = true;
        } catch (e: any) {
          r.errors.push(`create: ${String(e?.message || e).slice(0, 200)}`);
        }

        results.push(r);
      }
    } finally {
      await sql.end();
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

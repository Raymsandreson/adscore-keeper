// Copia dados das tabelas Cloud → Externo via conexão postgres direta.
// POST { tables?: string[], table?: string, truncate_first?: boolean, batch_size?: number }

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const DEFAULT_TABLES = [
  "access_profiles",
  "activity_message_templates",
  "adset_geo_rules",
  "agent_filter_settings",
  "agent_group_redirections",
  "campaign_status_log",
  "instance_connection_log",
  "lead_group_audit_log",
  "meta_ad_accounts",
  "onboarding_meeting_configs",
  "process_documents",
  "team_conversations",        // pais antes de filhas
  "team_conversation_members",
  "team_messages",
  "team_chat_messages",
  "team_chat_mentions",
  "whatsapp_groups_cache",
  "whatsapp_muted_chats",
];

async function getColumns(sql: any, tableName: string): Promise<string[]> {
  const cols = await sql`
    SELECT a.attname AS column_name
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || ${tableName})::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `;
  return cols.map((r: any) => r.column_name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tables: string[] = body.tables || (body.table ? [body.table] : DEFAULT_TABLES);
    const truncateFirst = body.truncate_first !== false; // default true
    const batchSize = Number(body.batch_size || 200);

    const cloudSql = postgres(CLOUD_DB_URL, { max: 1, idle_timeout: 20, prepare: false });
    const extSql = postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });

    const results: any[] = [];

    try {
      for (const tableName of tables) {
        const r: any = { table: tableName, source_rows: 0, copied: 0, errors: [] as string[] };
        try {
          const cols = await getColumns(cloudSql, tableName);
          if (cols.length === 0) {
            r.errors.push("no columns");
            results.push(r);
            continue;
          }

          // Read all from Cloud
          const colsList = cols.map((c) => `"${c}"`).join(", ");
          const rows = await cloudSql.unsafe(`SELECT ${colsList} FROM public."${tableName}"`);
          r.source_rows = rows.length;

          if (truncateFirst) {
            try {
              await extSql.unsafe(`TRUNCATE TABLE public."${tableName}" RESTART IDENTITY CASCADE`);
            } catch (e: any) {
              r.errors.push(`truncate: ${String(e?.message || e).slice(0, 200)}`);
            }
          }

          if (rows.length === 0) {
            results.push(r);
            continue;
          }

          // Batch insert
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const placeholders: string[] = [];
            const values: any[] = [];
            let idx = 1;
            for (const row of batch) {
              const ph = cols.map(() => `$${idx++}`).join(", ");
              placeholders.push(`(${ph})`);
              for (const c of cols) values.push((row as any)[c]);
            }
            const stmt = `INSERT INTO public."${tableName}" (${colsList}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
            try {
              await extSql.unsafe(stmt, values);
              r.copied += batch.length;
            } catch (e: any) {
              r.errors.push(`batch@${i}: ${String(e?.message || e).slice(0, 300)}`);
            }
          }
        } catch (e: any) {
          r.errors.push(`fatal: ${String(e?.message || e).slice(0, 300)}`);
        }
        results.push(r);
      }
    } finally {
      await cloudSql.end();
      await extSql.end();
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

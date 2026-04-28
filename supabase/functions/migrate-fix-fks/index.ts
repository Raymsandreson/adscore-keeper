// Drop FKs em tabelas migradas no Externo que apontam para auth.users
// (Externo usa anonymous sessions; a FK não agrega segurança e bloqueia copy).
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTERNAL_DB_URL = Deno.env.get("EXTERNAL_DB_URL")!;

const TABLES = [
  "team_chat_messages",
  "team_chat_mentions",
  "team_messages",
  "team_conversations",
  "team_conversation_members",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sql = postgres(EXTERNAL_DB_URL, { max: 1, idle_timeout: 20, prepare: false });
  const results: any[] = [];
  try {
    for (const table of TABLES) {
      const r: any = { table, dropped: [] as string[], errors: [] as string[] };
      try {
        const fks = await sql`
          SELECT conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname = ${table}
            AND c.contype = 'f'
        `;
        for (const row of fks) {
          try {
            await sql.unsafe(`ALTER TABLE public."${table}" DROP CONSTRAINT IF EXISTS "${row.conname}"`);
            r.dropped.push(row.conname);
          } catch (e: any) {
            r.errors.push(`${row.conname}: ${String(e?.message || e).slice(0, 200)}`);
          }
        }
      } catch (e: any) {
        r.errors.push(`fatal: ${String(e?.message || e).slice(0, 200)}`);
      }
      results.push(r);
    }
  } finally {
    await sql.end();
  }
  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

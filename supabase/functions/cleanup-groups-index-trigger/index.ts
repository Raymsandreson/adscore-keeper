// One-off cleanup: drop trigger + function de upsert via whatsapp_messages.
// Mantém a tabela whatsapp_groups_index e a RPC search_whatsapp_groups_by_tokens.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SQL = `
DROP TRIGGER IF EXISTS trg_upsert_whatsapp_group_index ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS public.upsert_whatsapp_group_index();
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sql = postgres(Deno.env.get("EXTERNAL_DB_URL")!, {
    max: 1, prepare: false, connect_timeout: 10,
  });
  try {
    await sql.unsafe(SQL);
    return new Response(JSON.stringify({ success: true, dropped: ["trigger", "function"] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});

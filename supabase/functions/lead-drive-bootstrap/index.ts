// One-shot: cria tabela lead_drive_folders no banco externo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Conecta direto via postgres connection string do externo
    const dbUrl = Deno.env.get("EXTERNAL_DB_URL");
    if (!dbUrl) throw new Error("EXTERNAL_DB_URL missing");

    const { Client } = await import("https://deno.land/x/postgres@v0.17.0/mod.ts");
    const client = new Client(dbUrl);
    await client.connect();

    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS public.lead_drive_folders (
        lead_id uuid PRIMARY KEY,
        folder_id text NOT NULL,
        folder_name text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.queryArray(`ALTER TABLE public.lead_drive_folders ENABLE ROW LEVEL SECURITY;`);
    await client.queryArray(`
      DROP POLICY IF EXISTS "auth read drive folders" ON public.lead_drive_folders;
      CREATE POLICY "auth read drive folders" ON public.lead_drive_folders FOR SELECT TO authenticated USING (true);
    `);
    await client.end();

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

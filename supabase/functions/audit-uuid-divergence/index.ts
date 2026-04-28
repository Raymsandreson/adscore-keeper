// Audita refs no External usando lista pré-carregada de divergências.
// Input: { divergent: [{ email, cloud_id, ext_id }, ...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ext = createClient(
  Deno.env.get("EXTERNAL_SUPABASE_URL")!,
  Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TARGETS: Array<{ table: string; col: string }> = [
  { table: "contacts", col: "created_by" },
  { table: "leads", col: "created_by" },
  { table: "leads", col: "assigned_to" },
  { table: "lead_activities", col: "created_by" },
  { table: "lead_activities", col: "assigned_to" },
  { table: "profiles", col: "user_id" },
  { table: "user_roles", col: "user_id" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { divergent } = await req.json();
    if (!Array.isArray(divergent)) {
      return new Response(JSON.stringify({ success: false, error: "divergent[] required" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const cloudIds = divergent.map((d: any) => d.cloud_id);
    const extIds = divergent.map((d: any) => d.ext_id);

    const totals: Record<string, { cloud: number; ext: number; error?: string }> = {};
    for (const t of TARGETS) {
      try {
        const { count: cCloud } = await ext
          .from(t.table)
          .select("*", { count: "exact", head: true })
          .in(t.col, cloudIds);
        const { count: cExt } = await ext
          .from(t.table)
          .select("*", { count: "exact", head: true })
          .in(t.col, extIds);
        totals[`${t.table}.${t.col}`] = { cloud: cCloud || 0, ext: cExt || 0 };
      } catch (e) {
        totals[`${t.table}.${t.col}`] = { cloud: 0, ext: 0, error: String(e).slice(0, 100) };
      }
    }

    return new Response(JSON.stringify({ success: true, totals_by_column: totals }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

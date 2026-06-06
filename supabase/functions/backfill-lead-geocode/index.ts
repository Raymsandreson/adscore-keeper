// Backfill lead_lat/lead_lng usando Google Maps Geocoding via Connector Gateway.
// Roda em lotes (batchSize) por invocação. POST { batchSize?: number } -> processa esse lote.
// Retorna contagens e se ainda há leads pendentes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return json({ success: false, error: "Missing Google Maps gateway credentials" });
    }
    if (!EXT_URL || !EXT_KEY) {
      return json({ success: false, error: "Missing External Supabase credentials" });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body.batchSize) || 100, 1), 200);

    const db = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

    const { data: leads, error } = await db
      .from("leads")
      .select("id, city, state")
      .is("lead_lat", null)
      .is("deleted_at", null)
      .not("city", "is", null)
      .neq("city", "")
      .limit(batchSize);

    if (error) return json({ success: false, error: error.message });
    if (!leads || leads.length === 0) {
      const { count } = await db.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).not("city", "is", null).neq("city", "");
      return json({ success: true, done: true, processed: 0, totalWithCity: count ?? 0 });
    }

    let ok = 0, fail = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      try {
        const address = [lead.city, lead.state, "Brasil"].filter(Boolean).join(", ");
        const url = `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=br&language=pt-BR`;
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          },
        });
        const data = await r.json();
        const loc = data?.results?.[0]?.geometry?.location;
        if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
          const { error: upErr } = await db
            .from("leads")
            .update({ lead_lat: loc.lat, lead_lng: loc.lng, geocoded_at: new Date().toISOString() })
            .eq("id", lead.id);
          if (upErr) { fail++; errors.push(`update ${lead.id}: ${upErr.message}`); }
          else ok++;
        } else {
          fail++;
          if (errors.length < 5) errors.push(`no result for "${address}" (status=${data?.status})`);
        }
      } catch (e: any) {
        fail++;
        if (errors.length < 5) errors.push(`${lead.id}: ${e.message}`);
      }
    }

    const { count: pending } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("lead_lat", null)
      .is("deleted_at", null)
      .not("city", "is", null)
      .neq("city", "");

    return json({ success: true, processed: leads.length, ok, fail, pending: pending ?? 0, errors });
  } catch (e: any) {
    return json({ success: false, error: e.message });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

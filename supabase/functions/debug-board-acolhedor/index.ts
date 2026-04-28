import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const supabase = createClient(url, key);

    // Use a SQL function to list public tables -- but external db: try a direct rpc
    // Easier: call from system catalogs via a raw RPC isn't available. Instead, fetch known list via PostgREST-discovery
    const resp = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const tables: string[] = [];
    if (resp.ok) {
      const json: any = await resp.json();
      if (json?.paths) {
        Object.keys(json.paths).forEach((p) => {
          const m = p.match(/^\/([a-z0-9_]+)$/i);
          if (m) tables.push(m[1]);
        });
      } else if (json?.definitions) {
        Object.keys(json.definitions).forEach((t: string) => tables.push(t));
      }
    }

    return new Response(JSON.stringify({ count: tables.length, tables }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

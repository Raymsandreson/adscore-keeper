import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: instances, error } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url, is_active")
      .eq("is_active", true);

    if (error) throw error;

    // UazAPI /status endpoint is a server health check that round-robins instances.
    // Each call checks ONE random instance. We collect all results and map them back.
    const rawResults = await Promise.all(
      (instances || []).map(async (inst) => {
        if (!inst.instance_token) {
          return { id: inst.id, instance_name: inst.instance_name, checked_name: null, checked_status: null };
        }
        try {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          const resp = await fetch(`${baseUrl}/status?token=${inst.instance_token}`, {
            signal: AbortSignal.timeout(8000),
          });
          const data = await resp.json();
          const ci = data?.status?.checked_instance || data?.checked_instance;
          return {
            id: inst.id,
            instance_name: inst.instance_name,
            checked_name: ci?.name || null,
            checked_status: ci?.connection_status?.toLowerCase() || null,
          };
        } catch {
          return { id: inst.id, instance_name: inst.instance_name, checked_name: null, checked_status: null };
        }
      })
    );

    // Build map: instance_name → connection_status from round-robin results
    const statusMap: Record<string, string> = {};
    for (const r of rawResults) {
      if (r.checked_name && r.checked_status) {
        statusMap[r.checked_name.toLowerCase()] = r.checked_status;
      }
    }

    const results = (instances || []).map(inst => {
      const status = statusMap[inst.instance_name.toLowerCase()];
      return {
        id: inst.id,
        instance_name: inst.instance_name,
        connected: status === "connected",
        status_raw: status || "unknown",
      };
    });

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

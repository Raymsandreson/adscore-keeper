import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const results = await Promise.all(
      (instances || []).map(async (inst) => {
        try {
          const url = `${inst.base_url}/status?token=${inst.instance_token}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          const data = await resp.json();
          // UazAPI returns connected status in various formats
          const connected =
            data?.connected === true ||
            data?.status === "CONNECTED" ||
            data?.state === "CONNECTED" ||
            data?.instance?.state === "CONNECTED" ||
            (typeof data?.status === "string" && data.status.toUpperCase().includes("CONNECTED"));
          return {
            id: inst.id,
            instance_name: inst.instance_name,
            connected,
            status_raw: data?.status || data?.state || data?.instance?.state || null,
          };
        } catch {
          return {
            id: inst.id,
            instance_name: inst.instance_name,
            connected: false,
            status_raw: "TIMEOUT",
          };
        }
      })
    );

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

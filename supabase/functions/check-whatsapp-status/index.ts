import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: instances, error } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url, is_active, owner_phone")
      .eq("is_active", true);

    if (error) throw error;

    // Check status with a short timeout per instance
    const results = await Promise.all(
      (instances || []).map(async (inst) => {
        if (!inst.instance_token) {
          console.log(`[${inst.instance_name}] No token, skipping`);
          return { id: inst.id, instance_name: inst.instance_name, connected: false, status_raw: "no_token", owner_phone: inst.owner_phone || null };
        }
        try {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          const resp = await fetch(`${baseUrl}/instance/status`, {
            headers: { "token": inst.instance_token },
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) {
            console.log(`[${inst.instance_name}] API returned ${resp.status}`);
            return { id: inst.id, instance_name: inst.instance_name, connected: false, status_raw: "api_error", owner_phone: inst.owner_phone || null };
          }
          const data = await resp.json();
          const instanceData = data?.instance;
          const connectionStatus = instanceData?.status?.toLowerCase() || "unknown";
          
          console.log(`[${inst.instance_name}] API name="${instanceData?.name}" status="${connectionStatus}"`);

          // Extract and auto-save owner phone
          const ownerPhone = instanceData?.owner || null;
          if (ownerPhone && ownerPhone !== inst.owner_phone) {
            const cleanPhone = ownerPhone.replace(/\D/g, '');
            if (cleanPhone.length >= 10) {
              await supabase
                .from("whatsapp_instances")
                .update({ owner_phone: cleanPhone })
                .eq("id", inst.id);
              console.log(`Auto-saved owner_phone ${cleanPhone} for ${inst.instance_name}`);
            }
          }

          return {
            id: inst.id,
            instance_name: inst.instance_name,
            connected: connectionStatus === "connected",
            status_raw: connectionStatus,
            owner_phone: ownerPhone?.replace(/\D/g, '') || inst.owner_phone || null,
          };
        } catch (err) {
          console.log(`[${inst.instance_name}] Error: ${err?.message || err}`);
          return { id: inst.id, instance_name: inst.instance_name, connected: false, status_raw: "error", owner_phone: inst.owner_phone || null };
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

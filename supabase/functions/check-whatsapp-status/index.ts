import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
      .select("id, instance_name, instance_token, base_url, is_active, owner_phone")
      .eq("is_active", true);

    if (error) throw error;

    // Check status with a short timeout per instance
    const rawResults = await Promise.all(
      (instances || []).map(async (inst) => {
        if (!inst.instance_token) {
          return { id: inst.id, instance_name: inst.instance_name, checked_name: null, checked_status: null, owner_phone: inst.owner_phone };
        }
        try {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          const resp = await fetch(`${baseUrl}/status`, {
            headers: { "token": inst.instance_token },
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) {
            return { id: inst.id, instance_name: inst.instance_name, checked_name: null, checked_status: null, owner_phone: inst.owner_phone };
          }
          const data = await resp.json();
          const ci = data?.status?.checked_instance || data?.checked_instance;
          
          // Extract owner phone from the status response
          // UazAPI returns owner/phone in various formats
          const ownerPhone = ci?.owner || data?.owner || data?.status?.owner || null;
          
          // Auto-save owner_phone if we got one and it's different from stored
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
            checked_name: ci?.name || null,
            checked_status: ci?.connection_status?.toLowerCase() || null,
            owner_phone: ownerPhone?.replace(/\D/g, '') || inst.owner_phone,
          };
        } catch {
          return { id: inst.id, instance_name: inst.instance_name, checked_name: null, checked_status: null, owner_phone: inst.owner_phone };
        }
      })
    );

    const statusMap: Record<string, { status: string; owner_phone: string | null }> = {};
    for (const r of rawResults) {
      if (r.checked_name && r.checked_status) {
        statusMap[r.checked_name.toLowerCase()] = { 
          status: r.checked_status,
          owner_phone: r.owner_phone,
        };
      }
    }

    const results = (instances || []).map(inst => {
      const entry = statusMap[inst.instance_name.toLowerCase()];
      return {
        id: inst.id,
        instance_name: inst.instance_name,
        connected: entry?.status === "connected",
        status_raw: entry?.status || "unknown",
        owner_phone: entry?.owner_phone || inst.owner_phone || null,
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

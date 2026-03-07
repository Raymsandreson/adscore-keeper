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

    const { instance_id, action } = await req.json();
    // action: "restart" | "qr"

    if (!instance_id) {
      return new Response(JSON.stringify({ error: "instance_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inst, error } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url")
      .eq("id", instance_id)
      .single();

    if (error || !inst) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = inst.base_url || "https://abraci.uazapi.com";
    const token = inst.instance_token;

    if (!token) {
      return new Response(JSON.stringify({ error: "Instance has no token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "restart") {
      // Call UazAPI restart endpoint
      const resp = await fetch(`${baseUrl}/restart?token=${token}`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => ({}));
      
      return new Response(JSON.stringify({ 
        success: true, 
        action: "restart",
        message: "Restart solicitado. Aguarde alguns segundos e verifique o status.",
        data 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qr") {
      // Get QR code from UazAPI
      const resp = await fetch(`${baseUrl}/qrcode?token=${token}`, {
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => ({}));
      
      // UazAPI typically returns { qrcode: "base64..." } or { qr: "base64..." }
      const qrCode = data?.qrcode || data?.qr || data?.value || null;
      
      return new Response(JSON.stringify({ 
        success: true, 
        action: "qr",
        qrCode,
        raw: data,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'restart' or 'qr'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

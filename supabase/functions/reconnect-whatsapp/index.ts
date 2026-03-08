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

    const headers = {
      "Content-Type": "application/json",
      "token": token,
    };

    if (action === "restart") {
      // UazAPI V2: restart via header token
      const resp = await fetch(`${baseUrl}/restart`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const data = await resp.json().catch(() => ({}));
      console.log("Restart response:", resp.status, JSON.stringify(data));

      return new Response(JSON.stringify({
        success: true,
        action: "restart",
        message: "Restart solicitado. Aguarde alguns segundos.",
        data,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "qr") {
      // Try multiple known QR code endpoints for UazAPI V2
      const qrEndpoints = [
        { url: `${baseUrl}/qrcode`, method: "GET" },
        { url: `${baseUrl}/v1/instance/qr`, method: "GET" },
        { url: `${baseUrl}/status`, method: "GET" },
      ];

      let qrCode = null;
      let rawData = null;

      for (const ep of qrEndpoints) {
        try {
          console.log(`Trying QR endpoint: ${ep.url}`);
          const resp = await fetch(ep.url, {
            method: ep.method,
            headers,
            signal: AbortSignal.timeout(10000),
          });

          if (!resp.ok) {
            console.log(`QR endpoint ${ep.url} returned ${resp.status}`);
            continue;
          }

          const data = await resp.json().catch(() => null);
          if (!data) continue;

          rawData = data;
          console.log(`QR endpoint ${ep.url} response keys:`, Object.keys(data));

          // Extract QR from various possible response structures
          qrCode = data?.qrcode ||
            data?.qr ||
            data?.value ||
            data?.qr_code ||
            data?.base64 ||
            data?.status?.qr ||
            data?.status?.qrcode ||
            data?.data?.qrcode ||
            null;

          if (qrCode) {
            console.log(`QR code found from endpoint: ${ep.url}`);
            break;
          }

          // Check if status shows we need QR (disconnected state)
          const connStatus = data?.status?.checked_instance?.connection_status?.toLowerCase();
          if (connStatus === "connected") {
            return new Response(JSON.stringify({
              success: true,
              action: "qr",
              qrCode: null,
              already_connected: true,
              message: "Instância já está conectada!",
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.log(`QR endpoint ${ep.url} error:`, e.message);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        action: "qr",
        qrCode,
        raw: rawData,
        message: qrCode ? "QR Code obtido" : "QR Code não disponível. A instância pode precisar ser reiniciada primeiro.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'restart' or 'qr'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Reconnect error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

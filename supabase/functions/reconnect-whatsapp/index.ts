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
      .select("id, instance_name, instance_token, base_url, owner_phone")
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
      // UazAPI V2: restart instance
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

    if (action === "connect" || action === "qr") {
      // UazAPI V2: POST /instance/connect - gera QR code quando não passa phone
      // Documentação: https://docs.uazapi.com/endpoint/post/instance~connect
      try {
        console.log(`Calling POST ${baseUrl}/instance/connect (no phone = QR code)`);
        const resp = await fetch(`${baseUrl}/instance/connect`, {
          method: "POST",
          headers,
          body: JSON.stringify({}), // sem phone = gera QR code
          signal: AbortSignal.timeout(30000), // timeout de 30s pois pode demorar
        });

        const data = await resp.json().catch(() => null);
        console.log(`/instance/connect response status: ${resp.status}, keys:`, data ? Object.keys(data) : 'null');

        if (!resp.ok) {
          // Check if already connected
          if (resp.status === 429) {
            return new Response(JSON.stringify({
              success: false,
              action: "connect",
              message: "Limite de conexões simultâneas atingido. Tente novamente em alguns segundos.",
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({
            success: false,
            action: "connect",
            message: data?.message || "Erro ao conectar instância",
            raw: data,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract QR code from response
        const qrCode = data?.qrcode || data?.qr || data?.value || data?.qr_code || data?.base64 || null;

        // Check if already connected
        if (data?.status === "connected" || data?.connected === true) {
          return new Response(JSON.stringify({
            success: true,
            action: "connect",
            qrCode: null,
            already_connected: true,
            message: "Instância já está conectada!",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          action: "connect",
          qrCode,
          raw: data,
          message: qrCode ? "QR Code obtido! Escaneie no WhatsApp." : "Aguardando QR Code...",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("/instance/connect error:", e.message);
        return new Response(JSON.stringify({
          success: false,
          action: "connect",
          message: `Erro ao conectar: ${e.message}`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "status") {
      // Check current status
      try {
        const resp = await fetch(`${baseUrl}/instance/status`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json().catch(() => null);
        console.log("Status response:", JSON.stringify(data));
        
        const status = data?.status || data?.connection_status || data?.state;
        const connected = status === "connected";

        return new Response(JSON.stringify({
          success: true,
          action: "status",
          connected,
          status_raw: status,
          raw: data,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({
          success: false,
          action: "status",
          message: e.message,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'restart', 'connect', 'qr', or 'status'" }), {
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

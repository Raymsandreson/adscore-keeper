import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
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

    const { instance_id, action, phone: inputPhone } = await req.json();

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
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Instance has no token",
        message: `A instância "${inst.instance_name}" não possui token configurado. Verifique as configurações da instância.`
      }), {
        status: 200,
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

        // Extract QR code from response - UazAPI returns instance.qrcode
        const qrCode = data?.instance?.qrcode || data?.qrcode || data?.qr || data?.value || data?.qr_code || data?.base64 || null;

        // Check if already connected
        if (data?.instance?.status === "connected" || data?.status === "connected" || data?.connected === true) {
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

    if (action === "pairing_code") {
      // UazAPI V2: POST /instance/connect com phone = gera código de pareamento
      let ownerPhone = inst.owner_phone || inputPhone || null;
      
      // Se não tem owner_phone, tenta buscar do status da instância
      if (!ownerPhone) {
        try {
          const statusResp = await fetch(`${baseUrl}/instance/status`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10000),
          });
          const statusData = await statusResp.json().catch(() => null);
          ownerPhone = statusData?.instance?.owner || statusData?.instance?.phone || statusData?.owner || statusData?.phone || null;
          if (ownerPhone && ownerPhone.includes('@')) {
            ownerPhone = ownerPhone.split('@')[0];
          }
          console.log("Fetched phone from status:", ownerPhone);
        } catch (e) {
          console.error("Error fetching instance status for phone:", e.message);
        }
      }

      if (!ownerPhone) {
        return new Response(JSON.stringify({
          success: false,
          action: "pairing_code",
          needs_phone: true,
          message: "Informe o número do telefone desta instância para gerar o código de pareamento.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean phone
      ownerPhone = ownerPhone.replace(/\D/g, '');

      // Save owner_phone for future use
      if (!inst.owner_phone && ownerPhone) {
        await supabase
          .from("whatsapp_instances")
          .update({ owner_phone: ownerPhone })
          .eq("id", instance_id);
        console.log(`Saved owner_phone ${ownerPhone} for instance ${inst.instance_name}`);
      }

      try {
        console.log(`Calling POST ${baseUrl}/instance/connect with phone=${ownerPhone} (pairing code)`);
        const resp = await fetch(`${baseUrl}/instance/connect`, {
          method: "POST",
          headers,
          body: JSON.stringify({ phone: ownerPhone }),
          signal: AbortSignal.timeout(30000),
        });

        const data = await resp.json().catch(() => null);
        console.log(`/instance/connect (pairing) response status: ${resp.status}, data:`, JSON.stringify(data));

        if (data?.instance?.status === "connected" || data?.connected === true) {
          return new Response(JSON.stringify({
            success: true,
            action: "pairing_code",
            already_connected: true,
            message: "Instância já está conectada!",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract pairing code from response - UazAPI returns instance.paircode
        const pairingCode = data?.instance?.paircode || data?.pairingCode || data?.pairing_code || data?.code || null;

        if (!pairingCode) {
          return new Response(JSON.stringify({
            success: false,
            action: "pairing_code",
            message: "Não foi possível gerar o código de pareamento.",
            raw: data,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Send pairing code via WhatsApp from raymsandreson instance
        try {
          const { data: raymInst } = await supabase
            .from("whatsapp_instances")
            .select("id, instance_token, base_url")
            .ilike("instance_name", "%raym%")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (raymInst?.id) {
            const raymBaseUrl = raymInst.base_url || "https://abraci.uazapi.com";
            const raymHeaders = {
              "Content-Type": "application/json",
              "token": raymInst.instance_token,
            };

            const message = `🔗 *Código de Pareamento WhatsApp*\n\n` +
              `Instância: *${inst.instance_name}*\n\n` +
              `Seu código de pareamento é:\n\n` +
              `*${pairingCode}*\n\n` +
              `📱 *Como usar:*\n` +
              `1. Abra o WhatsApp no celular\n` +
              `2. Toque em ⋮ (3 pontos) → *Aparelhos conectados*\n` +
              `3. Toque em *Conectar um aparelho*\n` +
              `4. Toque em *Conectar com número de telefone*\n` +
              `5. Digite o código: *${pairingCode}*\n\n` +
              `⏰ O código expira em *5 minutos*.`;

            await fetch(`${raymBaseUrl}/sendText`, {
              method: "POST",
              headers: raymHeaders,
              body: JSON.stringify({ phone: ownerPhone, message }),
              signal: AbortSignal.timeout(10000),
            });
            console.log(`Pairing code sent via WhatsApp to ${ownerPhone}`);
          }
        } catch (sendErr) {
          console.error("Error sending pairing code via WhatsApp:", sendErr.message);
        }

        return new Response(JSON.stringify({
          success: true,
          action: "pairing_code",
          pairingCode,
          message: `Código de pareamento gerado e enviado via WhatsApp para ${ownerPhone}.`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("/instance/connect (pairing) error:", e.message);
        return new Response(JSON.stringify({
          success: false,
          action: "pairing_code",
          message: `Erro ao gerar código de pareamento: ${e.message}`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'restart', 'connect', 'qr', 'pairing_code', or 'status'" }), {
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

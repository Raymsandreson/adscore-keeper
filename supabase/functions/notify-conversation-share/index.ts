import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(resolveSupabaseUrl(), resolveServiceRoleKey());
    const { recipient_user_id, sender_id, sender_name, conversation_phone, conversation_name } = await req.json();

    if (!recipient_user_id || !sender_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing data" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sender instance
    const { data: senderProfile } = await supabase
      .from("profiles").select("default_instance_id").eq("user_id", sender_id).single();

    let senderInstance: any = null;
    if (senderProfile?.default_instance_id) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name, instance_token, base_url")
        .eq("id", senderProfile.default_instance_id).eq("is_active", true).single();
      senderInstance = inst;
    }
    if (!senderInstance) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name, instance_token, base_url")
        .eq("is_active", true).limit(1).single();
      senderInstance = inst;
    }

    // Recipient phone
    const { data: recipientProfile } = await supabase
      .from("profiles").select("full_name, phone").eq("user_id", recipient_user_id).single();

    if (!recipientProfile?.phone || !senderInstance?.instance_token) {
      return new Response(JSON.stringify({ success: false, error: "missing phone or instance", sent: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = senderInstance.base_url || "https://abraci.uazapi.com";
    const phone = recipientProfile.phone.replace(/\D/g, "");
    const appUrl = "https://adscore-keeper.lovable.app";
    const deepLink = `${appUrl}/whatsapp?openChat=${encodeURIComponent(conversation_phone)}`;

    const message =
      `📲 *Conversa compartilhada com você*\n\n` +
      `*${sender_name}* compartilhou uma conversa do WhatsApp` +
      (conversation_name ? ` com *${conversation_name}*` : ` (${conversation_phone})`) +
      `.\n\n🔗 Abrir: ${deepLink}`;

    let sent = 0;
    try {
      const resp = await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: senderInstance.instance_token },
        body: JSON.stringify({ number: phone, text: message }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) sent = 1;
      else console.error("notify-conversation-share send failed:", resp.status, await resp.text().catch(() => ""));
    } catch (e) {
      console.error("notify-conversation-share send error:", (e as Error).message);
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-conversation-share error:", err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

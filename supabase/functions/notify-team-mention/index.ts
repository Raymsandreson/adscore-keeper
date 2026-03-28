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

    const { mentioned_user_ids, message_content, sender_name, entity_type, entity_id, entity_name } = await req.json();

    if (!mentioned_user_ids?.length || !message_content) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get mentioned users' profiles with phone and default instance
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, phone, default_instance_id")
      .in("user_id", mentioned_user_ids);

    if (!profiles?.length) {
      return new Response(JSON.stringify({ sent: 0, reason: "no profiles found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build deep link
    const appUrl = req.headers.get("origin") || "https://adscore-keeper.lovable.app";
    let deepLink = appUrl;
    if (entity_type === "lead" && entity_id) {
      deepLink = `${appUrl}/leads?openLead=${entity_id}`;
    } else if (entity_type === "contact" && entity_id) {
      deepLink = `${appUrl}/contacts?openContact=${entity_id}`;
    } else if (entity_type === "activity" && entity_id) {
      deepLink = `${appUrl}/activities?openActivity=${entity_id}`;
    }

    let sentCount = 0;

    for (const profile of profiles) {
      if (!profile.phone) {
        console.log(`User ${profile.full_name} has no phone, skipping`);
        continue;
      }

      // Find instance to send from - use user's default or any active
      let instance = null;
      if (profile.default_instance_id) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name, instance_token, base_url")
          .eq("id", profile.default_instance_id)
          .eq("is_active", true)
          .single();
        instance = inst;
      }

      if (!instance) {
        // Fallback: any active instance
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id, instance_name, instance_token, base_url")
          .eq("is_active", true)
          .limit(1)
          .single();
        instance = inst;
      }

      if (!instance?.instance_token) {
        console.log(`No active instance for user ${profile.full_name}`);
        continue;
      }

      const phone = profile.phone.replace(/\D/g, "");
      const baseUrl = instance.base_url || "https://abraci.uazapi.com";

      const entityLabel = entity_type === "lead" ? "Lead" : entity_type === "contact" ? "Contato" : "Registro";
      const message = `💬 *Menção no Chat Equipe*\n\n` +
        `*${sender_name}* mencionou você:\n\n` +
        `"${message_content}"\n\n` +
        (entity_name ? `📋 ${entityLabel}: *${entity_name}*\n` : "") +
        `\n🔗 Acessar: ${deepLink}`;

      try {
        const resp = await fetch(`${baseUrl}/sendText`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "token": instance.instance_token,
          },
          body: JSON.stringify({ phone, message }),
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          sentCount++;
          console.log(`WhatsApp notification sent to ${profile.full_name} (${phone})`);
        } else {
          console.error(`Failed to send to ${phone}:`, resp.status);
        }
      } catch (e) {
        console.error(`Error sending to ${phone}:`, e.message);
      }
    }

    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-team-mention error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

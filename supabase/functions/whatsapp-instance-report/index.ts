import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine report period (last 12 hours)
    const now = new Date();
    const periodStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const periodLabel = now.getHours() < 6 ? "Noturno (12h→00h)" : now.getHours() < 18 ? "Matutino (00h→12h)" : "Vespertino (12h→00h)";
    const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    // Get all active instances
    const { data: instances, error: instErr } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, owner_phone, is_paused")
      .eq("is_active", true);

    if (instErr || !instances?.length) {
      console.error("No instances found:", instErr);
      return new Response(JSON.stringify({ error: "No instances" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find raymsandreson instance for sending
    const raymInstance = instances.find((i) =>
      i.instance_name.toLowerCase().includes("raym")
    );
    if (!raymInstance) {
      console.error("raymsandreson instance not found");
      return new Response(JSON.stringify({ error: "Sender instance not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get raymsandreson credentials
    const { data: raymCreds } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("id", raymInstance.id)
      .single();

    if (!raymCreds) {
      return new Response(JSON.stringify({ error: "Sender credentials missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = raymCreds.base_url || "https://abraci.uazapi.com";
    const token = raymCreds.instance_token;

    // For each instance, gather stats
    const reports: string[] = [];

    for (const inst of instances) {
      // Messages in period
      const { count: inboundCount } = await supabase
        .from("whatsapp_messages")
        .select("*", { count: "exact", head: true })
        .eq("instance_name", inst.instance_name)
        .eq("direction", "inbound")
        .gte("created_at", periodStart.toISOString());

      const { count: outboundCount } = await supabase
        .from("whatsapp_messages")
        .select("*", { count: "exact", head: true })
        .eq("instance_name", inst.instance_name)
        .eq("direction", "outbound")
        .gte("created_at", periodStart.toISOString());

      // Unique conversations
      const { data: uniquePhones } = await supabase
        .from("whatsapp_messages")
        .select("phone")
        .eq("instance_name", inst.instance_name)
        .gte("created_at", periodStart.toISOString());

      const uniqueConversations = new Set(uniquePhones?.map((m) => m.phone) || []).size;

      // Unread messages
      const { count: unreadCount } = await supabase
        .from("whatsapp_messages")
        .select("*", { count: "exact", head: true })
        .eq("instance_name", inst.instance_name)
        .eq("direction", "inbound")
        .is("read_at", null)
        .gte("created_at", periodStart.toISOString());

      // Call records in period
      const { count: callCount } = await supabase
        .from("call_records")
        .select("*", { count: "exact", head: true })
        .eq("phone_used", inst.instance_name)
        .gte("created_at", periodStart.toISOString());

      const statusEmoji = inst.is_paused ? "⏸️" : "✅";

      reports.push(
        `${statusEmoji} *${inst.instance_name}*\n` +
        `📥 Recebidas: ${inboundCount ?? 0}\n` +
        `📤 Enviadas: ${outboundCount ?? 0}\n` +
        `💬 Conversas: ${uniqueConversations}\n` +
        `🔔 Não lidas: ${unreadCount ?? 0}\n` +
        `📞 Chamadas: ${callCount ?? 0}`
      );
    }

    // Build full report message
    const reportMessage =
      `📊 *Relatório WhatsApp*\n` +
      `📅 ${dateLabel} — ${periodLabel}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      reports.join("\n\n") +
      `\n\n━━━━━━━━━━━━━━━━━━\n` +
      `🤖 Relatório automático`;

    // Send report to each instance's owner via raymsandreson
    const sentTo: string[] = [];
    const ownerPhones = new Set<string>();

    for (const inst of instances) {
      if (inst.owner_phone) {
        ownerPhones.add(inst.owner_phone.replace(/\D/g, ""));
      }
    }

    for (const phone of ownerPhones) {
      try {
        const sendRes = await fetch(`${baseUrl}/message/send-text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            phone: phone,
            message: reportMessage,
          }),
        });

        if (sendRes.ok) {
          sentTo.push(phone);
          console.log(`Report sent to ${phone}`);
        } else {
          const errText = await sendRes.text();
          console.error(`Failed to send to ${phone}:`, errText);
        }
      } catch (e) {
        console.error(`Error sending to ${phone}:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent_to: sentTo,
        instances_reported: instances.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Report error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

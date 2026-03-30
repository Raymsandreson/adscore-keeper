import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


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
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load config
    const { data: configData } = await supabase
      .from("whatsapp_report_config")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    // Determine report period (last 12 hours)
    const now = new Date();
    const periodStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const periodLabel = now.getUTCHours() < 6 ? "Noturno (12h→00h)" : now.getUTCHours() < 18 ? "Matutino (00h→12h)" : "Vespertino (12h→00h)";
    const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

    // Get all active instances
    const { data: allInstances, error: instErr } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, owner_phone, is_paused, instance_token, base_url")
      .eq("is_active", true);

    if (instErr || !allInstances?.length) {
      console.error("No instances found:", instErr);
      return new Response(JSON.stringify({ error: "No instances" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine target instances (which ones to report on)
    const targetIds = configData?.target_instance_ids?.length
      ? configData.target_instance_ids
      : allInstances.map((i: any) => i.id);
    const targetInstances = allInstances.filter((i: any) => targetIds.includes(i.id));

    // Determine sender instances
    const senderIds = configData?.sender_instance_ids?.length
      ? configData.sender_instance_ids
      : allInstances.filter((i: any) => i.instance_name.toLowerCase().includes("raym")).map((i: any) => i.id);
    const senderInstances = allInstances.filter((i: any) => senderIds.includes(i.id));

    if (!senderInstances.length) {
      // Fallback to raymsandreson
      const raym = allInstances.find((i: any) => i.instance_name.toLowerCase().includes("raym"));
      if (raym) senderInstances.push(raym);
    }

    if (!senderInstances.length) {
      return new Response(JSON.stringify({ error: "No sender instance found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine which metrics to include
    const metrics = {
      messages_inbound: configData?.include_messages_inbound ?? true,
      messages_outbound: configData?.include_messages_outbound ?? true,
      conversations: configData?.include_conversations ?? true,
      unread: configData?.include_unread ?? true,
      calls: configData?.include_calls ?? true,
      new_leads: configData?.include_new_leads ?? true,
      closed_leads: configData?.include_closed_leads ?? true,
      new_contacts: configData?.include_new_contacts ?? true,
      response_time: configData?.include_response_time ?? true,
      ai_replies: configData?.include_ai_replies ?? false,
      followups: configData?.include_followups ?? true,
    };

    // For each target instance, gather stats
    const reports: string[] = [];

    for (const inst of targetInstances) {
      const lines: string[] = [];
      const statusEmoji = inst.is_paused ? "⏸️" : "✅";
      lines.push(`${statusEmoji} *${inst.instance_name}*`);

      if (metrics.messages_inbound) {
        const { count } = await supabase
          .from("whatsapp_messages")
          .select("*", { count: "exact", head: true })
          .eq("instance_name", inst.instance_name)
          .eq("direction", "inbound")
          .gte("created_at", periodStart.toISOString());
        lines.push(`📥 Recebidas: ${count ?? 0}`);
      }

      if (metrics.messages_outbound) {
        const { count } = await supabase
          .from("whatsapp_messages")
          .select("*", { count: "exact", head: true })
          .eq("instance_name", inst.instance_name)
          .eq("direction", "outbound")
          .gte("created_at", periodStart.toISOString());
        lines.push(`📤 Enviadas: ${count ?? 0}`);
      }

      if (metrics.conversations) {
        const { data: uniquePhones } = await supabase
          .from("whatsapp_messages")
          .select("phone")
          .eq("instance_name", inst.instance_name)
          .gte("created_at", periodStart.toISOString());
        const unique = new Set(uniquePhones?.map((m: any) => m.phone) || []).size;
        lines.push(`💬 Conversas: ${unique}`);
      }

      if (metrics.unread) {
        const { count } = await supabase
          .from("whatsapp_messages")
          .select("*", { count: "exact", head: true })
          .eq("instance_name", inst.instance_name)
          .eq("direction", "inbound")
          .is("read_at", null)
          .gte("created_at", periodStart.toISOString());
        lines.push(`🔔 Não lidas: ${count ?? 0}`);
      }

      if (metrics.calls) {
        const { count } = await supabase
          .from("call_records")
          .select("*", { count: "exact", head: true })
          .eq("phone_used", inst.instance_name)
          .gte("created_at", periodStart.toISOString());
        lines.push(`📞 Chamadas: ${count ?? 0}`);
      }

      if (metrics.new_leads) {
        // Count leads created in this period that came from this instance
        const { count } = await supabase
          .from("whatsapp_messages")
          .select("lead_id", { count: "exact", head: true })
          .eq("instance_name", inst.instance_name)
          .eq("direction", "inbound")
          .not("lead_id", "is", null)
          .gte("created_at", periodStart.toISOString());
        // Get unique leads created in period
        const { data: leadsData } = await supabase
          .from("leads")
          .select("id")
          .gte("created_at", periodStart.toISOString());
        // Cross-reference with messages from this instance
        const { data: instanceLeadMsgs } = await supabase
          .from("whatsapp_messages")
          .select("lead_id")
          .eq("instance_name", inst.instance_name)
          .not("lead_id", "is", null)
          .gte("created_at", periodStart.toISOString());
        const leadIds = new Set(instanceLeadMsgs?.map((m: any) => m.lead_id) || []);
        const newLeads = leadsData?.filter((l: any) => leadIds.has(l.id))?.length ?? 0;
        lines.push(`🆕 Novos leads: ${newLeads}`);
      }

      if (metrics.closed_leads) {
        // Leads closed in period (have closed_at in period)
        const { data: closedData } = await supabase
          .from("leads")
          .select("id")
          .not("closed_at", "is", null)
          .gte("closed_at", periodStart.toISOString());
        // Cross with instance messages
        const { data: instMsgs } = await supabase
          .from("whatsapp_messages")
          .select("lead_id")
          .eq("instance_name", inst.instance_name)
          .not("lead_id", "is", null);
        const instLeadIds = new Set(instMsgs?.map((m: any) => m.lead_id) || []);
        const closed = closedData?.filter((l: any) => instLeadIds.has(l.id))?.length ?? 0;
        lines.push(`✅ Leads fechados: ${closed}`);
      }

      if (metrics.new_contacts) {
        const { count } = await supabase
          .from("contacts")
          .select("*", { count: "exact", head: true })
          .gte("created_at", periodStart.toISOString());
        lines.push(`👤 Contatos novos: ${count ?? 0}`);
      }

      if (metrics.response_time) {
        // Average response time: time between inbound and next outbound
        const { data: inboundMsgs } = await supabase
          .from("whatsapp_messages")
          .select("phone, created_at")
          .eq("instance_name", inst.instance_name)
          .eq("direction", "inbound")
          .gte("created_at", periodStart.toISOString())
          .order("created_at", { ascending: true })
          .limit(100);

        if (inboundMsgs?.length) {
          const responseTimes: number[] = [];
          for (const msg of inboundMsgs.slice(0, 20)) {
            const { data: reply } = await supabase
              .from("whatsapp_messages")
              .select("created_at")
              .eq("instance_name", inst.instance_name)
              .eq("phone", msg.phone)
              .eq("direction", "outbound")
              .gt("created_at", msg.created_at)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            if (reply) {
              const diff = new Date(reply.created_at).getTime() - new Date(msg.created_at).getTime();
              responseTimes.push(diff);
            }
          }
          if (responseTimes.length > 0) {
            const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            const avgMin = Math.round(avgMs / 60000);
            lines.push(`⏱️ Resp. média: ${avgMin < 60 ? `${avgMin}min` : `${Math.round(avgMin / 60)}h${avgMin % 60}min`}`);
          } else {
            lines.push(`⏱️ Resp. média: --`);
          }
        } else {
          lines.push(`⏱️ Resp. média: --`);
        }
      }

      if (metrics.ai_replies) {
        const { count } = await supabase
          .from("whatsapp_messages")
          .select("*", { count: "exact", head: true })
          .eq("instance_name", inst.instance_name)
          .eq("direction", "outbound")
          .not("metadata->ai_agent_id", "is", null)
          .gte("created_at", periodStart.toISOString());
        lines.push(`🤖 Respostas IA: ${count ?? 0}`);
      }

      if (metrics.followups) {
        // Follow-ups registered in the period
        const { count: followupCount } = await supabase
          .from("lead_followups")
          .select("*", { count: "exact", head: true })
          .gte("created_at", periodStart.toISOString());

        // Follow-ups by type
        const { data: followupsByType } = await supabase
          .from("lead_followups")
          .select("followup_type")
          .gte("created_at", periodStart.toISOString());

        const typeCounts: Record<string, number> = {};
        const typeLabels: Record<string, string> = {
          whatsapp: "💬 WhatsApp",
          call: "📞 Ligação",
          email: "📧 E-mail",
          visit: "🏠 Visita",
          meeting: "🤝 Reunião",
        };
        (followupsByType || []).forEach((f: any) => {
          typeCounts[f.followup_type] = (typeCounts[f.followup_type] || 0) + 1;
        });

        // Follow-ups by outcome
        const { data: followupsByOutcome } = await supabase
          .from("lead_followups")
          .select("outcome")
          .gte("created_at", periodStart.toISOString())
          .not("outcome", "is", null);

        const outcomeCounts: Record<string, number> = {};
        const outcomeLabels: Record<string, string> = {
          positive: "✅ Positivo",
          neutral: "➖ Neutro",
          negative: "❌ Negativo",
          no_answer: "📵 Sem resposta",
        };
        (followupsByOutcome || []).forEach((f: any) => {
          if (f.outcome) outcomeCounts[f.outcome] = (outcomeCounts[f.outcome] || 0) + 1;
        });

        lines.push(`\n📋 *Follow-ups: ${followupCount ?? 0}*`);
        if (Object.keys(typeCounts).length > 0) {
          const typeDetails = Object.entries(typeCounts)
            .map(([k, v]) => `  ${typeLabels[k] || k}: ${v}`)
            .join("\n");
          lines.push(typeDetails);
        }
        if (Object.keys(outcomeCounts).length > 0) {
          const outcomeDetails = Object.entries(outcomeCounts)
            .map(([k, v]) => `  ${outcomeLabels[k] || k}: ${v}`)
            .join("\n");
          lines.push(outcomeDetails);
        }
      }

      reports.push(lines.join("\n"));
    }

    // Build full report
    const reportMessage =
      `📊 *Relatório WhatsApp*\n` +
      `📅 ${dateLabel} — ${periodLabel}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      reports.join("\n\n") +
      `\n\n━━━━━━━━━━━━━━━━━━\n` +
      `🤖 Relatório automático`;

    // Determine recipients
    const recipientPhones = new Set<string>();
    if (configData?.recipient_phones?.length) {
      for (const p of configData.recipient_phones) {
        recipientPhones.add(p.replace(/\D/g, ""));
      }
    } else {
      for (const inst of targetInstances) {
        if (inst.owner_phone) {
          recipientPhones.add(inst.owner_phone.replace(/\D/g, ""));
        }
      }
    }

    // Send via each sender instance
    const sentTo: string[] = [];
    for (const sender of senderInstances) {
      const baseUrl = sender.base_url || "https://abraci.uazapi.com";
      const token = sender.instance_token;

      for (const phone of recipientPhones) {
        try {
          const sendRes = await fetch(`${baseUrl}/message/send-text`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ phone, message: reportMessage }),
          });

          if (sendRes.ok) {
            sentTo.push(`${sender.instance_name} → ${phone}`);
            console.log(`Report sent via ${sender.instance_name} to ${phone}`);
          } else {
            const errText = await sendRes.text();
            console.error(`Failed via ${sender.instance_name} to ${phone}:`, errText);
          }
        } catch (e) {
          console.error(`Error sending via ${sender.instance_name} to ${phone}:`, e);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent_to: sentTo, instances_reported: targetInstances.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Report error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text, lead_id, campaign_id } = await req.json();
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Check if there's an active agent for this conversation
    let assignment = null;
    const { data: existingAssignment } = await supabase
      .from("whatsapp_conversation_agents")
      .select("agent_id, is_active")
      .eq("phone", phone)
      .eq("instance_name", instance_name)
      .eq("is_active", true)
      .maybeSingle();

    assignment = existingAssignment;

    // 2) If no assignment and we have a campaign_id, try auto-assign by campaign
    if (!assignment && campaign_id) {
      const { data: campaignLink } = await supabase
        .from("whatsapp_agent_campaign_links")
        .select("agent_id")
        .eq("campaign_id", campaign_id)
        .maybeSingle();

      if (campaignLink) {
        // Auto-assign this agent to the conversation
        await supabase.from("whatsapp_conversation_agents").upsert({
          phone,
          instance_name,
          agent_id: campaignLink.agent_id,
          is_active: true,
          activated_by: "campaign_auto",
        }, { onConflict: "phone,instance_name" });
        assignment = { agent_id: campaignLink.agent_id, is_active: true };
        console.log(`Auto-assigned agent ${campaignLink.agent_id} via campaign ${campaign_id}`);
      }
    }

    // 3) If no assignment, also check if the lead has a campaign_id
    if (!assignment && lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("campaign_id")
        .eq("id", lead_id)
        .maybeSingle();

      if (lead?.campaign_id) {
        const { data: campaignLink } = await supabase
          .from("whatsapp_agent_campaign_links")
          .select("agent_id")
          .eq("campaign_id", lead.campaign_id)
          .maybeSingle();

        if (campaignLink) {
          await supabase.from("whatsapp_conversation_agents").upsert({
            phone,
            instance_name,
            agent_id: campaignLink.agent_id,
            is_active: true,
            activated_by: "campaign_auto",
          }, { onConflict: "phone,instance_name" });
          assignment = { agent_id: campaignLink.agent_id, is_active: true };
          console.log(`Auto-assigned agent ${campaignLink.agent_id} via lead campaign ${lead.campaign_id}`);
        }
      }
    }

    if (!assignment) {
      return new Response(JSON.stringify({ skipped: true, reason: "No active agent" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent config
    const { data: agent } = await supabase
      .from("whatsapp_ai_agents")
      .select("*")
      .eq("id", assignment.agent_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ skipped: true, reason: "Agent inactive" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== RESPONSE DELAY ==========
    if ((agent as any).response_delay_seconds > 0) {
      await new Promise(resolve => setTimeout(resolve, (agent as any).response_delay_seconds * 1000));
    }

    // ========== GENERATE AI RESPONSE ==========
    if ((agent as any).provider === "lovable_ai") {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ error: "AI not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get recent context
      const { data: recentMessages } = await supabase
        .from("whatsapp_messages")
        .select("direction, message_text, created_at")
        .eq("phone", phone)
        .eq("instance_name", instance_name)
        .order("created_at", { ascending: false })
        .limit(20);

      const contextMessages = (recentMessages || []).reverse().map((m: any) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.message_text || "",
      })).filter((m: any) => m.content.trim());

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: (agent as any).model,
          messages: [
            { role: "system", content: (agent as any).base_prompt },
            ...contextMessages,
          ],
          max_tokens: (agent as any).max_tokens,
          temperature: (agent as any).temperature / 100,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        return new Response(JSON.stringify({ error: "AI failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      let reply = aiData.choices?.[0]?.message?.content || "";
      if (!reply.trim()) {
        return new Response(JSON.stringify({ skipped: true, reason: "Empty response" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if ((agent as any).sign_messages) {
        reply = `${reply}\n\n_🤖 ${(agent as any).name}_`;
      }

      // Send via UazAPI
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("api_url, api_token, base_url, instance_token")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (instance) {
        const baseUrl = (instance as any).base_url || (instance as any).api_url;
        const token = (instance as any).instance_token || (instance as any).api_token;
        await fetch(`${baseUrl}/message/send-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({ phone, message: reply }),
        }).catch(err => console.error("Send error:", err));
      }

      // Save outbound message
      await supabase.from("whatsapp_messages").insert({
        phone, instance_name, direction: "outbound",
        message_text: reply, metadata: { ai_agent: (agent as any).name, ai_agent_id: (agent as any).id },
      });

      // ========== SCHEDULE FOLLOW-UP ==========
      if ((agent as any).followup_enabled) {
        const scheduledAt = new Date(Date.now() + (agent as any).followup_interval_minutes * 60 * 1000).toISOString();
        // Check if there's already a pending followup
        const { data: existingFollowup } = await supabase
          .from("whatsapp_agent_followups")
          .select("id")
          .eq("phone", phone)
          .eq("instance_name", instance_name)
          .eq("status", "pending")
          .maybeSingle();

        if (!existingFollowup) {
          await supabase.from("whatsapp_agent_followups").insert({
            phone, instance_name, agent_id: (agent as any).id,
            attempt_number: 1, scheduled_at: scheduledAt, status: "pending",
          });
          console.log(`Scheduled followup at ${scheduledAt}`);
        }
      }

      // ========== SCHEDULE AUTO-CALL ==========
      if ((agent as any).auto_call_enabled) {
        const callInstanceName = (agent as any).auto_call_instance_name || instance_name;
        let scheduledAt: string;
        
        if ((agent as any).auto_call_mode === "immediate") {
          scheduledAt = new Date().toISOString();
        } else if ((agent as any).auto_call_mode === "delayed") {
          scheduledAt = new Date(Date.now() + (agent as any).auto_call_delay_seconds * 1000).toISOString();
        } else {
          // on_no_response
          scheduledAt = new Date(Date.now() + (agent as any).auto_call_no_response_minutes * 60 * 1000).toISOString();
        }

        // Check if already queued
        const { data: existingCall } = await supabase
          .from("whatsapp_call_queue")
          .select("id")
          .eq("phone", phone)
          .in("status", ["pending", "calling"])
          .maybeSingle();

        if (!existingCall) {
          // Get lead info for the queue record
          let leadName = null;
          if (lead_id) {
            const { data: leadData } = await supabase.from("leads").select("lead_name").eq("id", lead_id).maybeSingle();
            leadName = leadData?.lead_name;
          }

          await supabase.from("whatsapp_call_queue").insert({
            phone,
            instance_name: callInstanceName,
            agent_id: (agent as any).id,
            lead_id: lead_id || null,
            lead_name: leadName,
            contact_name: null,
            status: "pending",
            priority: (agent as any).auto_call_mode === "immediate" ? 10 : 0,
            scheduled_at: scheduledAt,
            max_attempts: 3,
          });
          console.log(`Queued auto-call for ${phone} at ${scheduledAt} (mode: ${(agent as any).auto_call_mode})`);
        }
      }

      return new Response(JSON.stringify({ success: true, reply: reply.substring(0, 100) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UazAPI-managed agents
    return new Response(JSON.stringify({ skipped: true, reason: "UazAPI agents managed externally" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Agent reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

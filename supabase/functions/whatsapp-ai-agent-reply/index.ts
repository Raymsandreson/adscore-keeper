import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text } = await req.json();
    if (!phone || !instance_name || !message_text) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if there's an active agent for this conversation
    const { data: assignment } = await supabase
      .from("whatsapp_conversation_agents")
      .select("agent_id, is_active")
      .eq("phone", phone)
      .eq("instance_name", instance_name)
      .eq("is_active", true)
      .maybeSingle();

    if (!assignment) {
      return new Response(JSON.stringify({ skipped: true, reason: "No active agent" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      return new Response(JSON.stringify({ skipped: true, reason: "Agent not found or inactive" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get recent messages for context (last 20)
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

    // For Lovable AI provider
    if (agent.provider === "lovable_ai") {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        console.error("LOVABLE_API_KEY not configured");
        return new Response(JSON.stringify({ error: "AI not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: agent.model,
          messages: [
            { role: "system", content: agent.base_prompt },
            ...contextMessages,
          ],
          max_tokens: agent.max_tokens,
          temperature: agent.temperature / 100,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        return new Response(JSON.stringify({ error: "AI request failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      let reply = aiData.choices?.[0]?.message?.content || "";

      if (!reply.trim()) {
        return new Response(JSON.stringify({ skipped: true, reason: "Empty AI response" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (agent.sign_messages) {
        reply = `${reply}\n\n_🤖 ${agent.name}_`;
      }

      // Get instance API URL to send reply
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("api_url, api_token")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (!instance) {
        console.error("Instance not found:", instance_name);
        return new Response(JSON.stringify({ error: "Instance not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send via UazAPI
      const sendUrl = `${instance.api_url}/message/send-text`;
      const sendResp = await fetch(sendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${instance.api_token}`,
        },
        body: JSON.stringify({
          phone: phone,
          message: reply,
        }),
      });

      if (!sendResp.ok) {
        const errText = await sendResp.text();
        console.error("Send error:", sendResp.status, errText);
      }

      // Save outbound message
      await supabase.from("whatsapp_messages").insert({
        phone,
        instance_name,
        direction: "outbound",
        message_text: reply,
        contact_name: null,
        metadata: { ai_agent: agent.name, ai_agent_id: agent.id },
      });

      return new Response(JSON.stringify({ success: true, reply }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For UazAPI-managed agents (openai, anthropic, gemini, deepseek)
    // These are handled by UazAPI's own agent system
    // We just need to ensure the agent is configured in UazAPI
    return new Response(JSON.stringify({
      skipped: true,
      reason: "UazAPI agents are managed externally",
      agent_provider: agent.provider,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Agent reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

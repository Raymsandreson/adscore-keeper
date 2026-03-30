import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MANYCHAT_API_URL = "https://api.manychat.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MANYCHAT_API_KEY = Deno.env.get("MANYCHAT_API_KEY");
    if (!MANYCHAT_API_KEY) throw new Error("MANYCHAT_API_KEY not configured");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action } = body;

    // ACTION: Send AI-generated reply to a subscriber
    if (action === "send_ai_reply") {
      const { subscriber_id, incoming_message, platform = "instagram", context = "" } = body;

      if (!subscriber_id || !incoming_message) {
        return new Response(JSON.stringify({ error: "subscriber_id and incoming_message required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Generate AI reply via Google Gemini
      let aiReply = "";
      if (GOOGLE_AI_API_KEY) {
        const geminiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Você é um assistente de atendimento profissional e amigável para um escritório de advocacia.
Responda de forma natural, empática e objetiva. Mantenha a resposta curta (máximo 3 parágrafos).
${context ? `Contexto adicional: ${context}` : ""}

Mensagem do cliente: "${incoming_message}"

Responda em português brasileiro:`
                }]
              }],
              generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
            })
          }
        );

        if (geminiResp.ok) {
          const geminiData = await geminiResp.json();
          aiReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      }

      if (!aiReply) {
        aiReply = "Obrigado pelo contato! Em breve um de nossos especialistas irá atender você.";
      }

      // Send via ManyChat API
      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/sending/sendContent`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriber_id: parseInt(subscriber_id),
          data: {
            version: "v2",
            content: {
              messages: [{
                type: "text",
                text: aiReply
              }]
            }
          },
          message_tag: "HUMAN_AGENT"
        })
      });

      const manychatData = await manychatResp.json();
      const success = manychatData.status === "success";

      // Log interaction
      await supabase.from("manychat_interactions").insert({
        subscriber_id: String(subscriber_id),
        platform,
        direction: "outbound",
        message_text: incoming_message,
        ai_generated_reply: aiReply,
        status: success ? "sent" : "error",
        error_message: success ? null : JSON.stringify(manychatData),
        metadata: { action: "ai_reply", manychat_response: manychatData }
      });

      return new Response(JSON.stringify({
        success,
        ai_reply: aiReply,
        manychat_response: manychatData
      }), {
        status: success ? 200 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Send a flow to subscriber
    if (action === "send_flow") {
      const { subscriber_id, flow_ns } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/sending/sendFlow`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriber_id: parseInt(subscriber_id), flow_ns })
      });

      const manychatData = await manychatResp.json();

      await supabase.from("manychat_interactions").insert({
        subscriber_id: String(subscriber_id),
        direction: "outbound",
        flow_id: flow_ns,
        status: manychatData.status === "success" ? "sent" : "error",
        error_message: manychatData.status !== "success" ? JSON.stringify(manychatData) : null,
        metadata: { action: "send_flow" }
      });

      return new Response(JSON.stringify(manychatData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Find subscriber by name
    if (action === "find_subscriber") {
      const { name } = body;

      const manychatResp = await fetch(
        `${MANYCHAT_API_URL}/fb/subscriber/findByName?name=${encodeURIComponent(name)}`,
        {
          headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
        }
      );

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Get subscriber info
    if (action === "get_subscriber") {
      const { subscriber_id } = body;

      const manychatResp = await fetch(
        `${MANYCHAT_API_URL}/fb/subscriber/getInfo?subscriber_id=${subscriber_id}`,
        {
          headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
        }
      );

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: List flows
    if (action === "list_flows") {
      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/page/getFlows`, {
        headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: List recent subscribers via growth tools / tags workaround
    if (action === "list_subscribers") {
      // ManyChat doesn't have a "list all subscribers" endpoint.
      // We use getGrowthTools to list triggers, then try to get recent subscribers via tags.
      // Best approach: list tags first, then get subscribers by tag.
      const tagsResp = await fetch(`${MANYCHAT_API_URL}/fb/page/getTags`, {
        headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
      });

      const tagsText = await tagsResp.text();
      let tagsData;
      try { tagsData = JSON.parse(tagsText); } catch {
        return new Response(JSON.stringify({ status: "success", data: [], message: "A API do ManyChat não suporta listagem direta de assinantes. Use a busca por nome ou envie uma mensagem pelo Instagram para criar o primeiro contato." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        status: "success", 
        data: [], 
        tags: tagsData?.data || [],
        message: "Use a busca por nome para encontrar assinantes. Tags disponíveis listadas para referência."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Find subscriber by custom field or system field
    if (action === "find_by_field") {
      const { field_name, field_value, field_type = "system" } = body;

      const endpoint = field_type === "custom" 
        ? `${MANYCHAT_API_URL}/fb/subscriber/findByCustomField`
        : `${MANYCHAT_API_URL}/fb/subscriber/findBySystemField`;

      const manychatResp = await fetch(
        `${endpoint}?field_name=${encodeURIComponent(field_name)}&field_value=${encodeURIComponent(field_value)}`,
        {
          headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
        }
      );

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Add tag to subscriber
    if (action === "add_tag") {
      const { subscriber_id, tag_id } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/subscriber/addTag`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriber_id: parseInt(subscriber_id), tag_id })
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Remove tag from subscriber
    if (action === "remove_tag") {
      const { subscriber_id, tag_id } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/subscriber/removeTag`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriber_id: parseInt(subscriber_id), tag_id })
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Create a tag
    if (action === "create_tag") {
      const { name } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/page/createTag`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name })
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Remove a tag (page-level)
    if (action === "remove_page_tag") {
      const { tag_id } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/page/removeTag`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tag_id })
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Set custom field for subscriber
    if (action === "set_custom_field") {
      const { subscriber_id, field_id, field_value } = body;

      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/subscriber/setCustomField`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriber_id: parseInt(subscriber_id), field_id, field_value })
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Get custom fields list
    if (action === "get_custom_fields") {
      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/page/getCustomFields`, {
        headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Get subscribers by tag (for filtering/bulk)
    if (action === "get_subscribers_by_tag") {
      const { tag_id } = body;

      const manychatResp = await fetch(
        `${MANYCHAT_API_URL}/fb/subscriber/getInfoByTag?tag_id=${tag_id}`,
        { headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` } }
      );

      const data = await manychatResp.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Send content to multiple subscribers (bulk)
    if (action === "bulk_send") {
      const { subscriber_ids, message_text, flow_ns } = body;
      const results: any[] = [];

      for (const subId of subscriber_ids) {
        try {
          if (flow_ns) {
            const resp = await fetch(`${MANYCHAT_API_URL}/fb/sending/sendFlow`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ subscriber_id: parseInt(subId), flow_ns })
            });
            const d = await resp.json();
            results.push({ subscriber_id: subId, success: d.status === "success", data: d });
          } else if (message_text) {
            const resp = await fetch(`${MANYCHAT_API_URL}/fb/sending/sendContent`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                subscriber_id: parseInt(subId),
                data: {
                  version: "v2",
                  content: { messages: [{ type: "text", text: message_text }] }
                },
                message_tag: "HUMAN_AGENT"
              })
            });
            const d = await resp.json();
            results.push({ subscriber_id: subId, success: d.status === "success", data: d });
          }
        } catch (e: any) {
          results.push({ subscriber_id: subId, success: false, error: e.message });
        }
      }

      await supabase.from("manychat_interactions").insert({
        subscriber_id: "bulk",
        direction: "outbound",
        message_text: message_text || `Flow: ${flow_ns}`,
        status: results.every(r => r.success) ? "sent" : "partial",
        metadata: { action: "bulk_send", total: subscriber_ids.length, results }
      });

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ACTION: Test connection
    if (action === "test_connection") {
      const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/page/getInfo`, {
        headers: { "Authorization": `Bearer ${MANYCHAT_API_KEY}` }
      });

      const data = await manychatResp.json();
      return new Response(JSON.stringify({ connected: data.status === "success", data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: send_ai_reply, send_flow, find_subscriber, get_subscriber, list_flows, add_tag, test_connection" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("ManyChat function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

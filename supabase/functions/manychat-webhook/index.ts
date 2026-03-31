import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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

const MANYCHAT_API_URL = "https://api.manychat.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MANYCHAT_API_KEY = Deno.env.get("MANYCHAT_API_KEY");
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!MANYCHAT_API_KEY) throw new Error("MANYCHAT_API_KEY not configured");

    const body = await req.json();
    console.log("ManyChat webhook received:", JSON.stringify(body));

    // ManyChat sends: subscriber_id, first_name, last_name, last_input_text, custom_fields, etc.
    const subscriberId = body.subscriber_id || body.id;
    const firstName = body.first_name || body.name || "";
    const lastName = body.last_name || "";
    const incomingMessage = body.last_input_text || body.message || body.text || "";
    const platform = body.platform || "instagram";

    if (!subscriberId || !incomingMessage) {
      console.log("Missing data - subscriber_id:", subscriberId, "message:", incomingMessage);
      return new Response(JSON.stringify({ 
        version: "v2",
        content: {
          messages: [{ type: "text", text: "Obrigado pelo contato! Em breve um especialista irá atendê-lo." }]
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Fetch conversation history for context
    const { data: history } = await supabase
      .from("manychat_interactions")
      .select("message_text, ai_generated_reply, created_at")
      .eq("subscriber_id", String(subscriberId))
      .order("created_at", { ascending: false })
      .limit(10);

    const historyContext = history?.reverse().map(h => {
      const parts = [];
      if (h.message_text) parts.push(`Cliente: ${h.message_text}`);
      if (h.ai_generated_reply) parts.push(`Assistente: ${h.ai_generated_reply}`);
      return parts.join("\n");
    }).join("\n") || "";

    // Fetch the AI prompt config (reuse from manychat settings or use default)
    const { data: agentConfig } = await supabase
      .from("manychat_agent_config")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const systemPrompt = agentConfig?.system_prompt || 
      `Você é um assistente de atendimento profissional e amigável para um escritório de advocacia chamado WhatsJUD.
Responda de forma natural, empática e objetiva. Mantenha a resposta curta (máximo 2 parágrafos).
Seu objetivo é acolher o cliente e entender a situação dele para encaminhá-lo ao especialista certo.
Se o cliente descrever um acidente de trabalho, doença ocupacional ou questão previdenciária, demonstre empatia e explique que podem ajudar.
Nunca dê conselho jurídico específico, apenas acolha e oriente sobre os próximos passos.`;

    // Generate AI reply via Gemini
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
                text: `${systemPrompt}

${historyContext ? `Histórico da conversa:\n${historyContext}\n\n` : ""}Nome do cliente: ${firstName} ${lastName}
Plataforma: ${platform}

Mensagem do cliente: "${incomingMessage}"

Responda em português brasileiro de forma natural e acolhedora:`
              }]
            }],
            generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
          })
        }
      );

      if (geminiResp.ok) {
        const geminiData = await geminiResp.json();
        aiReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else {
        console.error("Gemini error:", await geminiResp.text());
      }
    }

    if (!aiReply) {
      aiReply = `Olá ${firstName}! Obrigado pelo contato. Em breve um de nossos especialistas irá atender você.`;
    }

    // Send reply via ManyChat API
    const manychatResp = await fetch(`${MANYCHAT_API_URL}/fb/sending/sendContent`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MANYCHAT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscriber_id: parseInt(String(subscriberId)),
        data: {
          version: "v2",
          content: {
            messages: [{ type: "text", text: aiReply }]
          }
        },
        message_tag: "HUMAN_AGENT"
      })
    });

    const manychatData = await manychatResp.json();
    const success = manychatData.status === "success";
    console.log("ManyChat send result:", JSON.stringify(manychatData));

    // Log interaction
    await supabase.from("manychat_interactions").insert({
      subscriber_id: String(subscriberId),
      platform,
      direction: "inbound",
      message_text: incomingMessage,
      ai_generated_reply: aiReply,
      status: success ? "sent" : "error",
      error_message: success ? null : JSON.stringify(manychatData),
      metadata: { 
        action: "webhook_auto_reply", 
        subscriber_name: `${firstName} ${lastName}`.trim(),
        manychat_response: manychatData 
      }
    });

    // Return the response in ManyChat Dynamic Content format as well
    // This allows ManyChat to use the response directly if configured for "External Request" with response
    return new Response(JSON.stringify({
      version: "v2",
      content: {
        messages: [{ type: "text", text: aiReply }]
      },
      // Also include our metadata
      success,
      ai_reply: aiReply
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("ManyChat webhook error:", err);
    return new Response(JSON.stringify({
      version: "v2",
      content: {
        messages: [{ type: "text", text: "Obrigado pelo contato! Em breve um especialista irá atendê-lo." }]
      }
    }), {
      status: 200, // Return 200 even on error to avoid ManyChat retries
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

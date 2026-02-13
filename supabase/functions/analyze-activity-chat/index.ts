import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Você é um assistente jurídico que analisa conversas de chat de atividades de um CRM de advocacia trabalhista.

Analise TODAS as mensagens do chat e extraia informações para preencher os campos da atividade.

Você DEVE retornar um JSON com exatamente estes campos:
- what_was_done: string (resumo do que foi feito/discutido)
- current_status_notes: string (status atual da situação)
- next_steps: string (próximos passos identificados)
- notes: string (observações adicionais relevantes)

Seja conciso mas completo. Use linguagem profissional. Se algum campo não tiver informação suficiente, deixe como string vazia.

IMPORTANTE: Retorne APENAS o JSON, sem markdown, sem código, sem explicações.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analise estas mensagens de chat e extraia as informações:\n\n${messages.map((m: any) => `[${m.sender_name || 'Usuário'}] (${m.message_type}): ${m.content || m.file_name || 'arquivo'}`).join('\n')}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "fill_activity_fields",
              description: "Preenche os campos da atividade com base no chat",
              parameters: {
                type: "object",
                properties: {
                  what_was_done: { type: "string", description: "O que foi feito" },
                  current_status_notes: { type: "string", description: "Status atual" },
                  next_steps: { type: "string", description: "Próximos passos" },
                  notes: { type: "string", description: "Observações" },
                },
                required: ["what_was_done", "current_status_notes", "next_steps", "notes"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "fill_activity_fields" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let suggestion;
    
    if (toolCall?.function?.arguments) {
      suggestion = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: try to parse content directly
      const content = data.choices?.[0]?.message?.content || '{}';
      suggestion = JSON.parse(content);
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-activity-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

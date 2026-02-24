import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text || text.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Texto muito curto" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: types } = await sb.from("activity_types").select("key, label").eq("is_active", true).order("display_order");
    const typesList = (types || []).map((t: any) => `"${t.key}" (${t.label})`).join(", ");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Você é um assistente jurídico que organiza ditados de voz em campos estruturados de atividades.
O usuário vai ditar informações sobre uma atividade/tarefa jurídica. Extraia e organize as informações nos campos corretos.

Tipos de atividade disponíveis: ${typesList}

Prioridades: "baixa", "normal", "alta", "urgente"

Regras:
- Se o usuário mencionar o nome de um cliente/lead, extraia para lead_name
- Se mencionar o nome de um contato (advogado, perito, etc), extraia para contact_name  
- Se mencionar data/prazo, extraia no formato YYYY-MM-DD para deadline
- Organize o que foi feito, situação atual e próximos passos em campos separados
- O assunto (title) deve ser curto e objetivo, em MAIÚSCULAS
- Se não conseguir identificar algum campo, deixe como string vazia
- Não invente informações que não foram mencionadas`,
          },
          { role: "user", content: text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "fill_activity_fields",
              description: "Preenche os campos da atividade com as informações extraídas do ditado",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Assunto curto e objetivo da atividade, em MAIÚSCULAS" },
                  activity_type: { type: "string", description: "Tipo da atividade (key)" },
                  priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
                  deadline: { type: "string", description: "Data do prazo no formato YYYY-MM-DD, vazio se não mencionado" },
                  lead_name: { type: "string", description: "Nome do cliente/lead mencionado" },
                  contact_name: { type: "string", description: "Nome do contato mencionado" },
                  what_was_done: { type: "string", description: "O que foi feito/realizado" },
                  current_status: { type: "string", description: "Situação atual do caso" },
                  next_steps: { type: "string", description: "Próximos passos a serem tomados" },
                  notes: { type: "string", description: "Observações adicionais" },
                },
                required: ["title", "activity_type", "priority"],
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
        return new Response(JSON.stringify({ error: "Limite de requisições excedido, tente novamente." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("No structured response from AI");
    }

    const fields = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-activity-dictation error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

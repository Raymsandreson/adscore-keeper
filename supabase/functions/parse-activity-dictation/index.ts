import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


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
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: types } = await sb.from("activity_types").select("key, label").eq("is_active", true).order("display_order");
    const typesList = (types || []).map((t: any) => `"${t.key}" (${t.label})`).join(", ");

    const result = await geminiChat({
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
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No structured response from AI");
    const fields = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("parse-activity-dictation error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

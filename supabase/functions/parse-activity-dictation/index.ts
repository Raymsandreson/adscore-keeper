import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Chama Google AI Studio direto (endpoint OpenAI-compatible), sem Lovable Gateway no meio.
// Cascata de modelos: tenta o melhor, cai pro mais leve em falha.
const MODEL_CASCADE = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOnce(body: any) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GOOGLE_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res;
}

// Retry com backoff em 429/503 + fallback de modelo em falha persistente
async function callLovableAI(body: any) {
  let lastErr = "";
  for (const model of MODEL_CASCADE) {
    const attemptBody = { ...body, model };
    // até 3 tentativas por modelo (1s → 2s → 4s)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await callOnce(attemptBody);
        if (res.ok) {
          if (model !== MODEL_CASCADE[0] || attempt > 0) {
            console.log(`[parse-activity] sucesso com ${model} na tentativa ${attempt + 1}`);
          }
          return await res.json();
        }
        const text = (await res.text()).slice(0, 300);
        lastErr = `${model} ${res.status}: ${text}`;
        console.warn(`[parse-activity] falha ${lastErr} (tentativa ${attempt + 1})`);
        // 429/503 → vale a pena esperar e tentar de novo o MESMO modelo
        if (res.status === 429 || res.status === 503) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        // outros erros → pula direto pro próximo modelo
        break;
      } catch (e: any) {
        lastErr = `${model} network: ${e.message}`;
        console.warn(`[parse-activity] ${lastErr}`);
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
    // próximo modelo da cascata
  }
  throw new Error(`Todos os modelos falharam. Último erro: ${lastErr}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text || text.trim().length < 5) {
      return new Response(JSON.stringify({ success: false, error: "Texto muito curto" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
    const { data: types } = await sb.from("activity_types").select("key, label").eq("is_active", true).order("display_order");
    const typesList = (types || []).map((t: any) => `"${t.key}" (${t.label})`).join(", ");

    const result = await callLovableAI({
      temperature: 0.1,
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
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "fill_activity_fields" } },
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ success: false, error: "Sem resposta estruturada da IA" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fields = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ success: true, fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("parse-activity-dictation error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message || "Unknown error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

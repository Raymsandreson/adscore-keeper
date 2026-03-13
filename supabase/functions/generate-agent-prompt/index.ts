import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callGemini, transformGeminiStream } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, refinement, current_prompt } = await req.json();

    const messages: any[] = [
      {
        role: "system",
        content: `Você é um especialista em criar prompts de sistema para agentes de IA que atendem clientes via WhatsApp.

Seu objetivo é gerar um prompt de sistema (system prompt) claro, eficaz e bem estruturado que defina o comportamento do agente.

REGRAS PARA O PROMPT GERADO:
- Escreva em português brasileiro
- Defina claramente a persona/papel do agente
- Inclua tom de voz e estilo de comunicação
- Defina regras de comportamento (o que fazer e NÃO fazer)
- Inclua instruções sobre formato de resposta (curto, direto, usar emojis, etc.)
- Adicione regras de escopo (quando transferir para humano, o que NÃO responder)
- Se aplicável, inclua fluxo de atendimento (saudação → qualificação → resposta → encerramento)
- O prompt deve ser prático e direto — é para uso interno do sistema
- NÃO inclua explicações sobre o prompt, retorne APENAS o prompt pronto para uso
- Use marcadores e seções organizadas`
      }
    ];

    if (refinement && current_prompt) {
      messages.push(
        { role: "assistant", content: current_prompt },
        { role: "user", content: `Ajuste o prompt conforme esta instrução: ${refinement}` }
      );
    } else {
      messages.push({
        role: "user",
        content: `Crie um prompt de sistema completo para um agente de IA com a seguinte descrição:\n\n${description}\n\nGere apenas o prompt pronto para uso, sem explicações adicionais.`
      });
    }

    const response = await callGemini({
      model: "google/gemini-2.5-flash",
      messages,
      stream: true,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const transformedStream = transformGeminiStream(response.body!);

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-agent-prompt error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

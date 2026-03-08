import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, refinement, current_prompt } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-agent-prompt error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

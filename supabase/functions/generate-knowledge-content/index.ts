import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callGemini, transformGeminiStream } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, refinement, current_content } = await req.json();

    const messages: any[] = [
      {
        role: "system",
        content: `Você é um especialista em criar bases de conhecimento para agentes de IA que atendem clientes via WhatsApp.
Seu objetivo é gerar conteúdo textual claro, completo e estruturado que será usado como contexto pelo agente de IA.

REGRAS:
- Escreva em português brasileiro
- Use linguagem clara e objetiva
- Organize com títulos, subtítulos e tópicos
- Inclua dados práticos: valores, prazos, requisitos, procedimentos
- Foque em informações que um atendente precisaria para responder dúvidas de clientes
- Se for tema jurídico, inclua legislação relevante, prazos processuais, documentos necessários
- NÃO inclua disclaimers ou avisos sobre consultar advogado — isso é para uso interno do agente
- Seja o mais completo e detalhado possível`
      }
    ];

    if (refinement && current_content) {
      messages.push(
        { role: "assistant", content: current_content },
        { role: "user", content: `Ajuste o conteúdo conforme esta instrução: ${refinement}` }
      );
    } else {
      messages.push({
        role: "user",
        content: `Gere uma base de conhecimento completa e detalhada sobre o seguinte tema:\n\n${topic}\n\nInclua todas as informações relevantes que um agente de IA precisaria para atender clientes sobre este assunto.`
      });
    }

    const response = await callGemini({
      model: "google/gemini-2.5-flash",
      messages,
      stream: true,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }), {
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
    console.error("generate-knowledge error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

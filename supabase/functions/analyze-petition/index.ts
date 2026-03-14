import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, processNumber } = await req.json();
    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: "Texto da petição é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um assistente jurídico especializado em análise de petições iniciais brasileiras.
Analise o texto da petição e extraia as seguintes informações em formato JSON:

{
  "vitima": { "nome": "...", "cpf": "...", "profissao": "...", "endereco": { "rua": "", "bairro": "", "cidade": "", "estado": "", "cep": "" } },
  "partes": [{ "nome": "...", "tipo": "autor|reu|testemunha|advogado|perito|outro", "relacao_vitima": "...", "cpf": "...", "profissao": "...", "endereco": {...} }],
  "advogados": [{ "nome": "...", "oab_numero": "...", "oab_uf": "...", "lado": "autor|reu" }],
  "resumo_fatos": "breve resumo dos fatos narrados (máx 200 palavras)",
  "tipo_acao": "tipo da ação judicial identificada",
  "valor_causa": "valor da causa se mencionado"
}

Retorne APENAS o JSON, sem markdown ou explicações. Se um campo não for encontrado, use null.
Identifique todos os endereços mencionados no texto.`;

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise esta petição inicial${processNumber ? ` do processo ${processNumber}` : ''}:\n\n${text}` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_petition_data",
            description: "Extracts structured data from a legal petition",
            parameters: {
              type: "object",
              properties: {
                vitima: {
                  type: "object",
                  properties: {
                    nome: { type: "string" },
                    cpf: { type: "string" },
                    profissao: { type: "string" },
                    endereco: {
                      type: "object",
                      properties: { rua: { type: "string" }, bairro: { type: "string" }, cidade: { type: "string" }, estado: { type: "string" }, cep: { type: "string" } },
                    },
                  },
                  required: ["nome"],
                },
                partes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      nome: { type: "string" }, tipo: { type: "string" }, relacao_vitima: { type: "string" },
                      cpf: { type: "string" }, profissao: { type: "string" },
                      endereco: { type: "object", properties: { rua: { type: "string" }, bairro: { type: "string" }, cidade: { type: "string" }, estado: { type: "string" }, cep: { type: "string" } } },
                    },
                    required: ["nome", "tipo"],
                  },
                },
                advogados: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { nome: { type: "string" }, oab_numero: { type: "string" }, oab_uf: { type: "string" }, lado: { type: "string" } },
                    required: ["nome", "lado"],
                  },
                },
                resumo_fatos: { type: "string" },
                tipo_acao: { type: "string" },
                valor_causa: { type: "string" },
              },
              required: ["vitima", "partes", "advogados", "resumo_fatos"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_petition_data" } },
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    let extractedData;
    if (toolCall?.function?.arguments) {
      extractedData = typeof toolCall.function.arguments === 'string' ? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments;
    } else {
      const content = result.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) extractedData = JSON.parse(jsonMatch[0]);
      else throw new Error("Could not extract structured data from AI response");
    }

    return new Response(JSON.stringify({ data: extractedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analyze-petition error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

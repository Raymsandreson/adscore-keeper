import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, processNumber } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: "Texto da petição é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um assistente jurídico especializado em análise de petições iniciais brasileiras.
Analise o texto da petição e extraia as seguintes informações em formato JSON:

{
  "vitima": {
    "nome": "nome completo da vítima/autor",
    "cpf": "CPF se mencionado",
    "profissao": "profissão se mencionada",
    "endereco": { "rua": "", "bairro": "", "cidade": "", "estado": "", "cep": "" }
  },
  "partes": [
    {
      "nome": "nome da parte",
      "tipo": "autor|reu|testemunha|advogado|perito|outro",
      "relacao_vitima": "cônjuge|filho|pai|mãe|irmão|empregador|etc",
      "cpf": "se mencionado",
      "profissao": "se mencionada",
      "endereco": { "rua": "", "bairro": "", "cidade": "", "estado": "", "cep": "" }
    }
  ],
  "advogados": [
    {
      "nome": "nome do advogado",
      "oab_numero": "número da OAB",
      "oab_uf": "UF da OAB",
      "lado": "autor|reu"
    }
  ],
  "resumo_fatos": "breve resumo dos fatos narrados (máx 200 palavras)",
  "tipo_acao": "tipo da ação judicial identificada",
  "valor_causa": "valor da causa se mencionado"
}

Retorne APENAS o JSON, sem markdown ou explicações.
Se um campo não for encontrado, use null.
Identifique todos os endereços mencionados no texto.`;

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
                      cpf: { type: "string", nullable: true },
                      profissao: { type: "string", nullable: true },
                      endereco: {
                        type: "object",
                        properties: {
                          rua: { type: "string", nullable: true },
                          bairro: { type: "string", nullable: true },
                          cidade: { type: "string", nullable: true },
                          estado: { type: "string", nullable: true },
                          cep: { type: "string", nullable: true },
                        },
                      },
                    },
                    required: ["nome"],
                  },
                  partes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        nome: { type: "string" },
                        tipo: { type: "string" },
                        relacao_vitima: { type: "string", nullable: true },
                        cpf: { type: "string", nullable: true },
                        profissao: { type: "string", nullable: true },
                        endereco: {
                          type: "object",
                          properties: {
                            rua: { type: "string", nullable: true },
                            bairro: { type: "string", nullable: true },
                            cidade: { type: "string", nullable: true },
                            estado: { type: "string", nullable: true },
                            cep: { type: "string", nullable: true },
                          },
                        },
                      },
                      required: ["nome", "tipo"],
                    },
                  },
                  advogados: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        nome: { type: "string" },
                        oab_numero: { type: "string", nullable: true },
                        oab_uf: { type: "string", nullable: true },
                        lado: { type: "string" },
                      },
                      required: ["nome", "lado"],
                    },
                  },
                  resumo_fatos: { type: "string" },
                  tipo_acao: { type: "string", nullable: true },
                  valor_causa: { type: "string", nullable: true },
                },
                required: ["vitima", "partes", "advogados", "resumo_fatos"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_petition_data" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    
    // Extract from tool call response
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    let extractedData;
    
    if (toolCall?.function?.arguments) {
      extractedData = typeof toolCall.function.arguments === 'string' 
        ? JSON.parse(toolCall.function.arguments) 
        : toolCall.function.arguments;
    } else {
      // Fallback: try to parse content as JSON
      const content = result.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Could not extract structured data from AI response");
      }
    }

    return new Response(JSON.stringify({ data: extractedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-petition error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

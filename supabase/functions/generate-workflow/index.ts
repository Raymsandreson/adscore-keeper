import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description, activityTypes } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Você é um especialista em criação de fluxos de trabalho para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

O usuário vai descrever o que precisa e você deve gerar um fluxo completo com a seguinte estrutura hierárquica:
- **Fases** (etapas macro do funil, ex: "Prospecção", "Contato Inicial", "Documentação", "Ajuizamento")
- **Objetivos** por fase (agrupamentos de tarefas, ex: "Qualificar lead", "Coletar documentos")
- **Passos** por objetivo (ações específicas com scripts de contato quando relevante)

Cada passo pode ter:
- label: nome curto da ação
- description: instrução detalhada (opcional)
- script: texto de script de contato para WhatsApp/telefone (opcional, use quando o passo envolve contato direto)
- docChecklist: lista de itens a verificar (documentos, requisitos, perguntas de triagem, verificações). Cada item tem label e type (documentos, requisitos, perguntas, verificacao, outro)

${activityTypes?.length ? `Tipos de atividade disponíveis no sistema: ${activityTypes.join(', ')}` : ''}

IMPORTANTE: Gere conteúdo prático e realista para um escritório de advocacia brasileiro.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: description },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_workflow",
                description:
                  "Cria um fluxo de trabalho completo com fases, objetivos e passos.",
                parameters: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "Nome do fluxo de trabalho",
                    },
                    description: {
                      type: "string",
                      description: "Descrição breve do fluxo",
                    },
                    phases: {
                      type: "array",
                      description: "Lista de fases do fluxo",
                      items: {
                        type: "object",
                        properties: {
                          name: {
                            type: "string",
                            description: "Nome da fase",
                          },
                          color: {
                            type: "string",
                            description:
                              "Cor hex da fase (ex: #3b82f6)",
                          },
                          objectives: {
                            type: "array",
                            description: "Objetivos desta fase",
                            items: {
                              type: "object",
                              properties: {
                                name: {
                                  type: "string",
                                  description: "Nome do objetivo",
                                },
                                description: {
                                  type: "string",
                                  description: "Descrição do objetivo",
                                },
                                is_mandatory: {
                                  type: "boolean",
                                  description: "Se é obrigatório",
                                },
                                steps: {
                                  type: "array",
                                  description: "Passos do objetivo",
                                  items: {
                                    type: "object",
                                    properties: {
                                      label: {
                                        type: "string",
                                        description: "Nome do passo",
                                      },
                                      description: {
                                        type: "string",
                                        description:
                                          "Instrução detalhada do passo",
                                      },
                                      script: {
                                        type: "string",
                                        description:
                                          "Script de contato (WhatsApp/telefone) quando aplicável",
                                      },
                                      activityType: {
                                        type: "string",
                                        description:
                                          "Tipo de atividade associada",
                                      },
                                      docChecklist: {
                                        type: "array",
                                        description:
                                          "Checklist de itens para este passo (documentos, requisitos, perguntas, verificação, etc.)",
                                        items: {
                                          type: "object",
                                          properties: {
                                            label: {
                                              type: "string",
                                              description:
                                                "Texto do item do checklist",
                                            },
                                            type: {
                                              type: "string",
                                              enum: ["documentos", "requisitos", "perguntas", "verificacao", "outro"],
                                              description:
                                                "Tipo do checklist: documentos, requisitos, perguntas, verificacao ou outro",
                                            },
                                          },
                                          required: ["label", "type"],
                                          additionalProperties: false,
                                        },
                                      },
                                    },
                                    required: ["label"],
                                    additionalProperties: false,
                                  },
                                },
                              },
                              required: ["name", "steps"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["name", "color", "objectives"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["name", "description", "phases"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "create_workflow" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido, tente novamente em instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao seu workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "Erro no gateway de IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "IA não retornou dados estruturados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workflow = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(workflow), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-workflow error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

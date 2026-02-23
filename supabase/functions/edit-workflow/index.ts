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
    const { description, currentWorkflow, activityTypes } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Você é um especialista em edição de fluxos de trabalho para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

O usuário tem um fluxo de trabalho EXISTENTE e vai descrever o que quer alterar. Você deve:

1. Analisar a estrutura atual do fluxo
2. Identificar se a mudança se encaixa em alguma fase, objetivo ou passo já existente
3. Fazer as alterações necessárias (adicionar, remover, modificar fases/objetivos/passos)
4. Retornar o fluxo COMPLETO modificado + um resumo claro do que foi alterado e onde

IMPORTANTE:
- Mantenha a estrutura existente o máximo possível, só altere o que foi pedido
- Se o pedido se encaixa em algo existente, modifique o existente ao invés de criar duplicata
- Gere checklists (docChecklist) com 2-5 itens para novos passos
- Preserve todos os IDs existentes (stageId, item ids) para não perder dados
- Apenas gere novos IDs para itens NOVOS

${activityTypes?.length ? `Tipos de atividade disponíveis: ${activityTypes.join(', ')}` : ''}

REGRAS PARA docChecklist:
- Novos passos DEVEM ter pelo menos 2-5 itens de checklist
- Tipos: "documentos", "requisitos", "perguntas", "verificacao", "outro"`;

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
            {
              role: "user",
              content: `FLUXO ATUAL:\n${JSON.stringify(currentWorkflow, null, 2)}\n\nALTERAÇÃO SOLICITADA:\n${description}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "edit_workflow",
                description:
                  "Retorna o fluxo de trabalho modificado com um resumo das alterações.",
                parameters: {
                  type: "object",
                  properties: {
                    changelog: {
                      type: "array",
                      description: "Lista de alterações feitas, cada uma com descrição clara de O QUE mudou e ONDE",
                      items: {
                        type: "object",
                        properties: {
                          action: {
                            type: "string",
                            enum: ["added", "modified", "removed"],
                            description: "Tipo da alteração",
                          },
                          location: {
                            type: "string",
                            description: "Onde a alteração foi feita (ex: 'Fase Comentário > Objetivo Qualificar lead > Passo Ligar para o lead')",
                          },
                          detail: {
                            type: "string",
                            description: "Descrição detalhada da alteração",
                          },
                        },
                        required: ["action", "location", "detail"],
                        additionalProperties: false,
                      },
                    },
                    phases: {
                      type: "array",
                      description: "Lista COMPLETA de fases do fluxo (modificada)",
                      items: {
                        type: "object",
                        properties: {
                          stageId: { type: "string", description: "ID do estágio (manter existente ou gerar novo)" },
                          stageName: { type: "string", description: "Nome da fase" },
                          stageColor: { type: "string", description: "Cor hex da fase" },
                          objectives: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                templateId: { type: "string", description: "ID do template existente (manter se já existe)" },
                                name: { type: "string" },
                                description: { type: "string" },
                                is_mandatory: { type: "boolean" },
                                steps: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      id: { type: "string", description: "ID do passo (manter existente ou gerar novo)" },
                                      label: { type: "string" },
                                      description: { type: "string" },
                                      script: { type: "string" },
                                      activityType: { type: "string" },
                                      nextStageId: { type: "string" },
                                      docChecklist: {
                                        type: "array",
                                        items: {
                                          type: "object",
                                          properties: {
                                            id: { type: "string" },
                                            label: { type: "string" },
                                            type: {
                                              type: "string",
                                              enum: ["documentos", "requisitos", "perguntas", "verificacao", "outro"],
                                            },
                                          },
                                          required: ["id", "label", "type"],
                                          additionalProperties: false,
                                        },
                                      },
                                    },
                                    required: ["id", "label"],
                                    additionalProperties: false,
                                  },
                                },
                              },
                              required: ["name", "steps"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["stageId", "stageName", "stageColor", "objectives"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["changelog", "phases"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "edit_workflow" },
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

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("edit-workflow error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

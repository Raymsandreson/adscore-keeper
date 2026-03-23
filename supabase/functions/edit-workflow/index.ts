import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, currentWorkflow, activityTypes } = await req.json();

    const systemPrompt = `Você é um especialista em edição de fluxos de trabalho para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

O usuário tem um fluxo de trabalho EXISTENTE e vai descrever o que quer alterar. Você deve:
1. Analisar a estrutura atual do fluxo
2. Identificar se a mudança se encaixa em alguma fase, objetivo ou passo já existente
3. Fazer as alterações necessárias
4. Retornar o fluxo COMPLETO modificado + um resumo claro do que foi alterado

IMPORTANTE:
- Mantenha a estrutura existente o máximo possível
- Preserve todos os IDs existentes (stageId, item ids)
- Gere checklists (docChecklist) com 2-5 itens para novos passos
- Tipos: "documentos", "requisitos", "perguntas", "verificacao", "outro"

${activityTypes?.length ? `Tipos de atividade disponíveis: ${activityTypes.join(', ')}` : ''}`;

    const data = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `FLUXO ATUAL:\n${JSON.stringify(currentWorkflow, null, 2)}\n\nALTERAÇÃO SOLICITADA:\n${description}` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "edit_workflow",
            description: "Retorna o fluxo de trabalho modificado com um resumo das alterações.",
            parameters: {
              type: "object",
              properties: {
                changelog: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["added", "modified", "removed"] },
                      location: { type: "string" },
                      detail: { type: "string" },
                    },
                    required: ["action", "location", "detail"],
                  },
                },
                phases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      stageId: { type: "string" },
                      stageName: { type: "string" },
                      stageColor: { type: "string" },
                      objectives: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            templateId: { type: "string" },
                            name: { type: "string" },
                            description: { type: "string" },
                            is_mandatory: { type: "boolean" },
                            steps: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  id: { type: "string" },
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
                                        type: { type: "string", enum: ["documentos", "requisitos", "perguntas", "verificacao", "outro"] },
                                      },
                                      required: ["id", "label", "type"],
                                    },
                                  },
                                },
                                required: ["id", "label"],
                              },
                            },
                          },
                          required: ["name", "steps"],
                        },
                      },
                    },
                    required: ["stageId", "stageName", "stageColor", "objectives"],
                  },
                },
              },
              required: ["changelog", "phases"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "edit_workflow" } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "IA não retornou dados estruturados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("edit-workflow error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Erro desconhecido" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

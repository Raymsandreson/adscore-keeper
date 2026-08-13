import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, currentWorkflow, activityTypes, team } = await req.json();

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
- Passos e itens de docChecklist podem ter "answers" (pergunta com respostas): concluir exige escolher uma resposta, e cada resposta pode ter nextStageId ("__finalize__" para finalizar, ou id de fase para mover). Preserve as answers existentes; se o usuário pedir uma pergunta com desdobramento, use answers em vez de nextStageId.

${activityTypes?.length ? `Tipos de atividade disponíveis: ${activityTypes.join(', ')}` : ''}

${Array.isArray(team) && team.length ? `EQUIPE DO ESCRITÓRIO (com cargos e atribuições de cada um):
${JSON.stringify(team)}

RESPONSÁVEIS E PRAZOS:
- Fases, objetivos e passos aceitam "assigneeId": use SOMENTE um userId EXATO da lista acima. Nunca invente id nem use nome no lugar do id.
- O responsável cai em cascata (fase → objetivo → passo): prefira definir no nível mais alto que fizer sentido e deixe os níveis de baixo sem assigneeId para herdar. Não repita o mesmo responsável passo a passo.
- Escolha o responsável pelo encaixe entre o trabalho da fase/passo e o cargo/atribuições do membro. Sem encaixe claro, NÃO defina responsável — deixe herdar.
- Preserve os assigneeId, prazoValor e prazoUnidade existentes, a menos que a alteração pedida seja justamente sobre eles.
- Passos aceitam prazo: "prazoValor" (número > 0) + "prazoUnidade" ("dias_uteis", "dias" ou "meses"). Prazo processual normalmente corre em dias úteis.
- Se o POP exigir uma função que NENHUM cargo do time cobre, liste-a em "sugestoes_cargos" (cargo + motivo) em vez de atribuir a pessoa errada.` : ''}`;

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
                      assigneeId: { type: "string", description: "userId do responsável da fase (da lista EQUIPE). Omitir para herdar." },
                      objectives: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            templateId: { type: "string" },
                            name: { type: "string" },
                            description: { type: "string" },
                            is_mandatory: { type: "boolean" },
                            assigneeId: { type: "string", description: "userId do responsável do objetivo (da lista EQUIPE). Omitir para herdar da fase." },
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
                                  assigneeId: { type: "string", description: "userId do responsável do passo (da lista EQUIPE). Omitir para herdar." },
                                  prazoValor: { type: "number", description: "Prazo esperado do passo (junto com prazoUnidade)." },
                                  prazoUnidade: { type: "string", enum: ["dias_uteis", "dias", "meses"] },
                                  answers: {
                                    type: "array",
                                    items: {
                                      type: "object",
                                      properties: {
                                        id: { type: "string" },
                                        label: { type: "string" },
                                        nextStageId: { type: "string" },
                                      },
                                      required: ["id", "label"],
                                    },
                                  },
                                  docChecklist: {
                                    type: "array",
                                    items: {
                                      type: "object",
                                      properties: {
                                        id: { type: "string" },
                                        label: { type: "string" },
                                        type: { type: "string", enum: ["documentos", "requisitos", "perguntas", "verificacao", "outro"] },
                                        nextStageId: { type: "string" },
                                        answers: {
                                          type: "array",
                                          items: {
                                            type: "object",
                                            properties: {
                                              id: { type: "string" },
                                              label: { type: "string" },
                                              nextStageId: { type: "string" },
                                            },
                                            required: ["id", "label"],
                                          },
                                        },
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
                sugestoes_cargos: {
                  type: "array",
                  description: "Funções que o POP exige e nenhum cargo do time cobre. Sugestão para o usuário — não atribui nada.",
                  items: {
                    type: "object",
                    properties: {
                      cargo: { type: "string" },
                      motivo: { type: "string" },
                    },
                    required: ["cargo", "motivo"],
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

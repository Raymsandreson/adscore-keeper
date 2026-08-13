import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, activityTypes, team } = await req.json();

    const systemPrompt = `Você é um especialista em criação de fluxos de trabalho para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

O usuário vai descrever o que precisa e você deve gerar um fluxo completo com a seguinte estrutura hierárquica:
- **Fases** (etapas macro do funil)
- **Objetivos** por fase (agrupamentos de tarefas)
- **Passos** por objetivo (ações específicas com scripts de contato quando relevante)

Cada passo pode ter:
- label, description, script, docChecklist (OBRIGATÓRIO, 2-5 itens)

REGRAS PARA docChecklist:
- Tipos: "documentos", "requisitos", "perguntas", "verificacao", "outro"

${activityTypes?.length ? `Tipos de atividade disponíveis: ${activityTypes.join(', ')}` : ''}

${Array.isArray(team) && team.length ? `EQUIPE DO ESCRITÓRIO (com cargos e atribuições de cada um):
${JSON.stringify(team)}

RESPONSÁVEIS E PRAZOS:
- Fases, objetivos e passos aceitam "assigneeId": use SOMENTE um userId EXATO da lista acima. Nunca invente id nem use nome no lugar do id.
- O responsável cai em cascata (fase → objetivo → passo): prefira definir no nível mais alto que fizer sentido e deixe os níveis de baixo sem assigneeId para herdar. Não repita o mesmo responsável passo a passo.
- Escolha o responsável pelo encaixe entre o trabalho da fase/passo e o cargo/atribuições do membro. Sem encaixe claro, NÃO defina responsável — deixe herdar.
- Passos aceitam prazo: "prazoValor" (número > 0) + "prazoUnidade" ("dias_uteis", "dias" ou "meses"). Prazo processual normalmente corre em dias úteis.
- Se o POP exigir uma função que NENHUM cargo do time cobre, liste-a em "sugestoes_cargos" (cargo + motivo) em vez de atribuir a pessoa errada.` : ''}

IMPORTANTE: Gere conteúdo prático e realista para um escritório de advocacia brasileiro.`;

    const data = await geminiChat({
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
            description: "Cria um fluxo de trabalho completo com fases, objetivos e passos.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                phases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      color: { type: "string" },
                      assigneeId: { type: "string", description: "userId do responsável da fase (da lista EQUIPE). Omitir para herdar." },
                      objectives: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            is_mandatory: { type: "boolean" },
                            assigneeId: { type: "string", description: "userId do responsável do objetivo (da lista EQUIPE). Omitir para herdar da fase." },
                            steps: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  label: { type: "string" },
                                  description: { type: "string" },
                                  script: { type: "string" },
                                  activityType: { type: "string" },
                                  assigneeId: { type: "string", description: "userId do responsável do passo (da lista EQUIPE). Omitir para herdar." },
                                  prazoValor: { type: "number", description: "Prazo esperado do passo (junto com prazoUnidade)." },
                                  prazoUnidade: { type: "string", enum: ["dias_uteis", "dias", "meses"] },
                                  docChecklist: {
                                    type: "array",
                                    items: {
                                      type: "object",
                                      properties: {
                                        label: { type: "string" },
                                        type: { type: "string", enum: ["documentos", "requisitos", "perguntas", "verificacao", "outro"] },
                                      },
                                      required: ["label", "type"],
                                    },
                                  },
                                },
                                required: ["label"],
                              },
                            },
                          },
                          required: ["name", "steps"],
                        },
                      },
                    },
                    required: ["name", "color", "objectives"],
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
              required: ["name", "description", "phases"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "create_workflow" } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "IA não retornou dados estruturados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const workflow = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(workflow), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-workflow error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Erro desconhecido" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

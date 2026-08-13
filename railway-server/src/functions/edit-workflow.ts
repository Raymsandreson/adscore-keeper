// Edita um POP (fluxo de trabalho) existente com IA. Portado da edge do Cloud
// (supabase/functions/edit-workflow) para o Railway — deploy automático no push.
//
// Diferença chave vs. a versão do Cloud: também edita os STATUS do POP
// (resultados possíveis + qual é o esperado), que moram em board.settings e
// antes nunca chegavam à IA. Sem isso a IA "só editava os passos".
//
// Body: { description, currentWorkflow, activityTypes, team? }
//   currentWorkflow: { name, description, phases, resultados?, resultado_esperado_ids? }
//   team: equipe com cargos/atribuições para a IA atribuir responsáveis (assigneeId)
// Retorno HTTP 200: { changelog, phases, resultados, resultado_esperado_ids, sugestoes_cargos? } | { error }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EDIT_WORKFLOW_AI_MODEL || 'google/gemini-3.6-flash';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { description, currentWorkflow, activityTypes, team, cargosDoTime } = (req.body || {}) as {
      description?: string;
      currentWorkflow?: Record<string, unknown>;
      activityTypes?: string[];
      team?: Array<{ userId: string; nome: string; cargos: string[]; atribuicoes?: string }>;
      cargosDoTime?: string[];
    };

    const systemPrompt = `Você é um especialista em edição de fluxos de trabalho (POPs) para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

O usuário tem um fluxo de trabalho EXISTENTE e vai descrever o que quer alterar. Você deve:
1. Analisar a estrutura atual do fluxo
2. Identificar se a mudança se encaixa em alguma fase, objetivo, passo OU nos STATUS do POP já existentes
3. Fazer as alterações necessárias
4. Retornar o fluxo COMPLETO modificado + um resumo claro do que foi alterado

IMPORTANTE:
- Mantenha a estrutura existente o máximo possível
- Preserve todos os IDs existentes (stageId, item ids, ids de resultado)
- Gere checklists (docChecklist) com 2-5 itens para novos passos
- Tipos de checklist: "documentos", "requisitos", "perguntas", "verificacao", "outro"
- Passos e itens de docChecklist podem ter "answers" (pergunta com respostas): concluir exige escolher uma resposta, e cada resposta pode ter nextStageId ("__finalize__" para finalizar, ou id de fase para mover). Preserve as answers existentes; se o usuário pedir uma pergunta com desdobramento, use answers em vez de nextStageId.
- Além de mover (nextStageId), passos, itens de docChecklist e respostas (answers) podem ter "setStatusId": ao concluir/escolher, ALTERA o STATUS do POP do lead. O valor DEVE ser o id de um item de "resultados" (nunca invente um id que não esteja lá; se o status pedido não existir, crie-o em "resultados" primeiro e use o novo id). nextStageId e setStatusId são independentes — uma resposta pode mover, alterar status, ambos ou nenhum. Quando o item/passo tem answers, o setStatusId vai nas respostas (não no item/passo). Preserve os setStatusId existentes.

STATUS DO POP (NÃO confundir com passos nem com checklist):
- "resultados" são os STATUS possíveis que um lead deste POP pode ter (ex.: "Em andamento", "Deferido", "Indeferido", "Acordo", "Recusado"). Cada um tem { id, label, marco? }.
- "resultado_esperado_ids" é a lista de ids dos resultados que contam como SUCESSO/objetivo final do POP (pode ser mais de um).
- "marco" (opcional) é o gatilho automático do Escavador. Valores válidos: "sentenca_1grau", "acordo", "acordao_2grau", "acordao_superior", "transito_julgado", "pagamento" — ou null/ausente.
- Quando o usuário pedir para adicionar/editar "status possíveis" ou "status esperado(s)" do POP, edite os campos "resultados" e "resultado_esperado_ids" — NÃO crie itens de checklist (docChecklist) chamados "Status" dentro de um passo.
- Preserve os ids de resultado existentes. Para um resultado NOVO, gere um id novo (uuid) e, se ele for esperado, inclua o id em "resultado_esperado_ids".
- SEMPRE devolva "resultados" e "resultado_esperado_ids" completos (mesmo que inalterados) para não apagar os existentes.

${activityTypes?.length ? `Tipos de atividade disponíveis: ${activityTypes.join(', ')}` : ''}

${Array.isArray(team) && team.length ? `EQUIPE DO ESCRITÓRIO (com cargos e atribuições de cada um):
${JSON.stringify(team)}

${Array.isArray(cargosDoTime) && cargosDoTime.length ? `CARGOS DO TIME VINCULADO A ESTE POP (use nestes exatos termos em "assigneeCargo"):
${JSON.stringify(cargosDoTime)}` : ''}

RESPONSÁVEIS E PRAZOS:
- O jeito PREFERIDO de designar responsável é por CARGO: fases, objetivos e passos aceitam "assigneeCargo", com um cargo EXATO da lista CARGOS DO TIME acima. A pessoa é resolvida automaticamente pelo time vinculado ao POP — nunca invente cargo fora da lista.
- "assigneeId" (userId EXATO da lista EQUIPE) é exceção: use somente quando o usuário pedir uma pessoa específica pelo nome. Nunca preencha assigneeCargo e assigneeId no mesmo item.
- O responsável cai em cascata (fase → objetivo → passo): prefira definir no nível mais alto que fizer sentido e deixe os níveis de baixo vazios para herdar. Não repita o mesmo cargo passo a passo.
- Escolha o cargo pelo encaixe entre o trabalho da fase/passo e as atribuições do cargo. Sem encaixe claro, NÃO defina responsável — deixe herdar.
- Preserve os assigneeCargo, assigneeId, prazoValor e prazoUnidade existentes, a menos que a alteração pedida seja justamente sobre eles.
- Passos aceitam prazo: "prazoValor" (número > 0) + "prazoUnidade" ("dias_uteis", "dias" ou "meses"). Prazo processual normalmente corre em dias úteis.
- Se o POP exigir uma função que NENHUM cargo do time cobre, liste-a em "sugestoes_cargos" (cargo + motivo) em vez de atribuir a pessoa errada.` : ''}`;

    const data = await geminiChat({
      model: MODEL,
      thinking_budget: 0,
      max_tokens: 16000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `FLUXO ATUAL:\n${JSON.stringify(currentWorkflow, null, 2)}\n\nALTERAÇÃO SOLICITADA:\n${description}` },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'edit_workflow',
            description: 'Retorna o fluxo de trabalho modificado com um resumo das alterações.',
            parameters: {
              type: 'object',
              properties: {
                changelog: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      action: { type: 'string', enum: ['added', 'modified', 'removed'] },
                      location: { type: 'string' },
                      detail: { type: 'string' },
                    },
                    required: ['action', 'location', 'detail'],
                  },
                },
                resultados: {
                  type: 'array',
                  description: 'Lista COMPLETA dos status possíveis do POP (preserve os existentes).',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      marco: { type: 'string', enum: ['sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior', 'transito_julgado', 'pagamento'] },
                    },
                    required: ['id', 'label'],
                  },
                },
                resultado_esperado_ids: {
                  type: 'array',
                  description: 'Ids dos resultados que contam como sucesso/objetivo final.',
                  items: { type: 'string' },
                },
                phases: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      stageId: { type: 'string' },
                      stageName: { type: 'string' },
                      stageColor: { type: 'string' },
                      assigneeCargo: { type: 'string', description: 'Cargo responsável pela fase (da lista CARGOS DO TIME). Jeito preferido. Omitir para herdar.' },
                      assigneeId: { type: 'string', description: 'userId do responsável da fase (da lista EQUIPE). Exceção — só quando o usuário pedir pessoa específica.' },
                      objectives: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            templateId: { type: 'string' },
                            name: { type: 'string' },
                            description: { type: 'string' },
                            is_mandatory: { type: 'boolean' },
                            assigneeCargo: { type: 'string', description: 'Cargo responsável pelo objetivo (da lista CARGOS DO TIME). Jeito preferido. Omitir para herdar da fase.' },
                            assigneeId: { type: 'string', description: 'userId do responsável do objetivo (da lista EQUIPE). Exceção — só quando o usuário pedir pessoa específica.' },
                            steps: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string' },
                                  label: { type: 'string' },
                                  description: { type: 'string' },
                                  script: { type: 'string' },
                                  activityType: { type: 'string' },
                                  nextStageId: { type: 'string' },
                                  setStatusId: { type: 'string', description: 'Ao concluir o passo, altera o status do POP. Id de um item de "resultados".' },
                                  assigneeCargo: { type: 'string', description: 'Cargo responsável pelo passo (da lista CARGOS DO TIME). Jeito preferido. Omitir para herdar.' },
                                  assigneeId: { type: 'string', description: 'userId do responsável do passo (da lista EQUIPE). Exceção — só quando o usuário pedir pessoa específica.' },
                                  prazoValor: { type: 'number', description: 'Prazo esperado do passo (junto com prazoUnidade).' },
                                  prazoUnidade: { type: 'string', enum: ['dias_uteis', 'dias', 'meses'] },
                                  answers: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        id: { type: 'string' },
                                        label: { type: 'string' },
                                        nextStageId: { type: 'string' },
                                        setStatusId: { type: 'string', description: 'Se esta resposta for escolhida, altera o status do POP. Id de um item de "resultados".' },
                                      },
                                      required: ['id', 'label'],
                                    },
                                  },
                                  docChecklist: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        id: { type: 'string' },
                                        label: { type: 'string' },
                                        type: { type: 'string', enum: ['documentos', 'requisitos', 'perguntas', 'verificacao', 'outro'] },
                                        nextStageId: { type: 'string' },
                                        setStatusId: { type: 'string', description: 'Ao marcar o item, altera o status do POP. Id de um item de "resultados".' },
                                        answers: {
                                          type: 'array',
                                          items: {
                                            type: 'object',
                                            properties: {
                                              id: { type: 'string' },
                                              label: { type: 'string' },
                                              nextStageId: { type: 'string' },
                                              setStatusId: { type: 'string', description: 'Se esta resposta for escolhida, altera o status do POP. Id de um item de "resultados".' },
                                            },
                                            required: ['id', 'label'],
                                          },
                                        },
                                      },
                                      required: ['id', 'label', 'type'],
                                    },
                                  },
                                },
                                required: ['id', 'label'],
                              },
                            },
                          },
                          required: ['name', 'steps'],
                        },
                      },
                    },
                    required: ['stageId', 'stageName', 'stageColor', 'objectives'],
                  },
                },
                sugestoes_cargos: {
                  type: 'array',
                  description: 'Funções que o POP exige e nenhum cargo do time cobre. Sugestão para o usuário — não atribui nada.',
                  items: {
                    type: 'object',
                    properties: {
                      cargo: { type: 'string' },
                      motivo: { type: 'string' },
                    },
                    required: ['cargo', 'motivo'],
                  },
                },
              },
              required: ['changelog', 'phases'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'edit_workflow' } },
    });

    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return res.status(200).json({ error: 'IA não retornou dados estruturados' });
    }

    const result = JSON.parse(toolCall.function.arguments);
    return res.status(200).json(result);
  } catch (e: any) {
    console.error('[edit-workflow] error:', e);
    return res.status(200).json({ error: e?.message || 'Erro desconhecido' });
  }
};

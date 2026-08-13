// Gera um POP (fluxo de trabalho) novo com IA. Portado da edge do Cloud
// (supabase/functions/generate-workflow) para o Railway — deploy automático no
// push. A versão do Cloud segue como fallback do functionRouter.
//
// Diferença vs. a versão do Cloud: recebe a equipe (cargos + atribuições) e
// pode atribuir responsáveis (assigneeId em fase/objetivo/passo) e prazos por
// passo, além de sugerir cargos que faltam no time (sugestoes_cargos).
//
// Body: { description, activityTypes?, team? }
// Retorno HTTP 200: { name, description, phases, sugestoes_cargos? } | { error }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.GENERATE_WORKFLOW_AI_MODEL || 'google/gemini-3.6-flash';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { description, activityTypes, team, cargosDoTime } = (req.body || {}) as {
      description?: string;
      activityTypes?: string[];
      team?: Array<{ userId: string; nome: string; cargos: string[]; atribuicoes?: string }>;
      cargosDoTime?: string[];
    };

    const systemPrompt = `Você é um especialista em criação de fluxos de trabalho (POPs) para um CRM jurídico (escritório de advocacia focado em acidentes de trabalho e INSS).

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

${Array.isArray(cargosDoTime) && cargosDoTime.length ? `CARGOS DO TIME VINCULADO A ESTE POP (use nestes exatos termos em "assigneeCargo"):
${JSON.stringify(cargosDoTime)}` : ''}

RESPONSÁVEIS E PRAZOS:
- O jeito PREFERIDO de designar responsável é por CARGO: fases, objetivos e passos aceitam "assigneeCargo", com um cargo EXATO da lista CARGOS DO TIME acima. A pessoa é resolvida automaticamente pelo time vinculado ao POP — nunca invente cargo fora da lista.
- "assigneeId" (userId EXATO da lista EQUIPE) é exceção: use somente quando o usuário pedir uma pessoa específica pelo nome. Nunca preencha assigneeCargo e assigneeId no mesmo item.
- O responsável cai em cascata (fase → objetivo → passo): prefira definir no nível mais alto que fizer sentido e deixe os níveis de baixo vazios para herdar. Não repita o mesmo cargo passo a passo.
- Escolha o cargo pelo encaixe entre o trabalho da fase/passo e as atribuições do cargo. Sem encaixe claro, NÃO defina responsável — deixe herdar.
- Passos aceitam prazo: "prazoValor" (número > 0) + "prazoUnidade" ("dias_uteis", "dias" ou "meses"). Prazo processual normalmente corre em dias úteis.
- Se o POP exigir uma função que NENHUM cargo do time cobre, liste-a em "sugestoes_cargos" (cargo + motivo) em vez de atribuir a pessoa errada.` : ''}

IMPORTANTE: Gere conteúdo prático e realista para um escritório de advocacia brasileiro.`;

    const data = await geminiChat({
      model: MODEL,
      thinking_budget: 0,
      // Mesmo teto do edit-workflow: POP grande não cabe em 16k de saída e o
      // functionCall vinha truncado (sem tool_call). Flash aceita até 65k.
      max_tokens: 60000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(description || '') },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'create_workflow',
            description: 'Cria um fluxo de trabalho completo com fases, objetivos e passos.',
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                phases: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      color: { type: 'string' },
                      assigneeCargo: { type: 'string', description: 'Cargo responsável pela fase (da lista CARGOS DO TIME). Jeito preferido. Omitir para herdar.' },
                      assigneeId: { type: 'string', description: 'userId do responsável da fase (da lista EQUIPE). Exceção — só quando o usuário pedir pessoa específica.' },
                      objectives: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
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
                                  label: { type: 'string' },
                                  description: { type: 'string' },
                                  script: { type: 'string' },
                                  activityType: { type: 'string' },
                                  assigneeCargo: { type: 'string', description: 'Cargo responsável pelo passo (da lista CARGOS DO TIME). Jeito preferido. Omitir para herdar.' },
                                  assigneeId: { type: 'string', description: 'userId do responsável do passo (da lista EQUIPE). Exceção — só quando o usuário pedir pessoa específica.' },
                                  prazoValor: { type: 'number', description: 'Prazo esperado do passo (junto com prazoUnidade).' },
                                  prazoUnidade: { type: 'string', enum: ['dias_uteis', 'dias', 'meses'] },
                                  docChecklist: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        label: { type: 'string' },
                                        type: { type: 'string', enum: ['documentos', 'requisitos', 'perguntas', 'verificacao', 'outro'] },
                                      },
                                      required: ['label', 'type'],
                                    },
                                  },
                                },
                                required: ['label'],
                              },
                            },
                          },
                          required: ['name', 'steps'],
                        },
                      },
                    },
                    required: ['name', 'color', 'objectives'],
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
              required: ['name', 'description', 'phases'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'create_workflow' } },
    });

    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      const finish = data?.choices?.[0]?.finish_reason;
      console.error('[generate-workflow] sem tool_call, finish_reason:', finish);
      const motivo = finish === 'MAX_TOKENS'
        ? 'A resposta da IA estourou o limite de tamanho (fluxo muito grande). Tente uma descrição mais enxuta.'
        : `IA não retornou dados estruturados (${finish || 'resposta vazia'}). Tente de novo.`;
      return res.status(200).json({ error: motivo });
    }

    const workflow = JSON.parse(toolCall.function.arguments);
    return res.status(200).json(workflow);
  } catch (e: any) {
    console.error('[generate-workflow] error:', e);
    return res.status(200).json({ error: e?.message || 'Erro desconhecido' });
  }
};

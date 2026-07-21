// Gera o RASCUNHO de uma NOVA atividade a partir de uma MOVIMENTAÇÃO do processo
// (publicação/intimação/andamento vindo do Escavador/PJe). A IA lê a movimentação
// clicada + as movimentações recentes + o contexto (processo, caso, lead, fluxo de
// trabalho e atividades anteriores) e sugere: TÍTULO, TIPO e os campos da atividade.
//
// Diferente do extract-activity-from-document (que ATUALIZA uma atividade existente),
// aqui o objetivo é CRIAR do zero — por isso a IA também gera title e activity_type.
// O usuário revisa/edita o rascunho no formulário único antes de criar de fato.
//
// Body: {
//   movement: { data?, tipo?, conteudo },
//   recent_movements?: [{ data?, tipo?, conteudo }],
//   activity_context?: { process_title?, process_number?, lead_name?, case_title?,
//                        workflow?: { name?, step_label?, phase_label?, next_step? },
//                        previous_activities?: [...] },
//   activity_types?: [{ key, label }]
// }
// Retorna: { success, fields: { title, activity_type, what_was_done, current_status,
//            next_steps, solicitacao, resposta_juizo, notes }, clarifying_question? }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

interface MovementItem {
  data?: string;
  tipo?: string;
  conteudo?: string;
}

interface PreviousActivity {
  title?: string;
  status?: string;
  type?: string;
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  date?: string;
}

interface WorkflowCtx {
  name?: string;
  step_label?: string;
  phase_label?: string;
  next_step?: string;
}

interface ActivityContext {
  process_title?: string;
  process_number?: string;
  lead_name?: string;
  case_title?: string;
  workflow?: WorkflowCtx;
  previous_activities?: PreviousActivity[];
}

interface ActivityTypeOption {
  key?: string;
  label?: string;
}

const EMPTY_FIELDS = {
  title: '',
  activity_type: '',
  what_was_done: '',
  current_status: '',
  next_steps: '',
  solicitacao: '',
  resposta_juizo: '',
  notes: '',
};

function fmtMovement(m: MovementItem): string {
  const date = m.data ? `[${m.data}] ` : '';
  const tipo = m.tipo ? `(${m.tipo}) ` : '';
  const conteudo = (m.conteudo || '').toString().replace(/\s+/g, ' ').trim();
  return `${date}${tipo}${conteudo}`.trim();
}

function buildContextSections(ctx: ActivityContext, recent: MovementItem[]): string {
  const sections: string[] = [];

  if (ctx.workflow && (ctx.workflow.name || ctx.workflow.step_label || ctx.workflow.phase_label || ctx.workflow.next_step)) {
    const w = ctx.workflow;
    sections.push(`Fluxo de trabalho do processo:
- Fluxo: ${w.name || '—'}
- Fase: ${w.phase_label || '—'}
- Passo atual: ${w.step_label || '—'}
- Próximo passo do fluxo: ${w.next_step || '—'}`);
  }

  if (Array.isArray(recent) && recent.length > 0) {
    const lines = recent.slice(0, 10).map((m) => `- ${fmtMovement(m)}`).filter((l) => l !== '- ');
    if (lines.length > 0) {
      sections.push(`Movimentações recentes do processo (mais recentes primeiro, contexto do andamento):\n${lines.join('\n')}`);
    }
  }

  if (Array.isArray(ctx.previous_activities) && ctx.previous_activities.length > 0) {
    const clip = (s?: string, n = 400) => (s ? s.toString().replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const lines = ctx.previous_activities.slice(0, 8).map((a) => {
      const head = [a.date ? `[${a.date}]` : null, a.title || '(sem título)', a.status ? `(${a.status})` : null].filter(Boolean).join(' · ');
      const detail = [
        clip(a.what_was_done) ? `  · feito: ${clip(a.what_was_done)}` : null,
        clip(a.current_status) ? `  · como está: ${clip(a.current_status)}` : null,
        clip(a.next_steps) ? `  · próximo: ${clip(a.next_steps)}` : null,
      ].filter(Boolean).join('\n');
      return `- ${head}${detail ? '\n' + detail : ''}`;
    });
    sections.push(`Atividades anteriores deste processo (mais recentes primeiro — servem de MODELO de tom/andamento; NÃO copie literalmente, escreva coerente com elas):\n${lines.join('\n')}`);
  }

  return sections.length > 0 ? '\n\n' + sections.join('\n\n') : '';
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { movement, recent_movements, activity_context, activity_types } = (req.body || {}) as {
      movement?: MovementItem;
      recent_movements?: MovementItem[];
      activity_context?: ActivityContext;
      activity_types?: ActivityTypeOption[];
    };

    const movText = (movement?.conteudo || '').toString().trim();
    if (!movText) {
      return ok({ success: false, error: 'Envie a movimentação (movement.conteudo).' });
    }

    const ctx = activity_context || {};
    const types = (activity_types || []).filter((t) => t && t.key);
    const typesList = types.length > 0
      ? types.map((t) => `- ${t.key}: ${t.label || t.key}`).join('\n')
      : '- tarefa: Tarefa\n- acompanhamento: Acompanhamento';
    const allowedKeys = types.map((t) => String(t.key));

    const ctxText = `Contexto do processo:
- Processo: ${ctx.process_title || '—'}${ctx.process_number ? ` (nº ${ctx.process_number})` : ''}
- Caso: ${ctx.case_title || '—'}
- Cliente/Lead: ${ctx.lead_name || '—'}${buildContextSections(ctx, recent_movements || [])}

MOVIMENTAÇÃO A PARTIR DA QUAL CRIAR A ATIVIDADE:
${fmtMovement(movement || {})}

Tipos de atividade disponíveis (escolha UM pela chave, o mais adequado ao teor da movimentação):
${typesList}`;

    const system = `Você é um assistente jurídico de um escritório de advocacia previdenciário/trabalhista. A partir de uma MOVIMENTAÇÃO PROCESSUAL (publicação, intimação, despacho, decisão, andamento) e do contexto do processo (fluxo de trabalho, movimentações recentes e atividades anteriores), crie o RASCUNHO de uma NOVA atividade de acompanhamento.

Sua tarefa: preencher os campos abaixo de forma FIEL ao teor da movimentação, escrevendo no mesmo tom das atividades anteriores do processo. Regras:
- TÍTULO: curto e objetivo, dizendo o que precisa ser feito em resposta à movimentação (ex.: "Recolher custas iniciais", "Cumprir intimação sobre AR não cumprido", "Providenciar depósito da consignação"). Não repita o número do processo no título.
- TIPO: escolha uma das chaves disponíveis que melhor represente a ação. Se nenhuma se encaixar bem, use a mais genérica de acompanhamento.
- OS TRÊS CAMPOS CENTRAIS SÃO OBRIGATÓRIOS — preencha SEMPRE, são o núcleo do rascunho. Não os deixe vazios por excesso de cautela; use a movimentação e o contexto (fluxo + atividades anteriores) como base:
  · "O que foi feito": descreva o que a movimentação informa que ocorreu no processo (a publicação/intimação/decisão em si). É o fato gerador desta atividade. Escreva pelo menos uma frase.
  · "Como está": explique a situação atual do processo à luz da movimentação, de forma coerente com o andamento das atividades anteriores. Escreva pelo menos uma frase.
  · "Próximo passo": a ação concreta a ser tomada em resposta, com prazo/data se a movimentação mencionar. Considere o próximo passo do fluxo de trabalho e o padrão das atividades anteriores. Escreva pelo menos uma frase.
- "Solicitação": o que foi pedido/determinado pela vara/juízo na movimentação — só se houver.
- "Resposta do juízo": decisão/despacho/posição do juízo — só se a movimentação trouxer.
- "Observações": só se houver algo relevante que não caiba nos demais campos.
- Seja fiel: NÃO invente fatos, nomes, datas ou prazos que não estejam na movimentação ou no contexto. Mas INFERIR o encaminhamento natural (o que fazer em seguida) a partir do teor da movimentação e do histórico é esperado e desejado — isso não é "inventar".
- NÃO SEJA REDUNDANTE: cada um dos três campos centrais tem função distinta (fato ocorrido ≠ situação atual ≠ ação seguinte); não repita a mesma frase nos três. Para solicitação/resposta do juízo/observações, deixar vazio é preferível a repetir.
- Se a movimentação for realmente ambígua/insuficiente, preencha o que der (ainda assim os três campos centrais) e retorne "clarifying_question". Se estiver claro, OMITA clarifying_question.
- Escreva em português do Brasil, linguagem simples e direta.`;

    let fields = { ...EMPTY_FIELDS };
    let clarifyingQuestion: string | undefined;
    let fillError: string | undefined;
    try {
      const data = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: ctxText },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'draft_activity_from_movement',
            description: 'Cria o rascunho de uma nova atividade a partir da movimentação processual.',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Título curto e objetivo da atividade (a ação a ser feita).' },
                activity_type: { type: 'string', description: 'Chave do tipo de atividade escolhido dentre os disponíveis.' },
                what_was_done: { type: 'string', description: 'O que a movimentação informa que ocorreu (fato gerador).' },
                current_status: { type: 'string', description: 'Como está a situação do processo agora.' },
                next_steps: { type: 'string', description: 'Próximo passo concreto, com prazo/data se houver.' },
                solicitacao: { type: 'string', description: 'O que foi pedido/determinado pela vara/juízo, se houver.' },
                resposta_juizo: { type: 'string', description: 'Decisão/despacho/posição do juízo, se houver.' },
                notes: { type: 'string', description: 'Observações adicionais relevantes, se houver.' },
                clarifying_question: { type: 'string', description: 'Pergunta objetiva quando a movimentação for ambígua/insuficiente. OMITA se estiver claro.' },
              },
              required: ['title', 'activity_type', 'what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'draft_activity_from_movement' } },
      });

      const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (parsed.clarifying_question && String(parsed.clarifying_question).trim()) {
          clarifyingQuestion = String(parsed.clarifying_question).trim();
        }
        delete parsed.clarifying_question;
        fields = { ...fields, ...parsed };
      }
    } catch (e: any) {
      console.error('[activity-from-movement] fill error:', e);
      fillError = e?.message || String(e);
    }

    // Valida o tipo escolhido: só aceita chave existente na lista fornecida.
    if (fields.activity_type && allowedKeys.length > 0 && !allowedKeys.includes(fields.activity_type)) {
      fields.activity_type = '';
    }

    return ok({
      success: true,
      fields,
      ...(clarifyingQuestion ? { clarifying_question: clarifyingQuestion } : {}),
      ...(fillError ? { fill_error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[activity-from-movement] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

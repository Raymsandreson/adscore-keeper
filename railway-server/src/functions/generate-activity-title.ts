// Gera SOMENTE o TÍTULO de uma atividade jurídica, curto e objetivo, dizendo o
// que precisa ser feito. Diferente do activity-from-movement (que parte de uma
// movimentação do PJe e devolve o rascunho inteiro), aqui o insumo é o que o
// assessor já preencheu na atividade — em especial o "Próximo passo" — e o passo
// atual do fluxo de trabalho. Usado no "concluir e próxima" (nomeia a próxima
// atividade sem copiar o título velho) e no botão "renomear com IA".
//
// Body: {
//   fields?: { what_was_done?, current_status?, next_steps?, notes? },
//   context?: { process_title?, process_number?, case_title?, lead_name?,
//               current_title?, activity_type? },
//   step?: { step_label?, phase_label?, next_step? },
//   previous_activities?: [{ title?, next_steps?, date? }]
// }
// Retorna: { success, title }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

interface Fields {
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  notes?: string;
}
interface Context {
  process_title?: string;
  process_number?: string;
  case_title?: string;
  lead_name?: string;
  current_title?: string;
  activity_type?: string;
}
interface StepCtx {
  step_label?: string;
  phase_label?: string;
  next_step?: string;
}
interface PreviousActivity {
  title?: string;
  next_steps?: string;
  date?: string;
}

const clip = (s?: string, n = 600) =>
  s ? s.toString().replace(/\s+/g, ' ').trim().slice(0, n) : '';

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { fields, context, step, previous_activities } = (req.body || {}) as {
      fields?: Fields;
      context?: Context;
      step?: StepCtx;
      previous_activities?: PreviousActivity[];
    };

    const f = fields || {};
    const c = context || {};
    const s = step || {};

    // Sem nenhum insumo textual não há o que a IA leia — devolve vazio pro caller
    // manter o título atual em vez de gerar algo genérico.
    const hasSignal =
      clip(f.next_steps) || clip(f.what_was_done) || clip(f.current_status) ||
      clip(s.next_step) || clip(s.step_label);
    if (!hasSignal) {
      return ok({ success: false, error: 'sem contexto suficiente para gerar título', title: '' });
    }

    const prevText = Array.isArray(previous_activities) && previous_activities.length > 0
      ? previous_activities.slice(0, 6).map((a) => {
          const parts = [
            a.date ? `[${a.date}]` : null,
            a.title || '(sem título)',
            a.next_steps ? `→ próximo: ${clip(a.next_steps, 200)}` : null,
          ].filter(Boolean);
          return `- ${parts.join(' ')}`;
        }).join('\n')
      : '';

    const userPrompt = `CONTEXTO DO PROCESSO:
- Processo: ${c.process_title || '—'}${c.process_number ? ` (nº ${c.process_number})` : ''}
- Caso: ${c.case_title || '—'}
- Cliente/Lead: ${c.lead_name || '—'}
- Tipo da atividade: ${c.activity_type || '—'}

PASSO ATUAL DO FLUXO DE TRABALHO:
- Fase: ${s.phase_label || '—'}
- Passo atual: ${s.step_label || '—'}
- Próximo passo do fluxo: ${s.next_step || '—'}

CONTEÚDO JÁ PREENCHIDO NA ATIVIDADE:
- O que foi feito: ${clip(f.what_was_done) || '(vazio)'}
- Como está: ${clip(f.current_status) || '(vazio)'}
- Próximo passo: ${clip(f.next_steps) || '(vazio)'}
- Observações: ${clip(f.notes, 300) || '(vazio)'}
${c.current_title ? `\nTítulo atual (genérico, a ser melhorado): ${c.current_title}` : ''}
${prevText ? `\nATIVIDADES ANTERIORES DESTE PROCESSO (mais novo primeiro, só de referência):\n${prevText}` : ''}

Gere UM título curto e objetivo para esta atividade, dizendo O QUE PRECISA SER FEITO agora. Priorize o "Próximo passo" preenchido e o próximo passo do fluxo de trabalho — é a ação que esta atividade representa.`;

    const system = `Você é um assistente jurídico de um escritório de advocacia previdenciário/trabalhista brasileiro. Sua única tarefa é escrever o TÍTULO de uma atividade de acompanhamento processual.

Regras do título:
- Comece com um VERBO de ação (ex.: "Protocolar recurso", "Cumprir exigência do INSS", "Juntar procuração", "Recolher custas iniciais", "Cobrar laudo pericial").
- CURTO e específico: no máximo ~8 palavras. Sem ponto final.
- Diga o que precisa ser FEITO, não o que já foi feito.
- NÃO inclua o número do processo, nem o nome do cliente/lead (isso já aparece ao lado do título na tela).
- NÃO use rótulos genéricos como "Dar andamento", "Acompanhar", "Providências" — o objetivo é justamente substituir o título genérico por algo específico.
- Baseie-se APENAS no contexto fornecido; não invente fatos, nomes, datas ou prazos.
- Se o contexto for insuficiente para algo específico, use a melhor síntese possível do próximo passo — ainda assim comece com um verbo.
- Português do Brasil.`;

    const data = await geminiChat({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'set_activity_title',
          description: 'Define o título curto e objetivo da atividade (a ação a ser feita).',
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Título curto começando com verbo de ação, máx. ~8 palavras, sem número do processo nem nome do cliente.',
              },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'set_activity_title' } },
      temperature: 0.3,
    });

    let title = '';
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        title = String(parsed.title || '').trim();
      } catch (e) {
        console.error('[generate-activity-title] parse error:', e);
      }
    }

    // Limpeza defensiva: remove aspas envolventes e ponto final que o modelo às
    // vezes adiciona, e corta tamanho absurdo.
    title = title.replace(/^["'“”]+|["'“”.]+$/g, '').trim().slice(0, 120);

    if (!title) {
      return ok({ success: false, error: 'modelo não retornou título', title: '' });
    }

    return ok({ success: true, title });
  } catch (e: any) {
    console.error('[generate-activity-title] error:', e);
    return ok({ success: false, error: e?.message || String(e), title: '' });
  }
};

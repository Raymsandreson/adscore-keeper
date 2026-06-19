// Sugere PRÓXIMOS PASSOS práticos para concluir o passo atual do fluxo de
// trabalho de uma atividade jurídica e atingir o objetivo desse passo.
//
// Body: { step_context, activity, previous_activities? }
// Retorno: HTTP 200 { success, suggestions: [{ title, detail }] }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-2.5-flash';

interface ChecklistItem { label?: string; checked?: boolean; }
interface StepContext {
  step_label?: string;
  phase_label?: string;
  objective_label?: string;
  next_step?: string;
  checklist?: ChecklistItem[];
}
interface ActivityInfo {
  title?: string;
  type?: string;
  lead_name?: string;
  process_title?: string;
  current_status?: string;
  what_was_done?: string;
  next_steps?: string;
  notes?: string;
}
interface PreviousActivity {
  title?: string;
  status?: string;
  next_steps?: string;
  date?: string;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { step_context, activity, previous_activities } = (req.body || {}) as {
      step_context?: StepContext;
      activity?: ActivityInfo;
      previous_activities?: PreviousActivity[];
    };

    const step = step_context || {};
    const act = activity || {};

    const checklistText = Array.isArray(step.checklist) && step.checklist.length > 0
      ? step.checklist.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.label || ''}`).join('\n')
      : '(sem checklist definido neste passo)';

    const prevText = Array.isArray(previous_activities) && previous_activities.length > 0
      ? previous_activities.slice(0, 6).map((a) => {
          const parts = [a.date ? `[${a.date}]` : null, a.title || '(sem título)', a.status ? `(${a.status})` : null, a.next_steps ? `→ próximo: ${a.next_steps}` : null].filter(Boolean);
          return `- ${parts.join(' ')}`;
        }).join('\n')
      : '';

    const userPrompt = `PASSO ATUAL DO FLUXO DE TRABALHO:
- Fase: ${step.phase_label || '—'}
- Passo atual: ${step.step_label || '—'}
- Objetivo do passo: ${step.objective_label || '—'}
- Próximo passo do fluxo: ${step.next_step || '—'}
- Checklist do passo:
${checklistText}

ATIVIDADE ATUAL:
- Título: ${act.title || '—'}
- Tipo: ${act.type || '—'}
- Cliente/Lead: ${act.lead_name || '—'}
- Processo: ${act.process_title || '—'}
- Como está: ${act.current_status || '(vazio)'}
- O que foi feito: ${act.what_was_done || '(vazio)'}
- Próximo passo (atual): ${act.next_steps || '(vazio)'}
${prevText ? `\nHISTÓRICO RECENTE DO PROCESSO (mais novo primeiro):\n${prevText}` : ''}

Gere de 3 a 5 PRÓXIMOS PASSOS práticos e específicos para CONCLUIR o objetivo do passo atual e avançar o processo. Priorize o que ainda falta (itens não marcados do checklist) e o que faz sentido após o que já foi feito. NÃO repita o que já está concluído. Se houver prazos/datas no contexto, leve-os em conta.`;

    const system = `Você é um assistente jurídico de um escritório de advocacia brasileiro. Sua função é sugerir os PRÓXIMOS PASSOS para o assessor concluir o passo atual do fluxo de trabalho de um caso/processo e atingir o objetivo desse passo.
- Seja prático, específico e acionável (nada genérico).
- Cada passo começa com um verbo de ação (ex.: "Protocolar...", "Ligar para a vara...", "Solicitar laudo...", "Anexar...", "Cobrar...").
- Baseie-se EXCLUSIVAMENTE no contexto fornecido; não invente fatos.
- Responda em português do Brasil.`;

    const data = await geminiChat({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'suggest_next_steps',
          description: 'Retorna sugestões de próximos passos para concluir o passo atual.',
          parameters: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                description: '3 a 5 próximos passos.',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Ação curta começando com verbo (máx. ~12 palavras).' },
                    detail: { type: 'string', description: 'Breve explicação/contexto da ação (1 frase).' },
                  },
                  required: ['title', 'detail'],
                  additionalProperties: false,
                },
              },
            },
            required: ['suggestions'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'suggest_next_steps' } },
      temperature: 0.4,
    });

    let suggestions: { title: string; detail: string }[] = [];
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
      } catch (e) {
        console.error('[suggest-step-actions] parse error:', e);
      }
    }

    return ok({ success: true, suggestions });
  } catch (e: any) {
    console.error('[suggest-step-actions] error:', e);
    return ok({ success: false, error: e?.message || String(e), suggestions: [] });
  }
};

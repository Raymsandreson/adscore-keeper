// Sugere QUAIS PASSOS do POP já podem ser dados como concluídos, a partir das
// MOVIMENTAÇÕES do processo (Escavador/PJe), das atividades anteriores e de um
// comando em texto livre do usuário ("já foi feito acordo", "audiência em 12/06").
//
// Diferente do suggest-step-actions (que sugere o que FAZER a seguir), aqui a IA
// olha o que JÁ ACONTECEU e devolve os passos a marcar — pra não ter que marcar
// um por um quando o processo está muito à frente do POP.
//
// Cada sugestão vem com a DATA da evidência: o front marca como retroativo tudo
// que não for de hoje, pra marcação em lote não virar ponto no ranking do telão.
//
// Body: {
//   instruction?: string,                        // o que o usuário digitou
//   today: 'YYYY-MM-DD',
//   context?: { lead_name?, process_number?, process_title?, workflow_name?, current_phase? },
//   steps: [{ id, label, description?, phase, objective, checked }],
//   movements?: [{ data?, tipo?, conteudo? }],
//   previous_activities?: [{ date?, title?, what_was_done?, current_status? }]
// }
// Retorno: HTTP 200 { success, resumo, suggestions: [{ step_id, evidencia, data_evidencia, confianca }] }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

interface StepIn {
  id?: string;
  label?: string;
  description?: string;
  phase?: string;
  objective?: string;
  checked?: boolean;
}
interface MovementIn { data?: string; tipo?: string; conteudo?: string }
interface PrevActivityIn { date?: string; title?: string; what_was_done?: string; current_status?: string }
interface ContextIn {
  lead_name?: string;
  process_number?: string;
  process_title?: string;
  workflow_name?: string;
  current_phase?: string;
}
interface SuggestionOut {
  step_id: string;
  evidencia: string;
  data_evidencia: string;
  confianca: string;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const {
      instruction,
      today,
      context,
      steps,
      movements,
      previous_activities,
    } = (req.body || {}) as {
      instruction?: string;
      today?: string;
      context?: ContextIn;
      steps?: StepIn[];
      movements?: MovementIn[];
      previous_activities?: PrevActivityIn[];
    };

    const ctx = context || {};
    const hoje = (today || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    // Só passos EM ABERTO entram no cardápio: passo já marcado não se remarca.
    const pending = (Array.isArray(steps) ? steps : []).filter(s => s?.id && !s.checked);
    if (pending.length === 0) {
      return ok({ success: true, resumo: 'Todos os passos deste POP já estão marcados.', suggestions: [] });
    }

    const doneText = (Array.isArray(steps) ? steps : [])
      .filter(s => s?.checked)
      .slice(0, 60)
      .map(s => `- [${s.phase || '—'} / ${s.objective || '—'}] ${s.label || ''}`)
      .join('\n');

    const pendingText = pending
      .slice(0, 120)
      .map(s => {
        const desc = s.description ? ` — ${String(s.description).slice(0, 200)}` : '';
        return `- id: ${s.id} | fase: ${s.phase || '—'} | objetivo: ${s.objective || '—'} | passo: ${s.label || ''}${desc}`;
      })
      .join('\n');

    const movText = Array.isArray(movements) && movements.length > 0
      ? movements
          .slice(0, 60)
          .map(m => `- [${m.data || 's/ data'}] ${m.tipo ? `(${m.tipo}) ` : ''}${String(m.conteudo || '').slice(0, 400)}`)
          .join('\n')
      : '';

    const prevText = Array.isArray(previous_activities) && previous_activities.length > 0
      ? previous_activities
          .slice(0, 10)
          .map(a => `- [${a.date || 's/ data'}] ${a.title || '(sem título)'}${a.what_was_done ? ` — feito: ${String(a.what_was_done).slice(0, 250)}` : ''}${a.current_status ? ` — situação: ${String(a.current_status).slice(0, 200)}` : ''}`)
          .join('\n')
      : '';

    const userPrompt = `HOJE É: ${hoje}

CASO / PROCESSO:
- Cliente: ${ctx.lead_name || '—'}
- Processo: ${ctx.process_number || '—'} ${ctx.process_title ? `(${ctx.process_title})` : ''}
- POP em uso: ${ctx.workflow_name || '—'}
- Fase atual registrada no POP: ${ctx.current_phase || '—'}

${instruction ? `O QUE O RESPONSÁVEL INFORMOU (tratar como fato verdadeiro):\n"${String(instruction).slice(0, 1500)}"\n` : ''}
PASSOS JÁ MARCADOS NO POP:
${doneText || '(nenhum)'}

PASSOS EM ABERTO (candidatos — use SOMENTE estes ids):
${pendingText}
${movText ? `\nMOVIMENTAÇÕES DO PROCESSO (mais recentes primeiro):\n${movText}` : '\n(sem movimentações do tribunal salvas para este processo)'}
${prevText ? `\nATIVIDADES ANTERIORES DO CASO:\n${prevText}` : ''}

Indique QUAIS passos em aberto já podem ser dados como CONCLUÍDOS, com base nas movimentações, nas atividades anteriores e no que o responsável informou.`;

    const system = `Você é um assistente jurídico de um escritório brasileiro. Sua função é conciliar o POP (checklist de fluxo do processo) com o que JÁ ACONTECEU de verdade no processo.

REGRAS:
- Só devolva passos cujo id esteja na lista de PASSOS EM ABERTO. Nunca invente id.
- Um passo só entra se houver EVIDÊNCIA no contexto: uma movimentação, uma atividade anterior ou a informação dada pelo responsável. Nada de suposição.
- Encadeamento processual conta como evidência: se o processo já está em fase posterior (ex.: já houve sentença, acordo homologado, recurso no TST), os passos anteriores indispensáveis àquilo (protocolo da inicial, distribuição, citação) estão concluídos. Explique esse raciocínio no campo evidencia.
- data_evidencia = a data (YYYY-MM-DD) do fato que comprova o passo. Se a evidência não tiver data, devolva string vazia.
- confianca: "alta" quando há movimentação/atividade explícita; "media" quando é dedução por encadeamento; "baixa" quando é só plausível.
- Não devolva passo cuja evidência seja apenas "faz sentido fazer" — isso é próximo passo, não passo concluído.
- resumo: 1 a 2 frases em português dizendo em que ponto o processo realmente está e o que a lista propõe.
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
          name: 'sugerir_passos_concluidos',
          description: 'Lista os passos do POP que já podem ser marcados como concluídos, com a evidência de cada um.',
          parameters: {
            type: 'object',
            properties: {
              resumo: { type: 'string', description: 'Onde o processo realmente está, em 1-2 frases.' },
              suggestions: {
                type: 'array',
                description: 'Passos a marcar. Pode ser lista vazia se nada tiver evidência.',
                items: {
                  type: 'object',
                  properties: {
                    step_id: { type: 'string', description: 'id exato do passo em aberto.' },
                    evidencia: { type: 'string', description: 'Qual movimentação/fato comprova, em 1 frase.' },
                    data_evidencia: { type: 'string', description: 'Data do fato no formato YYYY-MM-DD, ou string vazia.' },
                    confianca: { type: 'string', description: 'alta, media ou baixa.' },
                  },
                  // Gemini 3.x às vezes emite só os campos required — todos required de propósito.
                  required: ['step_id', 'evidencia', 'data_evidencia', 'confianca'],
                  additionalProperties: false,
                },
              },
            },
            required: ['resumo', 'suggestions'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'sugerir_passos_concluidos' } },
      temperature: 0.2,
      // Com tools, o thinking come o orçamento e volta sem tool_call.
      thinking_budget: 0,
      max_tokens: 8000,
    });

    let resumo = '';
    let suggestions: SuggestionOut[] = [];
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        resumo = typeof parsed.resumo === 'string' ? parsed.resumo : '';
        if (Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
      } catch (e) {
        console.error('[suggest-step-completion] parse error:', e);
      }
    }

    // Rede de segurança: id inventado ou passo já marcado não passa daqui.
    const allowed = new Set(pending.map(s => String(s.id)));
    const seen = new Set<string>();
    suggestions = suggestions
      .filter(s => s && allowed.has(String(s.step_id)))
      .filter(s => (seen.has(String(s.step_id)) ? false : (seen.add(String(s.step_id)), true)))
      .map(s => ({
        step_id: String(s.step_id),
        evidencia: String(s.evidencia || '').slice(0, 400),
        data_evidencia: /^\d{4}-\d{2}-\d{2}$/.test(String(s.data_evidencia || '')) ? String(s.data_evidencia) : '',
        confianca: ['alta', 'media', 'baixa'].includes(String(s.confianca)) ? String(s.confianca) : 'media',
      }));

    return ok({ success: true, resumo, suggestions });
  } catch (e: any) {
    console.error('[suggest-step-completion] error:', e);
    return ok({ success: false, error: e?.message || String(e), resumo: '', suggestions: [] });
  }
};

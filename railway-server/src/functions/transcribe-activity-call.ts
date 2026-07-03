// Transcreve a gravação de uma ligação e preenche os campos da atividade,
// de forma FIEL ao que foi dito (sem inventar). Retorna { success, transcript, fields }.
//
// Body: { audio_url: string, activity_context?: {...} }
// - audio_url: URL pública do áudio (subido pelo front no bucket activity-chat).
//   O áudio é baixado aqui no servidor (o body fica pequeno).
//
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt). IA: Gemini (lib/gemini).
import type { RequestHandler } from 'express';
import { transcribeAudio } from '../lib/stt';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-2.5-flash';

interface PreviousActivity {
  title?: string;
  status?: string;
  type?: string;
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  date?: string;
}

interface ChatMessage {
  sender?: string;
  type?: string;
  content?: string;
  date?: string;
}

interface ActivityContext {
  title?: string;
  type?: string;
  lead_name?: string;
  contact_name?: string;
  process_title?: string;
  current_status?: string;
  what_was_done?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
  // Contexto extra para a IA COMBINAR (não só substituir):
  workflow?: { step_label?: string; phase_label?: string; objective_label?: string; next_step?: string };
  previous_activities?: PreviousActivity[];
  chat_messages?: ChatMessage[];
}

function buildContextSections(ctx: ActivityContext): string {
  const sections: string[] = [];

  if (ctx.workflow && (ctx.workflow.step_label || ctx.workflow.phase_label || ctx.workflow.next_step)) {
    const w = ctx.workflow;
    sections.push(`Fluxo de trabalho do processo:
- Fase: ${w.phase_label || '—'}
- Passo atual: ${w.step_label || '—'}${w.objective_label ? ` (objetivo: ${w.objective_label})` : ''}
- Próximo passo do fluxo: ${w.next_step || '—'}`);
  }

  if (Array.isArray(ctx.previous_activities) && ctx.previous_activities.length > 0) {
    const lines = ctx.previous_activities.slice(0, 8).map((a) => {
      const parts = [
        a.date ? `[${a.date}]` : null,
        a.title || '(sem título)',
        a.status ? `(${a.status})` : null,
        a.what_was_done ? `feito: ${a.what_was_done}` : null,
        a.next_steps ? `próximo: ${a.next_steps}` : null,
      ].filter(Boolean);
      return `- ${parts.join(' · ')}`;
    });
    sections.push(`Histórico de atividades anteriores deste processo (mais recentes primeiro):\n${lines.join('\n')}`);
  }

  if (Array.isArray(ctx.chat_messages) && ctx.chat_messages.length > 0) {
    const lines = ctx.chat_messages.slice(-30).map((m) => {
      const who = m.sender || 'Usuário';
      const content = (m.content || (m.type && m.type !== 'text' ? `[${m.type}]` : '')).toString().slice(0, 500);
      return `- ${who}: ${content}`;
    }).filter((l) => l.trim() !== '- ');
    if (lines.length > 0) {
      sections.push(`Mensagens registradas nesta atividade (chat interno):\n${lines.join('\n')}`);
    }
  }

  return sections.length > 0 ? '\n\n' + sections.join('\n\n') : '';
}

const EMPTY_FIELDS = {
  what_was_done: '',
  current_status: '',
  next_steps: '',
  solicitacao: '',
  resposta_juizo: '',
  notes: '',
};

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { audio_url, activity_context } = (req.body || {}) as {
      audio_url?: string;
      activity_context?: ActivityContext;
    };

    if (!audio_url) return ok({ success: false, error: 'audio_url obrigatório' });

    // 1) Baixa o áudio a partir da URL pública (mantém o payload do request pequeno).
    //    Erros de rede caem no try/catch externo do handler.
    const resp = await fetch(audio_url);
    if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
    const buffer = await resp.arrayBuffer();
    const mime = resp.headers.get('content-type') || 'audio/webm';

    // 2) Transcrição fiel (ElevenLabs Scribe v2 → fallback Gemini).
    const transcript = await transcribeAudio(buffer, mime);
    if (!transcript || transcript === '[áudio inaudível]') {
      return ok({
        success: false,
        error: 'Não foi possível transcrever o áudio (inaudível ou vazio).',
        transcript: transcript || '',
      });
    }

    // 3) IA preenche os campos da atividade com base SÓ no que foi dito.
    const ctx = activity_context || {};
    const ctxText = `Contexto da atividade:
- Título: ${ctx.title || '—'}
- Tipo: ${ctx.type || '—'}
- Cliente/Lead: ${ctx.lead_name || '—'}
- Contato: ${ctx.contact_name || '—'}
- Processo: ${ctx.process_title || '—'}

Conteúdo ATUAL dos campos (preserve o que ainda for válido e complemente com a ligação):
- Como está: ${ctx.current_status || '(vazio)'}
- O que foi feito: ${ctx.what_was_done || '(vazio)'}
- Próximo passo: ${ctx.next_steps || '(vazio)'}
- Solicitação: ${ctx.solicitacao || '(vazio)'}
- Resposta do juízo: ${ctx.resposta_juizo || '(vazio)'}
- Observações: ${ctx.notes || '(vazio)'}${buildContextSections(ctx)}`;

    const fillSystem = `Você é um assistente jurídico de um escritório de advocacia. Foi realizada uma LIGAÇÃO TELEFÔNICA (por exemplo, um assessor ligando para a vara, cartório, órgão ou cliente) e você recebeu a TRANSCRIÇÃO fiel dessa ligação, MAIS o contexto da atividade (campos atuais, fluxo de trabalho, atividades anteriores do processo e mensagens internas).

Sua tarefa: ATUALIZAR os campos da atividade COMBINANDO o contexto existente com o que foi dito na ligação. Regras:
- NÃO descarte informação válida que já estava nos campos atuais — preserve e integre com o que a ligação acrescenta. Se a ligação contradiz/atualiza algo, prevaleça a informação mais nova da ligação.
- Use o histórico de atividades anteriores e as mensagens internas apenas como contexto para escrever de forma coerente com o andamento do processo — NÃO copie esse histórico para dentro dos campos.
- Para "Próximo passo", considere o próximo passo do fluxo de trabalho quando fizer sentido com o que foi dito na ligação.
- Seja fiel e objetivo. NÃO invente fatos, nomes, datas ou prazos que não estejam na transcrição ou no contexto fornecido. Se um campo não tiver informação, retorne string vazia.
- Escreva em português do Brasil, linguagem simples e nada rebuscada. Exemplo de tom: "Cobramos o devido andamento do processo" ou "Solicitamos que a Secretaria/Gabinete proceda com o impulso para seguirmos com os próximos passos".`;

    let fields = { ...EMPTY_FIELDS };
    try {
      const fillData = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: fillSystem },
          { role: 'user', content: `${ctxText}\n\nTRANSCRIÇÃO DA LIGAÇÃO:\n${transcript}` },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'fill_activity_fields_from_call',
            description: 'Preenche os campos da atividade com base na transcrição da ligação.',
            parameters: {
              type: 'object',
              properties: {
                what_was_done: { type: 'string', description: 'O que foi feito/realizado nesta ligação (ex.: com quem falou e o que tratou).' },
                current_status: { type: 'string', description: 'Como está a situação agora, após a ligação.' },
                next_steps: { type: 'string', description: 'Próximo passo a ser tomado, incluindo prazos/datas se mencionados na ligação.' },
                solicitacao: { type: 'string', description: 'O que foi solicitado/pedido durante a ligação, se houver.' },
                resposta_juizo: { type: 'string', description: 'Resposta ou posição da vara/cartório/juízo/órgão (o que o servidor respondeu), se houver.' },
                notes: { type: 'string', description: 'Observações adicionais relevantes mencionadas na ligação.' },
              },
              required: ['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'fill_activity_fields_from_call' } },
      });

      const toolCall = fillData?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        fields = { ...fields, ...parsed };
      }
    } catch (e: any) {
      // Mesmo se o preenchimento falhar, devolvemos a transcrição para o usuário aproveitar.
      console.error('[transcribe-activity-call] fill error:', e);
      return ok({ success: true, transcript, fields, fill_error: e?.message || String(e) });
    }

    return ok({ success: true, transcript, fields });
  } catch (e: any) {
    console.error('[transcribe-activity-call] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

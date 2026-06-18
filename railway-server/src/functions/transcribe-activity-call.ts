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

Conteúdo atual dos campos (apenas referência — atualize/complemente conforme a ligação):
- Como está: ${ctx.current_status || '(vazio)'}
- O que foi feito: ${ctx.what_was_done || '(vazio)'}
- Próximo passo: ${ctx.next_steps || '(vazio)'}
- Solicitação: ${ctx.solicitacao || '(vazio)'}
- Resposta do juízo: ${ctx.resposta_juizo || '(vazio)'}
- Observações: ${ctx.notes || '(vazio)'}`;

    const fillSystem = `Você é um assistente jurídico de um escritório de advocacia. Foi realizada uma LIGAÇÃO TELEFÔNICA (por exemplo, um assessor ligando para a vara, cartório, órgão ou cliente) e você recebeu a TRANSCRIÇÃO fiel dessa ligação.

Sua tarefa: preencher os campos da atividade com base EXCLUSIVAMENTE no que foi realmente dito na ligação. Seja fiel e objetivo. NÃO invente fatos, nomes, datas ou prazos que não estão na transcrição. Se um campo não tiver informação na ligação, retorne string vazia para ele. Escreva em português do Brasil, em tom profissional e direto, em primeira pessoa quando fizer sentido (ex.: "Liguei para a vara e falei com...").`;

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

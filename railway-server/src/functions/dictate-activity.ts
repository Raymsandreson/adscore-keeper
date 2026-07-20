// Cria os campos de uma atividade NOVA a partir de um ditado por voz.
// Diferente de transcribe-activity-call (que ATUALIZA uma atividade aberta a partir
// de uma ligação), aqui o usuário dita, do zero, "o que está fazendo agora" — para
// documentar o dia. A IA estrutura o ditado em campos e escolhe o TIPO mais adequado.
//
// Body: { audio_url?: string, transcript?: string, activity_types?: {key,label}[] }
// - audio_url: URL pública do áudio (subido pelo front no bucket activity-chat).
// - transcript: quando fornecido, pula STT e só refaz a estruturação (editar/re-tentar).
// - activity_types: tipos válidos para a IA escolher (key + label).
//
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt). IA: Gemini (lib/gemini).
import type { RequestHandler } from 'express';
import { transcribeAudio } from '../lib/stt';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-2.5-flash';

interface ActivityTypeOption { key: string; label: string; }

const EMPTY_FIELDS = {
  title: '',
  activity_type: '',
  priority: 'normal',
  what_was_done: '',
  current_status: '',
  next_steps: '',
  notes: '',
  deadline: '',
  lead_name: '',
};

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { audio_url, transcript: providedTranscript, activity_types } = (req.body || {}) as {
      audio_url?: string;
      transcript?: string;
      activity_types?: ActivityTypeOption[];
    };

    let transcript = (providedTranscript || '').trim();

    if (!transcript) {
      if (!audio_url) return ok({ success: false, error: 'audio_url ou transcript obrigatório' });

      // 1) Baixa o áudio da URL pública (mantém o payload do request pequeno).
      const resp = await fetch(audio_url);
      if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
      const buffer = await resp.arrayBuffer();
      const mime = resp.headers.get('content-type') || 'audio/webm';

      // 2) Transcrição fiel (ElevenLabs Scribe v2 → fallback Gemini).
      transcript = (await transcribeAudio(buffer, mime)) || '';
      if (!transcript || transcript === '[áudio inaudível]') {
        return ok({
          success: false,
          error: 'Não foi possível transcrever o áudio (inaudível ou vazio).',
          transcript: transcript || '',
        });
      }
    }

    // 3) IA estrutura o ditado em campos de atividade e escolhe o tipo mais adequado.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    const types = Array.isArray(activity_types) ? activity_types.filter((t) => t?.key) : [];
    const typesList = types.length > 0
      ? types.slice(0, 40).map((t) => `"${t.key}" (${t.label})`).join(', ')
      : '';

    const system = `Você é um assistente jurídico de um escritório de advocacia. O usuário (um assessor) ditou por voz O QUE ESTÁ FAZENDO AGORA, para documentar o trabalho do dia. Você recebeu a TRANSCRIÇÃO fiel do ditado. Sua tarefa é transformar isso numa ATIVIDADE nova, organizando o que foi dito em campos estruturados.

Data de HOJE: ${today} (${weekday}) — use para resolver datas relativas ("amanhã", "sexta", "dia 15").

Regras:
- Seja fiel: NÃO invente fatos, nomes, datas ou prazos que não estejam no ditado.
- O título (title) deve ser curto e objetivo, em MAIÚSCULAS, resumindo a tarefa (ex.: "PROTOCOLAR PETIÇÃO INICIAL", "LIGAR PARA A VARA").
- Organize o conteúdo: what_was_done (o que já foi/está sendo feito), current_status (como está), next_steps (próximo passo, com prazo se dito). NÃO seja redundante — cada campo tem função distinta; deixar vazio é melhor que repetir.
- Se mencionar um cliente/lead pelo nome, coloque em lead_name.
- deadline só se o ditado mencionar prazo/data (formato YYYY-MM-DD). Senão, vazio.
- priority: use "urgente"/"alta" só se o ditado indicar urgência; senão "normal".
${typesList
  ? `- activity_type: escolha a KEY do tipo MAIS ADEQUADO ao que foi dito, entre os tipos válidos abaixo. SEMPRE escolha um (o mais próximo). Tipos válidos: ${typesList}`
  : '- activity_type: deixe vazio (sem tipos disponíveis).'}
- Português do Brasil, linguagem simples e objetiva.`;

    let fields = { ...EMPTY_FIELDS };
    let fillError: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await geminiChat({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `DITADO DO ASSESSOR:\n${transcript}` },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'create_activity_from_dictation',
              description: 'Cria os campos de uma atividade nova a partir do ditado por voz.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Assunto curto e objetivo, em MAIÚSCULAS.' },
                  ...(types.length > 0 ? {
                    activity_type: {
                      type: 'string',
                      enum: types.map((t) => t.key),
                      description: 'Key do tipo de atividade mais adequado ao que foi dito.',
                    },
                  } : {}),
                  priority: { type: 'string', enum: ['baixa', 'normal', 'alta', 'urgente'], description: 'Prioridade.' },
                  deadline: { type: 'string', description: 'Prazo em YYYY-MM-DD, apenas se mencionado. Senão vazio.' },
                  lead_name: { type: 'string', description: 'Nome do cliente/lead citado, se houver. Senão vazio.' },
                  what_was_done: { type: 'string', description: 'O que já foi/está sendo feito.' },
                  current_status: { type: 'string', description: 'Como está a situação agora.' },
                  next_steps: { type: 'string', description: 'Próximo passo, com prazo se dito.' },
                  notes: { type: 'string', description: 'Observações adicionais relevantes.' },
                },
                required: ['title', 'priority'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'create_activity_from_dictation' } },
        });

        const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          fields = { ...fields, ...parsed };
          fillError = null;
          break;
        }
        fillError = 'A IA respondeu sem retornar os campos (resposta vazia).';
        console.warn(`[dictate-activity] tentativa ${attempt}: sem tool_call na resposta`);
      } catch (e: any) {
        fillError = e?.message || String(e);
        console.error(`[dictate-activity] fill error (tentativa ${attempt}):`, e);
      }
    }

    // Mesmo se a estruturação falhar, devolvemos a transcrição para o usuário aproveitar.
    return ok({
      success: true,
      transcript,
      fields,
      ...(fillError ? { fill_error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[dictate-activity] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

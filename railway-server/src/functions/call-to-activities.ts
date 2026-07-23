// Transcreve uma LIGAÇÃO DE VOZ do chat interno (assessor <-> assessor),
// resume a conversa e propõe uma lista de atividades/próximos passos para
// serem cadastrados. Fiel ao que foi dito — não inventa.
//
// Body: {
//   audio_url?: string,                 // URL pública do áudio (bucket team-chat-media)
//   transcript?: string,               // alternativa ao áudio (pula STT)
//   activity_types?: {key,label}[],    // tipos válidos para a IA escolher
//   member_names?: string[],           // nomes da equipe (p/ sugerir responsável)
//   other_party?: string,              // nome do colega do outro lado da ligação
// }
// Retorna: { success, transcript, summary, activities: [...] }
//
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt). IA: Gemini (lib/gemini).
import type { RequestHandler } from 'express';
import { transcribeAudio } from '../lib/stt';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

interface ActivityTypeOption { key: string; label: string; }

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { audio_url, transcript: providedTranscript, activity_types, member_names, other_party } =
      (req.body || {}) as {
        audio_url?: string;
        transcript?: string;
        activity_types?: ActivityTypeOption[];
        member_names?: string[];
        other_party?: string;
      };

    let transcript = (providedTranscript || '').trim();

    // 1) Transcreve a partir do áudio, se não veio transcript pronto.
    if (!transcript) {
      if (!audio_url) return ok({ success: false, error: 'audio_url ou transcript obrigatório' });
      const resp = await fetch(audio_url);
      if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
      const buffer = await resp.arrayBuffer();
      const mime = resp.headers.get('content-type') || 'audio/webm';
      transcript = await transcribeAudio(buffer, mime);
      if (!transcript || transcript === '[áudio inaudível]') {
        return ok({
          success: false,
          error: 'Não foi possível transcrever o áudio (inaudível ou vazio).',
          transcript: transcript || '',
        });
      }
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    const types = Array.isArray(activity_types) ? activity_types.filter((t) => t?.key) : [];
    const typesList = types.length > 0
      ? types.slice(0, 40).map((t) => `"${t.key}" (${t.label})`).join(', ')
      : '';
    const members = Array.isArray(member_names)
      ? member_names.filter((n) => typeof n === 'string' && n.trim()).slice(0, 60)
      : [];

    const system = `Você é um assistente jurídico de um escritório de advocacia. Dois membros da equipe conversaram por LIGAÇÃO DE VOZ interna e você recebeu a TRANSCRIÇÃO fiel dessa conversa${other_party ? ` (um dos lados é ${other_party})` : ''}. Sua função é: (1) RESUMIR a conversa e (2) PROPOR as atividades/próximos passos que ficaram combinados, para serem cadastrados.

Data de HOJE: ${today} (${weekday}) — use para resolver datas relativas ("amanhã", "sexta", "dia 15").

Regras:
- Seja FIEL: NÃO invente fatos, nomes, datas, prazos ou tarefas que não estejam na conversa. Se a ligação não combinou nenhuma tarefa clara, retorne activities vazio.
- summary: um parágrafo curto e objetivo do que foi conversado e decidido.
- activities: uma lista SÓ com tarefas concretas que ficaram combinadas na ligação. NÃO force atividades: se só houve papo sem ação definida, deixe a lista vazia. Uma atividade por ação distinta.
- Para cada atividade:
  - title: curto e objetivo, em MAIÚSCULAS, resumindo a TAREFA (ex.: "PROTOCOLAR PETIÇÃO INICIAL", "COBRAR DOCUMENTOS DO CLIENTE").
  - what_was_done / current_status / next_steps: cada um com função distinta; deixar vazio é melhor que repetir.
  - deadline: só se a conversa mencionar prazo/data (YYYY-MM-DD). Senão vazio.
  - priority: "urgente"/"alta" só se a conversa indicar urgência; senão "normal".
  - lead_name: se a atividade for sobre um cliente/lead citado pelo nome.
${members.length > 0
  ? `  - assignee_name: se a conversa deixar claro QUEM deve executar a tarefa, escolha o nome EXATO da lista: ${members.map((m) => `"${m}"`).join(', ')}. Se não estiver claro, deixe vazio.`
  : '  - assignee_name: deixe vazio.'}
${typesList
  ? `  - activity_type: escolha a KEY do tipo MAIS ADEQUADO entre: ${typesList}. SEMPRE escolha o mais próximo.`
  : '  - activity_type: deixe vazio (sem tipos disponíveis).'}
  - notes: só observações relevantes que não couberam nos outros campos.
- Português do Brasil, linguagem simples e objetiva.`;

    const activityItemProps: Record<string, unknown> = {
      title: { type: 'string', description: 'Assunto curto e objetivo da tarefa, em MAIÚSCULAS.' },
      ...(types.length > 0 ? {
        activity_type: { type: 'string', enum: types.map((t) => t.key), description: 'Key do tipo mais adequado.' },
      } : {}),
      priority: { type: 'string', enum: ['baixa', 'normal', 'alta', 'urgente'], description: 'Prioridade.' },
      deadline: { type: 'string', description: 'Prazo em YYYY-MM-DD, apenas se mencionado. Senão vazio.' },
      lead_name: { type: 'string', description: 'Nome do cliente/lead citado, se houver. Senão vazio.' },
      ...(members.length > 0 ? {
        assignee_name: { type: 'string', description: 'Nome EXATO do membro que deve executar, se claro. Senão vazio.' },
      } : {}),
      what_was_done: { type: 'string', description: 'O que já foi feito/discutido até aqui.' },
      current_status: { type: 'string', description: 'Como a situação está agora.' },
      next_steps: { type: 'string', description: 'O que precisa ser feito, com prazo se citado.' },
      notes: { type: 'string', description: 'Observações adicionais relevantes.' },
    };

    let summary = '';
    let activities: unknown[] = [];
    let fillError: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await geminiChat({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `TRANSCRIÇÃO DA LIGAÇÃO:\n${transcript}` },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'summarize_call_and_propose_activities',
              description: 'Resume a ligação e propõe as atividades combinadas.',
              parameters: {
                type: 'object',
                properties: {
                  summary: { type: 'string', description: 'Resumo curto e objetivo da conversa.' },
                  activities: {
                    type: 'array',
                    description: 'Tarefas concretas combinadas na ligação. Vazio se não houver.',
                    items: { type: 'object', properties: activityItemProps, required: ['title', 'priority'], additionalProperties: false },
                  },
                },
                required: ['summary', 'activities'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'summarize_call_and_propose_activities' } },
        });

        const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          summary = String(parsed.summary || '');
          activities = Array.isArray(parsed.activities) ? parsed.activities : [];
          fillError = null;
          break;
        }
        fillError = 'A IA respondeu sem retornar os campos (resposta vazia).';
        console.warn(`[call-to-activities] tentativa ${attempt}: sem tool_call na resposta`);
      } catch (e: any) {
        fillError = e?.message || String(e);
        console.error(`[call-to-activities] fill error (tentativa ${attempt}):`, e);
      }
    }

    // Mesmo se o resumo falhar, devolvemos a transcrição para o usuário aproveitar.
    return ok({
      success: !fillError,
      transcript,
      summary,
      activities,
      ...(fillError ? { error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[call-to-activities] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

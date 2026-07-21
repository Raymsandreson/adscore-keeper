// Cria os campos de uma atividade NOVA a partir de mensagens do CHAT INTERNO da equipe.
// O usuário seleciona uma ou mais mensagens da conversa e a IA transforma o contexto
// numa atividade estruturada — inclusive sugerindo o assessor responsável quando a
// conversa deixa claro quem deve executar a tarefa.
//
// Body: {
//   transcript: string,                    // mensagens no formato "Nome: texto" (ordem cronológica)
//   activity_types?: {key,label}[],        // tipos válidos para a IA escolher
//   member_names?: string[],               // nomes dos membros da equipe (p/ sugerir assessor)
// }
// IA: Gemini (lib/gemini), mesmo padrão do dictate-activity.
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

interface ActivityTypeOption { key: string; label: string; }

const EMPTY_FIELDS = {
  title: '',
  activity_type: '',
  priority: 'normal',
  deadline: '',
  lead_name: '',
  assignee_name: '',
  what_was_done: '',
  current_status: '',
  next_steps: '',
  notes: '',
};

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { transcript, activity_types, member_names } = (req.body || {}) as {
      transcript?: string;
      activity_types?: ActivityTypeOption[];
      member_names?: string[];
    };

    const text = (transcript || '').trim();
    if (!text) return ok({ success: false, error: 'transcript obrigatório' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    const types = Array.isArray(activity_types) ? activity_types.filter((t) => t?.key) : [];
    const typesList = types.length > 0
      ? types.slice(0, 40).map((t) => `"${t.key}" (${t.label})`).join(', ')
      : '';
    const members = Array.isArray(member_names)
      ? member_names.filter((n) => typeof n === 'string' && n.trim()).slice(0, 60)
      : [];

    const system = `Você é um assistente jurídico de um escritório de advocacia. Membros da equipe conversaram no CHAT INTERNO e o usuário selecionou as mensagens abaixo para transformar numa ATIVIDADE (tarefa). Sua função é entender o contexto da conversa e estruturar a atividade.

Data de HOJE: ${today} (${weekday}) — use para resolver datas relativas ("amanhã", "sexta", "dia 15").

Regras:
- Seja fiel: NÃO invente fatos, nomes, datas ou prazos que não estejam na conversa.
- O título (title) deve ser curto e objetivo, em MAIÚSCULAS, resumindo a TAREFA a fazer (ex.: "PROTOCOLAR PETIÇÃO INICIAL", "COBRAR DOCUMENTOS DO CLIENTE").
- Organize o conteúdo: what_was_done (o que já foi feito/discutido até aqui), current_status (como a situação está agora), next_steps (o que precisa ser feito, com prazo se citado). Cada campo tem função distinta; deixar vazio é melhor que repetir.
- Se a conversa citar um cliente/lead pelo nome, coloque em lead_name.
- deadline só se a conversa mencionar prazo/data (formato YYYY-MM-DD). Senão, vazio.
- priority: "urgente"/"alta" só se a conversa indicar urgência; senão "normal".
${members.length > 0
  ? `- assignee_name: se a conversa deixar claro QUEM deve executar a tarefa (ex.: "fulano, faz isso", "vou pedir pro fulano"), escolha o nome EXATO na lista de membros: ${members.map((m) => `"${m}"`).join(', ')}. Se não estiver claro, deixe vazio.`
  : '- assignee_name: deixe vazio.'}
${typesList
  ? `- activity_type: escolha a KEY do tipo MAIS ADEQUADO à tarefa, entre os tipos válidos. SEMPRE escolha um (o mais próximo). Tipos válidos: ${typesList}`
  : '- activity_type: deixe vazio (sem tipos disponíveis).'}
- Em notes, coloque só observações relevantes que não couberam nos outros campos (não repita a conversa inteira).
- Português do Brasil, linguagem simples e objetiva.`;

    let fields = { ...EMPTY_FIELDS };
    let fillError: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await geminiChat({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `MENSAGENS SELECIONADAS DO CHAT INTERNO:\n${text}` },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'create_activity_from_chat',
              description: 'Cria os campos de uma atividade nova a partir de mensagens do chat interno.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Assunto curto e objetivo da tarefa, em MAIÚSCULAS.' },
                  ...(types.length > 0 ? {
                    activity_type: {
                      type: 'string',
                      enum: types.map((t) => t.key),
                      description: 'Key do tipo de atividade mais adequado à tarefa.',
                    },
                  } : {}),
                  priority: { type: 'string', enum: ['baixa', 'normal', 'alta', 'urgente'], description: 'Prioridade.' },
                  deadline: { type: 'string', description: 'Prazo em YYYY-MM-DD, apenas se mencionado. Senão vazio.' },
                  lead_name: { type: 'string', description: 'Nome do cliente/lead citado, se houver. Senão vazio.' },
                  ...(members.length > 0 ? {
                    assignee_name: {
                      type: 'string',
                      description: 'Nome EXATO do membro que deve executar a tarefa, se a conversa deixar claro. Senão vazio.',
                    },
                  } : {}),
                  what_was_done: { type: 'string', description: 'O que já foi feito/discutido até aqui.' },
                  current_status: { type: 'string', description: 'Como a situação está agora.' },
                  next_steps: { type: 'string', description: 'O que precisa ser feito, com prazo se citado.' },
                  notes: { type: 'string', description: 'Observações adicionais relevantes.' },
                },
                required: ['title', 'priority'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'create_activity_from_chat' } },
        });

        const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          fields = { ...fields, ...parsed };
          fillError = null;
          break;
        }
        fillError = 'A IA respondeu sem retornar os campos (resposta vazia).';
        console.warn(`[chat-to-activity] tentativa ${attempt}: sem tool_call na resposta`);
      } catch (e: any) {
        fillError = e?.message || String(e);
        console.error(`[chat-to-activity] fill error (tentativa ${attempt}):`, e);
      }
    }

    if (fillError) return ok({ success: false, error: fillError, fields });
    return ok({ success: true, fields });
  } catch (e: any) {
    console.error('[chat-to-activity] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

// Transcreve a gravação de uma ligação e preenche os campos da atividade,
// de forma FIEL ao que foi dito (sem inventar). Retorna { success, transcript, fields }.
//
// Body: { audio_url?: string, transcript?: string, activity_context?: {...} }
// - audio_url: URL pública do áudio (subido pelo front no bucket activity-chat).
//   O áudio é baixado aqui no servidor (o body fica pequeno).
// - transcript: quando fornecido, pula download + STT e só refaz o preenchimento
//   dos campos (usado pelo botão "Tentar preencher novamente" do front).
//
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt). IA: Gemini (lib/gemini).
import type { RequestHandler } from 'express';
import { transcribeAudio } from '../lib/stt';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

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
  // Metadados atuais da atividade (para a IA poder atualizá-los quando o áudio pedir):
  deadline?: string;
  notification_date?: string;
  priority?: string;
  status?: string;
  assessor_name?: string;
  /** Co-assessores atuais da atividade (além do principal). */
  co_assessor_names?: string[];
  team_members?: string[];
  /** Tipos de atividade válidos no seletor ({ key, label }) — para a IA escolher o mais adequado. */
  activity_types?: { key: string; label: string }[];
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
    const { audio_url, transcript: providedTranscript, activity_context, user_answer } = (req.body || {}) as {
      audio_url?: string;
      transcript?: string;
      activity_context?: ActivityContext;
      user_answer?: string;
    };

    let transcript = (providedTranscript || '').trim();

    if (!transcript) {
      if (!audio_url) return ok({ success: false, error: 'audio_url ou transcript obrigatório' });

      // 1) Baixa o áudio a partir da URL pública (mantém o payload do request pequeno).
      //    Erros de rede caem no try/catch externo do handler.
      const resp = await fetch(audio_url);
      if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
      const buffer = await resp.arrayBuffer();
      const mime = resp.headers.get('content-type') || 'audio/webm';

      // 2) Transcrição fiel (ElevenLabs Scribe v2 → fallback Gemini).
      transcript = await transcribeAudio(buffer, mime);
      if (!transcript || transcript === '[áudio inaudível]') {
        return ok({
          success: false,
          error: 'Não foi possível transcrever o áudio (inaudível ou vazio).',
          transcript: transcript || '',
        });
      }
    }

    // 3) IA preenche os campos da atividade com base SÓ no que foi dito.
    const ctx = activity_context || {};
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const weekday = new Date().toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    const teamList = Array.isArray(ctx.team_members) && ctx.team_members.length > 0
      ? ctx.team_members.slice(0, 50).join(', ')
      : '—';
    const coAssessorList = Array.isArray(ctx.co_assessor_names) && ctx.co_assessor_names.length > 0
      ? ctx.co_assessor_names.join(', ')
      : '—';
    const typesList = Array.isArray(ctx.activity_types) && ctx.activity_types.length > 0
      ? ctx.activity_types.slice(0, 40).map((t) => `${t.key} (${t.label})`).join(', ')
      : '';
    const ctxText = `Data de HOJE: ${today} (${weekday}) — use para resolver datas relativas ("amanhã", "sexta-feira", "dia 15").

Contexto da atividade:
- Título: ${ctx.title || '—'}
- Tipo: ${ctx.type || '—'}
- Cliente/Lead: ${ctx.lead_name || '—'}
- Contato: ${ctx.contact_name || '—'}
- Processo: ${ctx.process_title || '—'}
- Prazo atual: ${ctx.deadline || '—'}
- Notificação atual: ${ctx.notification_date || '—'}
- Prioridade atual: ${ctx.priority || '—'}
- Situação atual: ${ctx.status || '—'}
- Assessor responsável atual (principal): ${ctx.assessor_name || '—'}
- Co-assessores atuais: ${coAssessorList}
- Assessores da equipe (nomes válidos para assessor_names): ${teamList}${typesList ? `\n- Tipos de atividade válidos (keys para activity_type): ${typesList}` : ''}

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
- NÃO SEJA REDUNDANTE: só preencha um campo se a ligação realmente trouxer aquela informação. NÃO repita o mesmo conteúdo em campos diferentes só para não deixá-los vazios; cada campo tem função distinta (o que foi feito ≠ como está ≠ próximo passo). Deixar vazio é PREFERÍVEL a repetir ou usar texto genérico.
- PERGUNTA quando faltar informação essencial: se a ligação for confusa, inaudível em trechos importantes ou insuficiente para preencher com segurança, retorne uma pergunta objetiva em "clarifying_question" (uma frase, direta ao usuário) e preencha só o que der com segurança. Se estiver tudo claro, OMITA clarifying_question.
- COMANDOS DE EDIÇÃO: o áudio pode conter instruções diretas de edição (ex.: "apaga as observações", "pode limpar tudo que estava no próximo passo", "troca o que foi feito por X", "corrige o prazo pra sexta-feira", "muda a prioridade pra urgente", "passa essa atividade pro assessor Fulano", "marca como concluída", "renomeia a atividade para Y"). EXECUTE essas instruções: elas prevalecem sobre a regra de preservar o conteúdo atual.
  - Para APAGAR um campo de texto, inclua o nome dele em clear_fields (não basta retornar vazio — vazio significa "sem novidade").
  - Para SUBSTITUIR, retorne o novo conteúdo no campo (sem misturar com o antigo).
- METADADOS (deadline, notification_date, priority, status, assessor_names, title): preencha SOMENTE quando o áudio mencionar explicitamente prazo/data, prioridade, situação, responsável ou título. Caso contrário, OMITA o campo (não o inclua na resposta) — o valor atual é mantido. Para priority e status use exatamente um dos valores permitidos; nunca retorne string vazia nesses dois.
  - Datas SEMPRE no formato YYYY-MM-DD, resolvendo termos relativos com a data de hoje.
  - ASSESSORES: quando o áudio disser quem é/são o(s) responsável(is) (ex.: "os responsáveis são Fulano e Beltrano", "passa pro Fulano junto com a Ciclana"), retorne TODOS em assessor_names, na ordem falada (o PRIMEIRO vira o principal). Cada nome deve ser EXATAMENTE um dos nomes da equipe listados no contexto; ignore nomes que não corresponderem a ninguém da equipe. Se o áudio não falar de responsável, OMITA assessor_names.
- TIPO DA ATIVIDADE (activity_type): avalie qual dos tipos válidos listados no contexto é o MAIS ADEQUADO ao conteúdo da ligação + contexto (ex.: ligação sobre audiência marcada → audiencia; prazo processual → prazo). Se o tipo mais adequado for DIFERENTE do tipo atual da atividade, retorne a key dele em activity_type. Se o tipo atual já for o adequado (ou não houver como saber), OMITA o campo.
- @MENÇÃO A COLEGAS: quando o áudio pedir para AVISAR/CHAMAR/MENCIONAR um colega da equipe (ex.: "avisa a Fulana", "fala com o Beltrano sobre isso", "pede pro Ciclano dar uma olhada", "marca o Fulano aqui"), escreva "@NomeExato" DENTRO do texto do campo em que isso é dito (normalmente "Observações" ou "Próximo passo"), usando EXATAMENTE um dos nomes da equipe listados no contexto. Isso serve para notificar o colega. Só faça isso quando o áudio realmente pedir para avisar/chamar alguém — NÃO transforme em @menção nomes citados apenas como fato (ex.: "falei com o servidor João da vara" NÃO vira @João). Se o nome falado não corresponder a ninguém da equipe, escreva o nome normal, sem @.
- Escreva em português do Brasil, linguagem simples e nada rebuscada. Exemplo de tom: "Cobramos o devido andamento do processo" ou "Solicitamos que a Secretaria/Gabinete proceda com o impulso para seguirmos com os próximos passos".`;

    // Até 2 tentativas: erros transitórios do Gemini (429/503) ou resposta sem
    // tool_call não podem virar silenciosamente "nenhum campo identificado".
    let fields = { ...EMPTY_FIELDS };
    let fillError: string | null = null;
    let clarifyingQuestion: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
      const answerBlock = user_answer && user_answer.trim()
        ? `\n\nRESPOSTA DO USUÁRIO a uma pergunta anterior (use para completar o preenchimento; se ainda faltar algo, pergunte de novo):\n${user_answer.trim()}`
        : '';
      const fillData = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: fillSystem },
          { role: 'user', content: `${ctxText}\n\nTRANSCRIÇÃO DA LIGAÇÃO:\n${transcript}${answerBlock}` },
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
                title: { type: 'string', description: 'Novo título da atividade — apenas se o áudio pedir explicitamente para nomear/renomear. Senão, vazio.' },
                deadline: { type: 'string', description: 'Prazo da atividade em YYYY-MM-DD — apenas se o áudio mencionar prazo/data. Resolva datas relativas com a data de hoje. Senão, vazio.' },
                notification_date: { type: 'string', description: 'Data de notificação/lembrete em YYYY-MM-DD — apenas se mencionada. Senão, vazio.' },
                priority: { type: 'string', enum: ['baixa', 'normal', 'alta', 'urgente'], description: 'Prioridade — apenas se o áudio mencionar. Senão, OMITA este campo (não retorne vazio).' },
                status: { type: 'string', enum: ['pendente', 'em_andamento', 'concluida'], description: 'Situação da atividade — apenas se o áudio mencionar (ex.: "marca como concluída"). Senão, OMITA este campo (não retorne vazio).' },
                assessor_name: { type: 'string', description: 'LEGADO — prefira assessor_names. Assessor responsável único, EXATAMENTE um dos nomes da equipe do contexto. Senão, vazio.' },
                assessor_names: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'TODOS os assessores responsáveis ditos no áudio, na ordem falada (primeiro = principal). Cada um EXATAMENTE um dos nomes da equipe do contexto. Apenas se o áudio mencionar responsável; senão, OMITA.',
                },
                ...(Array.isArray(ctx.activity_types) && ctx.activity_types.length > 0 ? {
                  activity_type: {
                    type: 'string',
                    enum: ctx.activity_types.map((t) => t.key),
                    description: 'Key do tipo de atividade MAIS ADEQUADO ao conteúdo da ligação, apenas se for diferente do tipo atual. Senão, OMITA.',
                  },
                } : {}),
                clear_fields: {
                  type: 'array',
                  items: { type: 'string', enum: ['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'] },
                  description: 'Campos de texto que o áudio mandou APAGAR/limpar explicitamente.',
                },
                clarifying_question: { type: 'string', description: 'Pergunta objetiva ao usuário quando a ligação for confusa/insuficiente para preencher com segurança. OMITA se estiver tudo claro.' },
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
          if (parsed.clarifying_question && String(parsed.clarifying_question).trim()) {
            clarifyingQuestion = String(parsed.clarifying_question).trim();
          }
          delete parsed.clarifying_question;
          fields = { ...fields, ...parsed };
          fillError = null;
          break;
        }
        fillError = 'A IA respondeu sem retornar os campos (resposta vazia).';
        console.warn(`[transcribe-activity-call] tentativa ${attempt}: sem tool_call na resposta`);
      } catch (e: any) {
        fillError = e?.message || String(e);
        console.error(`[transcribe-activity-call] fill error (tentativa ${attempt}):`, e);
      }
    }

    // Mesmo se o preenchimento falhar, devolvemos a transcrição para o usuário aproveitar.
    return ok({
      success: true,
      transcript,
      fields,
      ...(clarifyingQuestion ? { clarifying_question: clarifyingQuestion } : {}),
      ...(fillError ? { fill_error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[transcribe-activity-call] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

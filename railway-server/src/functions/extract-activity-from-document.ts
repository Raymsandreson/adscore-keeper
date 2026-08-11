// Lê DOCUMENTOS (PDF), IMAGENS (print colado/arrastado) ou TEXTO puro e preenche os
// campos da atividade, de forma FIEL ao que está escrito (sem inventar).
// Retorna { success, extracted_text, fields }.
//
// Body: { text?: string, file_url?: string, file_urls?: string[], activity_context?: {...} }
// - text: conteúdo já em texto puro (colado pelo usuário). Convive com os arquivos:
//   quando vêm juntos, o texto entra como complemento.
// - file_url / file_urls: URL(s) pública(s) de arquivos (PDF, imagem, txt, md). Baixados
//   aqui e enviados ao Gemini. PDFs e imagens seguem via inlineData (Gemini lê
//   nativamente, inclusive OCR de print). TXT/MD viram texto direto.
//
// Reaproveita o MESMO prompt de "Preenchimento por Áudio" (transcribe-activity-call),
// só troca a origem da informação (documento em vez de ligação).
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB por arquivo — teto seguro pra inlineData do Gemini.
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // teto somado (vários prints de um mesmo documento).
const MAX_FILES = 6;

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
  // Metadados atuais — permitem que o documento os corrija/preencha (prazo, prioridade, responsável).
  deadline?: string;
  notification_date?: string;
  priority?: string;
  status?: string;
  assessor_name?: string;
  co_assessor_names?: string[];
  team_members?: string[];
  activity_types?: { key: string; label: string }[];
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

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  log: 'text/plain',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function guessMimeFromUrl(url: string, fallback: string): string {
  const clean = url.toLowerCase().split('?')[0];
  const ext = clean.split('.').pop() || '';
  // A extensão manda: o Storage costuma devolver octet-stream pra print colado.
  return EXT_MIME[ext] || fallback;
}

/** Formatos de imagem que o Gemini lê nativamente (OCR incluso). */
const GEMINI_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { text, file_url, file_urls, activity_context, user_answer } = (req.body || {}) as {
      text?: string;
      file_url?: string;
      file_urls?: string[];
      activity_context?: ActivityContext;
      user_answer?: string;
    };

    // Aceita file_urls (novo, vários prints/páginas) e file_url (legado). Dedup preserva ordem.
    const urls = Array.from(new Set([
      ...(Array.isArray(file_urls) ? file_urls : []),
      ...(file_url ? [file_url] : []),
    ].map((u) => String(u || '').trim()).filter(Boolean))).slice(0, MAX_FILES);

    const pastedText = (text || '').trim();
    if (!pastedText && urls.length === 0) {
      return ok({ success: false, error: 'Envie text, file_url ou file_urls' });
    }

    // 1) Prepara a "fonte de informação": texto puro e/ou partes multimodais
    // (PDF e imagem viram inlineData base64; TXT/MD viram texto direto).
    const textChunks: string[] = [];
    const inlineParts: { type: 'image_url'; image_url: { url: string } }[] = [];
    const sourceKinds: string[] = [];
    let totalBytes = 0;

    for (const url of urls) {
      const resp = await fetch(url);
      if (!resp.ok) return ok({ success: false, error: `Falha ao baixar arquivo (${resp.status})` });
      const rawMime = resp.headers.get('content-type') || 'application/octet-stream';
      const mime = guessMimeFromUrl(url, rawMime);
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) {
        return ok({ success: false, error: `Arquivo muito grande (>${Math.round(MAX_BYTES / 1024 / 1024)}MB).` });
      }
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return ok({ success: false, error: `Arquivos somam mais de ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB. Envie menos de uma vez.` });
      }

      if (mime.startsWith('text/') || mime === 'application/rtf') {
        const decoded = new TextDecoder('utf-8').decode(buffer).trim();
        if (decoded) textChunks.push(decoded);
        sourceKinds.push('documento de texto');
      } else if (mime === 'application/pdf' || GEMINI_IMAGE_MIMES.has(mime)) {
        // PDF e imagem seguem como inlineData — o Gemini lê nativamente (OCR de print incluso).
        const base64 = Buffer.from(buffer).toString('base64');
        inlineParts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
        sourceKinds.push(mime === 'application/pdf' ? 'PDF' : 'imagem/print');
      } else {
        return ok({ success: false, error: `Tipo de arquivo não suportado: ${mime}. Envie PDF, imagem (PNG/JPG/WEBP), TXT ou MD.` });
      }
    }

    if (pastedText) {
      textChunks.push(pastedText);
      sourceKinds.push('texto colado');
    }

    const documentText = textChunks.join('\n\n---\n\n').trim();
    if (!documentText && inlineParts.length === 0) {
      return ok({ success: false, error: 'Documento vazio ou ilegível.' });
    }

    const uniqueKinds = Array.from(new Set(sourceKinds));
    const sourceLabel = uniqueKinds.length > 0
      ? `MATERIAL ENVIADO (${uniqueKinds.join(' + ')})`.toUpperCase()
      : 'TEXTO FORNECIDO';

    // 2) Monta contexto da atividade (mesma estrutura da função de áudio).
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

Conteúdo ATUAL dos campos (preserve o que ainda for válido e complemente com o documento):
- Como está: ${ctx.current_status || '(vazio)'}
- O que foi feito: ${ctx.what_was_done || '(vazio)'}
- Próximo passo: ${ctx.next_steps || '(vazio)'}
- Solicitação: ${ctx.solicitacao || '(vazio)'}
- Resposta do juízo: ${ctx.resposta_juizo || '(vazio)'}
- Observações: ${ctx.notes || '(vazio)'}${buildContextSections(ctx)}${user_answer && user_answer.trim() ? `\n\nRESPOSTA DO USUÁRIO a uma pergunta anterior (use para completar o preenchimento; se ainda faltar algo, pergunte de novo):\n${user_answer.trim()}` : ''}`;

    // Prompt: MESMA lógica do preenchimento por áudio, adaptado pra origem "documento/texto".
    const fillSystem = `Você é um assistente jurídico de um escritório de advocacia. Foi enviado um DOCUMENTO (PDF, publicação, despacho, e-mail, ata, laudo), uma ou mais IMAGENS/PRINTS de tela (ex.: print do Meu INSS, de um sistema do tribunal, de uma conversa) ou TEXTO fornecido pelo usuário, e você recebeu o CONTEÚDO desse material MAIS o contexto da atividade (campos atuais, fluxo de trabalho, atividades anteriores do processo e mensagens internas).

Quando vier IMAGEM/PRINT: leia todo o texto visível na tela (OCR), inclusive cabeçalhos, números de protocolo, datas, horários e endereços. Vários arquivos são páginas/partes do MESMO material — consolide tudo antes de preencher. Se a imagem estiver ilegível ou cortada num ponto essencial, use clarifying_question em vez de adivinhar.

Sua tarefa: ATUALIZAR os campos da atividade COMBINANDO o contexto existente com o que consta no documento. Regras:
- NÃO descarte informação válida que já estava nos campos atuais — preserve e integre com o que o documento acrescenta. Se o documento contradiz/atualiza algo, prevaleça a informação mais nova do documento.
- Use o histórico de atividades anteriores e as mensagens internas apenas como contexto para escrever de forma coerente com o andamento do processo — NÃO copie esse histórico para dentro dos campos.
- Para "Próximo passo", considere o próximo passo do fluxo de trabalho quando fizer sentido com o que consta no documento.
- Seja fiel e objetivo. NÃO invente fatos, nomes, datas ou prazos que não estejam no documento ou no contexto fornecido. Se um campo não tiver informação, retorne string vazia.
- NÃO SEJA REDUNDANTE: só preencha um campo se o documento realmente trouxer aquela informação. NÃO repita o mesmo conteúdo em campos diferentes só para não deixá-los vazios; cada campo deve ter uma função distinta (o que foi feito ≠ como está ≠ próximo passo). Deixar um campo vazio é PREFERÍVEL a enchê-lo com repetição ou texto genérico.
- PERGUNTA quando faltar informação essencial: se o documento for ambíguo, ilegível ou insuficiente para preencher os campos com segurança, retorne uma pergunta objetiva em "clarifying_question" (uma frase, direta ao usuário) e preencha só o que der com segurança. Se estiver tudo claro, OMITA clarifying_question.
- METADADOS (deadline, notification_date, priority, status, assessor_names, title): preencha SOMENTE quando o documento mencionar explicitamente prazo/data, prioridade, situação, responsável ou um título/assunto claro. Caso contrário, OMITA o campo (não o inclua na resposta) — o valor atual é mantido. Para priority e status use exatamente um dos valores permitidos; nunca retorne string vazia nesses dois.
  - Datas SEMPRE no formato YYYY-MM-DD, resolvendo termos relativos ("em 15 dias", "até sexta") com a data de hoje.
  - PRAZO: se o documento traz um prazo processual (ex.: "prazo de 15 dias", "manifeste-se em 5 dias", data de audiência), calcule/extraia a data e retorne em deadline. Só quando o documento realmente indicar um prazo.
  - ASSESSORES: só preencha assessor_names se o documento indicar explicitamente quem é o responsável pela atividade. Cada nome deve ser EXATAMENTE um dos nomes da equipe listados no contexto; ignore nomes que não corresponderem a ninguém da equipe. Na dúvida, OMITA (documentos raramente designam responsável interno).
- TIPO DA ATIVIDADE (activity_type): avalie qual dos tipos válidos listados no contexto é o MAIS ADEQUADO ao conteúdo do documento + contexto (ex.: intimação de audiência → audiencia; despacho com prazo → prazo; laudo pericial → diligencia). Se o tipo mais adequado for DIFERENTE do tipo atual da atividade, retorne a key dele em activity_type. Se o tipo atual já for o adequado (ou não houver como saber), OMITA o campo.
- Escreva em português do Brasil, linguagem simples e nada rebuscada. Exemplo de tom: "Cobramos o devido andamento do processo" ou "Solicitamos que a Secretaria/Gabinete proceda com o impulso para seguirmos com os próximos passos".

MODELO OBRIGATÓRIO — comprovantes do Meu INSS. Detecte pelo conteúdo: "PROTOCOLO DE REQUERIMENTO" / "COMPROVANTE DO PROTOCOLO", comprovante de agendamento de perícia médica e/ou avaliação social, ou comprovante de cumprimento de exigência do INSS. Quando o documento for um desses, IGNORE o estilo livre acima e preencha what_was_done, current_status e next_steps EXATAMENTE nos modelos abaixo — troque só o que está entre colchetes pelos dados do documento e mantenha os asteriscos (viram negrito no WhatsApp):

1) current_status ("Como está"):
- Se o comprovante NÃO traz perícia médica nem avaliação social marcadas (ex.: protocolo recém-aberto):
"Pedido está em análise documental pelo inss."
- Se traz perícia médica e/ou avaliação social marcadas, comece com "A perícia médica e a avaliação social estão marcadas:" (se só uma estiver marcada, ajuste: "A perícia médica está marcada:" / "A avaliação social está marcada:") e inclua APENAS o(s) bloco(s) do(s) serviço(s) marcado(s), neste formato literal:

*Perícia médica:*
Dia: [data e hora da perícia]
Local: [nome da unidade/agência]
Endereço: [endereço da unidade]
Orientação: Levar documento de identificação com foto (RG ou CNH), toda documentação médica que dispuser (exames, atestados, laudos médicos etc) e chegar pontualmente (25min de antecedência do horário agendado).

*Avaliação social:*
Data: [data e hora da avaliação]
Local: [nome da unidade/agência]
Endereço: [endereço da unidade]
Orientações: Levar Cadúnico, toda documentação médica que dispuser (exames, atestados, laudos médicos etc), comprovante de residência e documentação com foto (RG ou CNH) atualizados. Chegar pontualmente (15min de antecedência do horário agendado).

2) what_was_done ("O que foi feito"):
- Protocolo sem perícia/avaliação marcadas: "Protocolo administrativo."
- Protocolo com perícia e avaliação marcadas: "Protocolo administrativo e marcadas perícia médica e avaliação social." (cite só o serviço marcado, se for um só)
- Comprovante de cumprimento de exigência: "Cumprida exigência."

3) next_steps ("Próximo passo"):
- Sem perícia/avaliação marcadas: "Continuar acompanhando e monitorando a situação do pedido do benefício e aguardar vaga para marcar perícia médica e avaliação social."
- Com perícia/avaliação já marcadas: "Continuar acompanhando e monitorando a situação do pedido do benefício e aguardar a realização da perícia médica e da avaliação social."

Dados do comprovante que não couberem no modelo (número do protocolo, serviço/benefício requerido, unidade, data de entrada do requerimento) vão resumidos em notes. Dia/Data nos blocos acima em DD/MM/AAAA com horário quando o comprovante trouxer. Se a perícia/avaliação tiver data marcada, retorne essa data também em deadline (YYYY-MM-DD).`;

    // 3) Monta a mensagem do usuário: contexto + material (arquivos multimodais e/ou texto).
    const userParts: any[] = [{ type: 'text', text: `${ctxText}\n\n${sourceLabel}:` }];
    if (inlineParts.length > 0) {
      for (const part of inlineParts) userParts.push(part);
      userParts.push({
        type: 'text',
        text: inlineParts.length > 1
          ? `Os ${inlineParts.length} arquivos acima (PDFs e/ou imagens/prints) fazem parte do MESMO material — leia todos na ordem, trate-os como páginas/partes de um conjunto só e extraia a informação relevante para preencher os campos da atividade. Em imagens, faça a leitura do texto que aparece na tela (OCR).`
          : 'Leia integralmente o arquivo acima e extraia a informação relevante para preencher os campos da atividade. Se for uma imagem/print, faça a leitura do texto que aparece na tela (OCR).',
      });
    }
    if (documentText) {
      userParts.push({ type: 'text', text: documentText.slice(0, 200_000) });
    }

    let fields = { ...EMPTY_FIELDS };
    let fillError: string | undefined;
    let clarifyingQuestion: string | undefined;
    try {
      const fillData = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: fillSystem },
          { role: 'user', content: userParts },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'fill_activity_fields_from_document',
            description: 'Preenche os campos da atividade com base no documento fornecido.',
            parameters: {
              type: 'object',
              properties: {
                what_was_done: { type: 'string', description: 'O que foi feito/realizado — extraia do documento (ex.: publicação, decisão, ata, laudo, e-mail).' },
                current_status: { type: 'string', description: 'Como está a situação agora, considerando o que o documento traz.' },
                next_steps: { type: 'string', description: 'Próximo passo a ser tomado, incluindo prazos/datas se mencionados no documento.' },
                solicitacao: { type: 'string', description: 'O que foi solicitado/pedido no documento, se houver.' },
                resposta_juizo: { type: 'string', description: 'Resposta ou posição da vara/cartório/juízo/órgão (decisão, despacho, sentença), se houver.' },
                notes: { type: 'string', description: 'Observações adicionais relevantes constantes no documento.' },
                title: { type: 'string', description: 'Título/assunto curto da atividade (até 8 palavras) — apenas se o documento deixar claro o assunto. Senão, vazio.' },
                deadline: { type: 'string', description: 'Prazo da atividade em YYYY-MM-DD — apenas se o documento mencionar prazo/data. Resolva datas relativas com a data de hoje. Senão, vazio.' },
                notification_date: { type: 'string', description: 'Data de notificação/lembrete em YYYY-MM-DD — apenas se mencionada. Senão, vazio.' },
                priority: { type: 'string', enum: ['baixa', 'normal', 'alta', 'urgente'], description: 'Prioridade — apenas se o documento indicar urgência. Senão, OMITA este campo (não retorne vazio).' },
                status: { type: 'string', enum: ['pendente', 'em_andamento', 'concluida'], description: 'Situação da atividade — apenas se o documento indicar. Senão, OMITA este campo (não retorne vazio).' },
                assessor_name: { type: 'string', description: 'LEGADO — prefira assessor_names. Assessor responsável único, EXATAMENTE um dos nomes da equipe do contexto. Senão, vazio.' },
                assessor_names: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'TODOS os assessores responsáveis indicados no documento (primeiro = principal). Cada um EXATAMENTE um dos nomes da equipe do contexto. Apenas se o documento designar responsável; senão, OMITA.',
                },
                ...(Array.isArray(ctx.activity_types) && ctx.activity_types.length > 0 ? {
                  activity_type: {
                    type: 'string',
                    enum: ctx.activity_types.map((t) => t.key),
                    description: 'Key do tipo de atividade MAIS ADEQUADO ao conteúdo do documento, apenas se for diferente do tipo atual. Senão, OMITA.',
                  },
                } : {}),
                clarifying_question: { type: 'string', description: 'Pergunta objetiva ao usuário quando o documento for ambíguo/insuficiente para preencher com segurança. OMITA se estiver tudo claro.' },
              },
              required: ['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'fill_activity_fields_from_document' } },
      });

      const toolCall = fillData?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        // clarifying_question não é um campo da atividade — sai dos fields e vira top-level.
        if (parsed.clarifying_question && String(parsed.clarifying_question).trim()) {
          clarifyingQuestion = String(parsed.clarifying_question).trim();
        }
        delete parsed.clarifying_question;
        fields = { ...fields, ...parsed };
      }
    } catch (e: any) {
      console.error('[extract-activity-from-document] fill error:', e);
      fillError = e?.message || String(e);
    }

    // Devolve preview do texto (útil quando veio de PDF/imagem — mostra que a IA leu algo).
    const preview = documentText
      ? documentText.slice(0, 800)
      : `(${inlineParts.length} arquivo(s) processado(s) nativamente pela IA — ${uniqueKinds.join(' + ')})`;

    return ok({
      success: true,
      extracted_text: preview,
      fields,
      ...(clarifyingQuestion ? { clarifying_question: clarifyingQuestion } : {}),
      ...(fillError ? { fill_error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[extract-activity-from-document] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

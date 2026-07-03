// Lê um DOCUMENTO (PDF) ou TEXTO puro e preenche os campos da atividade,
// de forma FIEL ao que está escrito (sem inventar). Retorna { success, extracted_text, fields }.
//
// Body: { text?: string, file_url?: string, activity_context?: {...} }
// - text: conteúdo já em texto puro (colado pelo usuário).
// - file_url: URL pública de um arquivo (PDF, txt, md). Baixado aqui e enviado ao Gemini.
//   PDFs seguem via inlineData (Gemini lê nativamente). TXT/MD viram texto direto.
//
// Reaproveita o MESMO prompt de "Preenchimento por Áudio" (transcribe-activity-call),
// só troca a origem da informação (documento em vez de ligação).
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-2.5-flash';
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — teto seguro pra inlineData do Gemini.

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

function guessMimeFromUrl(url: string, fallback: string): string {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.rtf')) return 'application/rtf';
  return fallback;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { text, file_url, activity_context } = (req.body || {}) as {
      text?: string;
      file_url?: string;
      activity_context?: ActivityContext;
    };

    if (!text && !file_url) {
      return ok({ success: false, error: 'Envie text ou file_url' });
    }

    // 1) Prepara a "fonte de informação" — texto puro OU parte multimodal (PDF/base64).
    let documentText = (text || '').trim();
    let inlinePart: { type: 'image_url'; image_url: { url: string } } | null = null;
    let sourceLabel = 'TEXTO FORNECIDO';

    if (file_url && !documentText) {
      const resp = await fetch(file_url);
      if (!resp.ok) return ok({ success: false, error: `Falha ao baixar arquivo (${resp.status})` });
      const rawMime = resp.headers.get('content-type') || 'application/octet-stream';
      const mime = guessMimeFromUrl(file_url, rawMime);
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) {
        return ok({ success: false, error: `Arquivo muito grande (>${Math.round(MAX_BYTES / 1024 / 1024)}MB).` });
      }

      if (mime.startsWith('text/') || mime === 'application/rtf') {
        documentText = new TextDecoder('utf-8').decode(buffer).trim();
        sourceLabel = 'DOCUMENTO DE TEXTO';
      } else if (mime === 'application/pdf') {
        // Envia o PDF como inlineData pro Gemini (leitura nativa via OCR/parser interno).
        const base64 = Buffer.from(buffer).toString('base64');
        inlinePart = { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } };
        sourceLabel = 'PDF ANEXADO';
      } else {
        return ok({ success: false, error: `Tipo de arquivo não suportado: ${mime}. Envie PDF, TXT ou MD.` });
      }
    }

    if (!documentText && !inlinePart) {
      return ok({ success: false, error: 'Documento vazio ou ilegível.' });
    }

    // 2) Monta contexto da atividade (mesma estrutura da função de áudio).
    const ctx = activity_context || {};
    const ctxText = `Contexto da atividade:
- Título: ${ctx.title || '—'}
- Tipo: ${ctx.type || '—'}
- Cliente/Lead: ${ctx.lead_name || '—'}
- Contato: ${ctx.contact_name || '—'}
- Processo: ${ctx.process_title || '—'}

Conteúdo ATUAL dos campos (preserve o que ainda for válido e complemente com o documento):
- Como está: ${ctx.current_status || '(vazio)'}
- O que foi feito: ${ctx.what_was_done || '(vazio)'}
- Próximo passo: ${ctx.next_steps || '(vazio)'}
- Solicitação: ${ctx.solicitacao || '(vazio)'}
- Resposta do juízo: ${ctx.resposta_juizo || '(vazio)'}
- Observações: ${ctx.notes || '(vazio)'}${buildContextSections(ctx)}`;

    // Prompt: MESMA lógica do preenchimento por áudio, adaptado pra origem "documento/texto".
    const fillSystem = `Você é um assistente jurídico de um escritório de advocacia. Foi anexado um DOCUMENTO (PDF, publicação, despacho, e-mail, ata, laudo) ou TEXTO fornecido pelo usuário, e você recebeu o CONTEÚDO desse documento MAIS o contexto da atividade (campos atuais, fluxo de trabalho, atividades anteriores do processo e mensagens internas).

Sua tarefa: ATUALIZAR os campos da atividade COMBINANDO o contexto existente com o que consta no documento. Regras:
- NÃO descarte informação válida que já estava nos campos atuais — preserve e integre com o que o documento acrescenta. Se o documento contradiz/atualiza algo, prevaleça a informação mais nova do documento.
- Use o histórico de atividades anteriores e as mensagens internas apenas como contexto para escrever de forma coerente com o andamento do processo — NÃO copie esse histórico para dentro dos campos.
- Para "Próximo passo", considere o próximo passo do fluxo de trabalho quando fizer sentido com o que consta no documento.
- Seja fiel e objetivo. NÃO invente fatos, nomes, datas ou prazos que não estejam no documento ou no contexto fornecido. Se um campo não tiver informação, retorne string vazia.
- Escreva em português do Brasil, linguagem simples e nada rebuscada. Exemplo de tom: "Cobramos o devido andamento do processo" ou "Solicitamos que a Secretaria/Gabinete proceda com o impulso para seguirmos com os próximos passos".`;

    // 3) Monta a mensagem do usuário: contexto + documento (texto puro ou multimodal).
    const userParts: any[] = [{ type: 'text', text: `${ctxText}\n\n${sourceLabel}:` }];
    if (inlinePart) {
      userParts.push(inlinePart);
      userParts.push({ type: 'text', text: 'Leia integralmente o PDF acima e extraia a informação relevante para preencher os campos da atividade.' });
    } else {
      userParts.push({ type: 'text', text: documentText.slice(0, 200_000) });
    }

    let fields = { ...EMPTY_FIELDS };
    let fillError: string | undefined;
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
        fields = { ...fields, ...parsed };
      }
    } catch (e: any) {
      console.error('[extract-activity-from-document] fill error:', e);
      fillError = e?.message || String(e);
    }

    // Devolve preview do texto (útil quando veio de PDF — mostra que a IA leu algo).
    const preview = documentText
      ? documentText.slice(0, 800)
      : '(PDF processado nativamente pela IA)';

    return ok({
      success: true,
      extracted_text: preview,
      fields,
      ...(fillError ? { fill_error: fillError } : {}),
    });
  } catch (e: any) {
    console.error('[extract-activity-from-document] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

// Monta a ROTINA SEMANAL (blocos de horário) a partir do que a pessoa descreve —
// por texto digitado, por ÁUDIO já transcrito, por PDF/print/TXT anexado, ou os três juntos.
// Retorna { success, blocks, unmatched, summary, clarifying_question? }.
//
// POR QUE ESTA FUNÇÃO EXISTE (o bug que ela conserta):
// A versão anterior (edge `suggest-routine` no Cloud) mandava a IA INVENTAR os tipos
// de atividade ("reuniao", "audiencia", isCustom: true) e nunca recebia os tipos que
// existem de verdade no banco. Só que as keys reais são `custom_<timestamp>` — a tela
// descartava tudo que não casasse com uma key existente e mostrava
// "A IA não conseguiu mapear sugestões aos tipos globais existentes". Não era falha
// eventual da IA: era contrato quebrado, falhava sempre.
// Aqui os tipos reais VÃO no prompt e, mais que isso, viram `enum` do parâmetro
// `activityType` na tool call — a IA fica impedida de devolver uma key que não existe.
//
// Body:
// - description?: string   — a semana descrita (digitada ou ditada; o ditado chega já transcrito)
// - text?: string          — texto colado (escala, contrato, e-mail com os horários)
// - file_url? / file_urls? — URL(s) pública(s) de PDF, imagem (print) ou TXT/MD
// - available_types: [{ key, label, description? }]  — tipos GLOBAIS existentes (obrigatório)
// - current_blocks?: [{ activityType, label, days, startHour, startMinute, endHour, endMinute }]
//   — a rotina atual, para a IA editar em vez de recomeçar do zero ("tire a reunião de sexta")
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.ROUTINE_AI_MODEL || process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const MAX_BYTES = 15 * 1024 * 1024; // por arquivo — teto seguro do inlineData do Gemini
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_FILES = 6;
const MAX_TYPES = 60;

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
};

/** Formatos de imagem que o Gemini lê nativamente (OCR incluso). */
const GEMINI_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

function guessMimeFromUrl(url: string, fallback: string): string {
  const clean = url.toLowerCase().split('?')[0];
  const ext = clean.split('.').pop() || '';
  // A extensão manda: o Storage devolve octet-stream para print colado.
  return EXT_MIME[ext] || fallback;
}

interface AvailableType {
  key: string;
  label: string;
  description?: string | null;
}

interface CurrentBlock {
  activityType?: string;
  label?: string;
  days?: number[];
  startHour?: number;
  startMinute?: number;
  endHour?: number;
  endMinute?: number;
}

const DAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta'];
const fmt = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;

function describeCurrentBlocks(blocks: CurrentBlock[], typeLabel: (key?: string) => string): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return '(rotina vazia — nenhum bloco configurado ainda)';
  return blocks
    .slice(0, 80)
    .map((b) => {
      const dias = Array.isArray(b.days) && b.days.length > 0
        ? b.days.map((d) => DAY_NAMES[d] || `dia${d}`).join(', ')
        : '(sem dia)';
      return `- ${typeLabel(b.activityType)} | ${dias} | ${fmt(Number(b.startHour) || 0, Number(b.startMinute) || 0)}–${fmt(Number(b.endHour) || 0, Number(b.endMinute) || 0)}`;
    })
    .join('\n');
}

/** Encaixa um minuto solto na grade de 15 em 15 que a tela usa. */
export function snapMinute(v: unknown): number {
  const n = Math.round(Number(v) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const snapped = Math.round(n / 15) * 15;
  return snapped >= 60 ? 45 : snapped;
}

export function clampHour(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, n));
}

/**
 * Passa a limpo o que a IA devolveu. É a última tranca contra o bug que originou
 * esta função: bloco com key que NÃO existe é descartado aqui, nunca chega na tela
 * fingindo ser tipo válido. Também conserta horário impossível em vez de jogar o
 * bloco fora — o pedido da pessoa é real, só a aritmética da IA que escorregou.
 */
export function sanitizeBlocks(raw: unknown, types: AvailableType[]) {
  const validKeys = new Set(types.map((t) => t.key));
  const labelOf = (key: string) => types.find((t) => t.key === key)?.label || key;

  return (Array.isArray(raw) ? raw : [])
    .filter((b: any) => validKeys.has(String(b?.activityType || '')))
    .map((b: any) => {
      const startHour = clampHour(b.startHour, 9);
      const startMinute = snapMinute(b.startMinute);
      let endHour = clampHour(b.endHour, startHour + 1);
      let endMinute = snapMinute(b.endMinute);
      // Fim antes do início é bloco impossível: empurra uma hora, sem descartar o bloco.
      if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
        endHour = Math.min(23, startHour + 1);
        endMinute = startMinute;
      }
      const days: number[] = Array.isArray(b.days)
        ? Array.from(new Set<number>(b.days.map((d: any) => Math.floor(Number(d))).filter((d: number) => Number.isFinite(d) && d >= 0 && d <= 4))).sort((x, y) => x - y)
        : [];
      return {
        activityType: String(b.activityType),
        label: labelOf(String(b.activityType)),
        // Sem dia utilizável a pessoa ficaria com um bloco invisível na grade:
        // a semana inteira é o padrão que ela consegue ver e corrigir.
        days: days.length > 0 ? days : [0, 1, 2, 3, 4],
        startHour,
        startMinute,
        endHour,
        endMinute,
        motivo: b.motivo ? String(b.motivo).slice(0, 200) : undefined,
      };
    });
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const {
      description,
      text,
      file_url,
      file_urls,
      available_types,
      current_blocks,
      user_answer,
    } = (req.body || {}) as {
      description?: string;
      text?: string;
      file_url?: string;
      file_urls?: string[];
      available_types?: AvailableType[];
      current_blocks?: CurrentBlock[];
      user_answer?: string;
    };

    const types = (Array.isArray(available_types) ? available_types : [])
      .map((t) => ({
        key: String(t?.key || '').trim(),
        label: String(t?.label || '').trim(),
        description: t?.description ? String(t.description).trim() : '',
      }))
      .filter((t) => t.key && t.label)
      .slice(0, MAX_TYPES);

    // Sem os tipos reais a função não tem como montar rotina que a tela aceite —
    // é exatamente o erro que ela veio consertar. Melhor falhar dizendo isso.
    if (types.length === 0) {
      return ok({ success: false, error: 'Nenhum tipo de atividade disponível para montar a rotina.' });
    }

    const urls = Array.from(new Set([
      ...(Array.isArray(file_urls) ? file_urls : []),
      ...(file_url ? [file_url] : []),
    ].map((u) => String(u || '').trim()).filter(Boolean))).slice(0, MAX_FILES);

    const spoken = String(description || '').trim();
    const pasted = String(text || '').trim();
    if (!spoken && !pasted && urls.length === 0) {
      return ok({ success: false, error: 'Descreva a semana, cole um texto ou anexe um arquivo.' });
    }

    // 1) Fonte de informação: texto puro e/ou partes multimodais (PDF/print viram inlineData).
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
        const base64 = Buffer.from(buffer).toString('base64');
        inlineParts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
        sourceKinds.push(mime === 'application/pdf' ? 'PDF' : 'imagem/print');
      } else {
        return ok({ success: false, error: `Tipo de arquivo não suportado: ${mime}. Envie PDF, imagem (PNG/JPG/WEBP), TXT ou MD.` });
      }
    }

    if (pasted) { textChunks.push(pasted); sourceKinds.push('texto colado'); }

    const typeLabel = (key?: string) => {
      const found = types.find((t) => t.key === key);
      return found ? found.label : (key || '(tipo removido)');
    };

    const typesList = types
      .map((t) => `- key: ${t.key} | nome: ${t.label}${t.description ? ` | o que é: ${t.description}` : ''}`)
      .join('\n');

    const atual = describeCurrentBlocks(Array.isArray(current_blocks) ? current_blocks : [], typeLabel);

    const system = `Você organiza a ROTINA SEMANAL de trabalho de uma equipe de escritório de advocacia, montando blocos de horário de segunda a sexta.

REGRA MAIS IMPORTANTE — TIPOS FECHADOS:
Você só pode usar os tipos de atividade que existem no sistema, listados abaixo. É PROIBIDO inventar tipo novo, inventar key ou usar key que não esteja na lista. Ao ler o pedido, escolha SEMPRE o tipo existente mais próximo do que a pessoa descreveu (ex.: "atender cliente" → o tipo de atendimento que existir; "audiência" → o tipo de audiência/prazo que existir).
Se algo que a pessoa pediu não tiver NENHUM tipo parecido na lista, NÃO force: registre esse pedido em "unmatched" com as palavras dela, e siga montando o resto.

TIPOS DE ATIVIDADE EXISTENTES (use exatamente estas keys):
${typesList}

ROTINA ATUAL DA PESSOA (o ponto de partida — edite a partir dela quando o pedido for de ajuste, ex.: "tira a reunião de sexta", "põe meia hora a mais na filtragem"):
${atual}

COMO MONTAR OS BLOCOS:
- days: números de 0 a 4 (0=segunda, 1=terça, 2=quarta, 3=quinta, 4=sexta). Um bloco que se repete a semana toda usa [0,1,2,3,4] — não crie cinco blocos iguais.
- Horário: startHour/endHour de 0 a 23; startMinute/endMinute só podem ser 0, 15, 30 ou 45. Respeite o horário FALADO pela pessoa (se ela disse 8h30, use startHour 8 e startMinute 30).
- endHour/endMinute sempre DEPOIS de startHour/startMinute, no mesmo dia.
- NÃO sobreponha dois blocos no mesmo dia e horário.
- Quando a pessoa não disser horário, distribua de forma realista dentro do expediente (8h–18h), com almoço livre entre 12h e 14h.
- Devolva a rotina COMPLETA que deve valer no fim (os blocos que ficam), não só o que mudou.

RESPONDA A VERDADE: não invente compromisso que a pessoa não citou, não preencha a semana só para parecer cheia. Bloco a mais é hora de trabalho tomada à toa.
Se o pedido for ambíguo a ponto de você não conseguir decidir (ex.: ela citou um horário sem dizer o dia), preencha o que der com segurança e faça UMA pergunta objetiva em clarifying_question.
Em "summary", explique em 1 ou 2 frases, em português simples, o que você montou — é o que a pessoa lê antes de aplicar.`;

    const documentText = textChunks.join('\n\n---\n\n').trim();
    const userParts: any[] = [];
    const pedido = [
      spoken ? `PEDIDO DA PESSOA (digitado ou ditado por voz):\n${spoken}` : '',
      user_answer && user_answer.trim() ? `RESPOSTA DELA a uma pergunta anterior sua:\n${user_answer.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    userParts.push({ type: 'text', text: pedido || 'Monte a rotina com base no material enviado abaixo.' });

    if (inlineParts.length > 0) {
      for (const part of inlineParts) userParts.push(part);
      userParts.push({
        type: 'text',
        text: inlineParts.length > 1
          ? `Os ${inlineParts.length} arquivos acima (PDFs e/ou prints) fazem parte do MESMO material — leia todos na ordem e tire deles os dias e horários da rotina. Em imagens, leia o texto da tela (OCR).`
          : 'Leia o arquivo acima e tire dele os dias e horários da rotina. Se for print, leia o texto da tela (OCR).',
      });
    }
    if (documentText) {
      userParts.push({ type: 'text', text: `MATERIAL ENVIADO (${Array.from(new Set(sourceKinds)).join(' + ') || 'texto'}):\n${documentText.slice(0, 200_000)}` });
    }

    const data = await geminiChat({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userParts },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'montar_rotina_semanal',
          description: 'Devolve os blocos de horário da rotina semanal usando apenas os tipos de atividade existentes.',
          parameters: {
            type: 'object',
            properties: {
              blocks: {
                type: 'array',
                description: 'Blocos que devem compor a rotina no fim. Vazio só se nada do pedido casar com os tipos existentes.',
                items: {
                  type: 'object',
                  properties: {
                    activityType: {
                      type: 'string',
                      enum: types.map((t) => t.key),
                      description: 'Key do tipo existente. Obrigatoriamente uma das keys da lista.',
                    },
                    days: {
                      type: 'array',
                      items: { type: 'integer' },
                      description: 'Dias da semana: 0=segunda … 4=sexta.',
                    },
                    startHour: { type: 'integer', description: 'Hora de início (0–23).' },
                    startMinute: { type: 'integer', description: 'Minuto de início: 0, 15, 30 ou 45.' },
                    endHour: { type: 'integer', description: 'Hora de fim (0–23), depois do início.' },
                    endMinute: { type: 'integer', description: 'Minuto de fim: 0, 15, 30 ou 45.' },
                    motivo: { type: 'string', description: 'Em poucas palavras, de onde no pedido/documento saiu este bloco.' },
                  },
                  required: ['activityType', 'days', 'startHour', 'endHour'],
                },
              },
              unmatched: {
                type: 'array',
                items: { type: 'string' },
                description: 'O que a pessoa pediu e NÃO tem tipo correspondente no sistema, nas palavras dela.',
              },
              summary: { type: 'string', description: 'Uma ou duas frases dizendo o que foi montado.' },
              clarifying_question: { type: 'string', description: 'Pergunta objetiva quando faltar informação essencial. OMITA se estiver claro.' },
            },
            required: ['blocks', 'summary'],
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'montar_rotina_semanal' } },
    });

    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return ok({ success: false, error: 'A IA não devolveu a rotina no formato esperado. Tente descrever de novo.' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return ok({ success: false, error: 'A IA devolveu um formato inválido. Tente de novo.' });
    }

    const blocks = sanitizeBlocks(parsed.blocks, types);

    const unmatched = (Array.isArray(parsed.unmatched) ? parsed.unmatched : [])
      .map((u: any) => String(u || '').trim())
      .filter(Boolean)
      .slice(0, 12);

    return ok({
      success: true,
      blocks,
      unmatched,
      summary: parsed.summary ? String(parsed.summary).trim() : '',
      clarifying_question: parsed.clarifying_question ? String(parsed.clarifying_question).trim() : undefined,
      // Compatibilidade com a versão antiga da tela (que lia `configs`).
      configs: blocks,
    });
  } catch (e: any) {
    console.error('[suggest-routine] error:', e);
    return res.status(200).json({ success: false, error: e?.message || 'Erro ao montar a rotina' });
  }
};

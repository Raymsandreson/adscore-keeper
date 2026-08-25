// Fonte única da leitura do Despacho dos e-mails do INSS.
//
// O INSS não manda "deferido/indeferido" no assunto — só "Concluída". O veredito
// real fica no campo "Despacho:" do corpo. Estas funções extraem Serviço/Despacho
// e classificam o resultado a partir dele.
//
// NOTA (dívida a quitar): gmail-inss-sync.ts mantém uma cópia inline destas mesmas
// funções para o caminho incremental do sync. Não foram unificadas aqui ainda por
// conflito de escrita concorrente naquele arquivo (Lovable edita em paralelo).
// Unificar num commit isolado depois, fazendo o sync importar deste módulo.

export type InssResultado = 'deferido' | 'indeferido' | 'arquivado_decurso';

export type StageKey =
  | 'protocolado' | 'analise' | 'exig_aberta' | 'exig_cumprida'
  | 'deferido' | 'indeferido' | 'decurso' | 'cancelada' | 'sem_veredito';

/**
 * Marco previdenciário atual (espelha o front). "Protocolado" = e-mail inicial
 * "realizado com sucesso"; "Pendente" conta como análise; "exigência cumprida"
 * = em análise mas já passou por exigência (Set passouExig).
 */
export function stageOf(
  p: { id?: string; current_status?: string | null; resultado?: string | null },
  passouExig?: Set<string>,
): StageKey {
  const s = (p.current_status || '').toLowerCase();
  if (s.includes('protocol')) return 'protocolado';
  if (s.includes('exig')) return 'exig_aberta';
  if (s.includes('cancel')) return 'cancelada';
  if (s.includes('conclu')) {
    if (p.resultado === 'deferido') return 'deferido';
    if (p.resultado === 'indeferido') return 'indeferido';
    if (p.resultado === 'arquivado_decurso') return 'decurso';
    return 'sem_veredito';
  }
  return (p.id && passouExig?.has(p.id)) ? 'exig_cumprida' : 'analise';
}

export const STAGE_LABELS: Record<StageKey, string> = {
  protocolado: 'Protocolado',
  analise: 'Em análise',
  exig_aberta: 'Exigência (aberta)',
  exig_cumprida: 'Exigência cumprida',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
  decurso: 'Exigência não cumprida (decurso)',
  cancelada: 'Cancelada',
  sem_veredito: 'Concluída (sem veredito)',
};

/** Ordem dos marcos na jornada do requerimento (para exibição). */
export const STAGE_ORDER: StageKey[] = [
  'protocolado', 'analise', 'exig_aberta', 'exig_cumprida',
  'deferido', 'indeferido', 'decurso', 'cancelada', 'sem_veredito',
];

/**
 * Classifica o resultado de um requerimento CONCLUÍDO pelo texto do Despacho.
 * Padrões observados nos e-mails reais:
 *   deferido   → "foi concedido", "requerimento solicitado foi concedido"
 *   indeferido → "não foi reconhecido o direito", "indeferimento", "foi negado"
 * Checa indeferido primeiro: "não foi reconhecido" contém "reconhecido" e
 * enganaria uma checagem de deferido feita antes.
 */
export function classifyResultado(despacho?: string | null): InssResultado | undefined {
  if (!despacho) return undefined;
  const d = despacho.toLowerCase();
  // Arquivamento por decurso (exigência não cumprida no prazo) — checado 1º, pois
  // é um desfecho processual distinto do indeferimento de mérito.
  if (/n[ãa]o cumprimento da exig|n[ãa]o houve o seu cumprimento|arquivamento do pedido|art\.?\s*40 da lei|decurso de prazo|encerrad[ao].{0,40}exig/.test(d)) return 'arquivado_decurso';
  // Desfavorável (mérito) — contém negações que enganariam a checagem de deferido.
  if (/indefer|n[ãa]o foi reconhecid|foi negad|\bnegad[oa]\b|n[ãa]o foi prorrogad|n[ãa]o (foi )?aprovad/.test(d)) return 'indeferido';
  // Favorável — inclui prorrogação concedida e aprovação de benefício.
  if (/concedid|\bdeferid[oa]\b|foi reconhecid[oa] o direito|\bprorrogad[oa]\b|\baprovad[oa]\b/.test(d)) return 'deferido';
  return undefined;
}

/** Extrai o valor do campo "Despacho:" do corpo, até o rodapé do e-mail. */
export function extractDespacho(body: string): string | undefined {
  const m = body.match(
    /despacho\s*:\s*([\s\S]+?)(?:\s*(?:[ÉE] poss[íi]vel acompanhar|Atenciosamente,|https?:\/\/meu\.inss|Instituto Nacional do Seguro Social\s*-\s*INSS\s*$)|$)/i,
  );
  if (!m) return undefined;
  const v = m[1].replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 4000) : undefined;
}

/** Extrai o campo "Serviço:" (tipo real do benefício) do corpo. */
export function extractServico(body: string): string | undefined {
  const m = body.match(/servi[çc]o\s*:\s*([^\n]+?)(?:\s+Data do Protocolo|\s+Unidade respons|\n|$)/i);
  if (!m) return undefined;
  const v = m[1].replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 200) : undefined;
}

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch { return ''; }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

/** Achata um payload Gmail (message.format=full) em texto plano legível. */
export function gmailBodyToText(msg: any): string {
  let plain = '';
  let html = '';
  const walk = (parts?: any[]): void => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeBase64Url(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeBase64Url(p.body.data);
      if (p.parts) walk(p.parts);
    }
  };
  if (msg?.payload?.body?.data) {
    const raw = decodeBase64Url(msg.payload.body.data);
    if ((msg.payload.mimeType || '').includes('html')) html = raw; else plain = raw;
  }
  walk(msg?.payload?.parts);
  if (plain && plain.trim()) return decodeEntities(plain);
  if (html) {
    return decodeEntities(
      html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Pontos pendentes de uma EXIGÊNCIA
//
// O despacho de exigência tem três formatos, medidos em 40 amostras reais
// (25/08/2026): "solicitamos o envio eletrônico dos documentos descritos
// abaixo" com lista numerada (9), "agende a perícia/avaliação" (31 somando os
// dois textos de agendamento) e casos avulsos (biometria, procuração).
//
// Por isso a extração NÃO procura uma lista: ela corta o rodapé de instruções
// — "como anexar no Meu INSS", "só imprima o necessário", "atenciosamente" —
// e devolve o miolo, que é o que o assessor precisa ler. Em 3 das 40 o miolo
// passa de 1.200 caracteres e sai truncado; nas outras 37 cabe inteiro.
// ---------------------------------------------------------------------------

/** Onde o texto deixa de falar do caso e vira manual de uso do Meu INSS. */
const RODAPE_EXIGENCIA: RegExp[] = [
  /O cumprimento de exig[êe]ncia por meio eletr[ôo]nico/i,
  /Se preferir, agende o servi[çc]o/i,
  /É poss[íi]vel acompanhar o andamento/i,
  /S[óo] imprima o necess[áa]rio/i,
  /Clique aqui e crie sua assinatura/i,
  /Atenciosamente,?\s*Instituto Nacional/i,
  /O n[ãa]o atendimento desta exig[êe]ncia/i,
  // Passo a passo de como usar o Meu INSS: vem em 31 das 40 amostras e é
  // sempre o mesmo texto. O que interessa está na frase antes dele.
  /Para agendar:/i,
  /Outra forma de agendar/i,
];

/** Saudação e prefixo de protocolo interno, que não dizem nada do caso. */
const ABERTURA = /^(NR:\s*)?(Prezado\(a\)\s*(Sr\.?\(a\)|Senhor\(a\))\s*,?\s*)?/i;

const MAX_PONTOS = 1200;

/**
 * O prazo mora justamente na frase de rodapé que é cortada ("...até o dia
 * 20/07/2026 (30 dias de prazo)"), e perder a data é perder o que torna a
 * tarefa urgente. Por isso ela volta como uma linha própria.
 */
function extrairPrazo(texto: string): string | null {
  const data = texto.match(/at[ée] o dia (\d{2}\/\d{2}\/\d{4})/i);
  if (data) return data[1];
  const dias = texto.match(/em at[ée] (\d{1,3}) dias/i);
  return dias ? `${dias[1]} dias a contar da exigência` : null;
}

/**
 * Miolo do despacho de exigência, em linhas — o que está pendente, sem o
 * manual do Meu INSS. Devolve null quando não sobra texto aproveitável.
 */
export function extrairPontosPendentes(despacho?: string | null): string | null {
  const bruto = (despacho || '').replace(/\s+/g, ' ').trim();
  if (!bruto) return null;

  const prazo = extrairPrazo(bruto);

  let corte = bruto.length;
  for (const re of RODAPE_EXIGENCIA) {
    const m = bruto.match(re);
    if (m?.index !== undefined && m.index < corte) corte = m.index;
  }

  let miolo = bruto.slice(0, corte).replace(ABERTURA, '').trim();
  if (miolo.length < 20) return null;

  if (miolo.length > MAX_PONTOS) miolo = `${miolo.slice(0, MAX_PONTOS).trim()}…`;

  // Itens numerados ("1.", "2)") e o bullet que chega corrompido como "?"
  // viram linha própria: em texto corrido a lista fica ilegível na atividade.
  const linhas = miolo
    .replace(/\s(\d{1,2}[.)])\s/g, '\n$1 ')
    .replace(/\s\?\s/g, '\n- ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const corpo = linhas.join('\n');
  return prazo ? `${corpo}\n\n⏳ Prazo: ${prazo}` : corpo;
}

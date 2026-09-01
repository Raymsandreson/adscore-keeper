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

/** O INSS nomeia o documento: procuração, termo de representação, representação processual. */
const PEDE_PROCURACAO =
  /procura[çc][ãa]o|(termo|documento|poderes|v[íi]cio|instrumento|saneamento) de representa[çc][ãa]o|representa[çc][ãa]o processual/i;

/**
 * O INSS recusa a assinatura sem nomear o documento. Acontece em 13 das 74
 * exigências: "favor reenviar o documento acima citado, assinado de forma
 * manuscrita", "a assinatura digital no documento não foi reconhecido pelo
 * sistema ITI". É seguro tratar como procuração — o INSS não discute validade
 * de assinatura de certidão nem de carteira de trabalho, só do instrumento de
 * representação.
 */
const RECUSA_DE_ASSINATURA =
  /manuscrit|zapsign|validar\.iti\.gov\.br|assinaturas? (digitais?|eletr[ôo]nicas?)/i;

/**
 * A exigência pede procuração para assinar à mão?
 *
 * O guard da fiança é obrigatório: em pensão por morte, "procuração ou fiança
 * reciprocamente outorgada" é item da lista de provas de união estável do
 * art. 22 §3º do Dec. 3.048/99 — papel do casal, e não pedido de procuração
 * nossa. Mesma armadilha tratada em `separarPendencias`.
 */
export function exigeProcuracao(texto?: string | null): boolean {
  const t = (texto || '').trim();
  if (!t) return false;
  const semFianca = t.replace(/procura[çc][ãa]o ou fian[çc]a reciprocamente outorgada/gi, '');
  return PEDE_PROCURACAO.test(semFianca) || RECUSA_DE_ASSINATURA.test(semFianca);
}

// ---------------------------------------------------------------------------
// Pendência do CLIENTE x pendência do ESCRITÓRIO
//
// Correção do usuário (01/09/2026): a procuração VOLTA a ser pendência do
// cliente. A regra anterior (27/08/2026) tirava da mensagem tudo que falasse de
// procuração, representação ou assinatura — 211 fragmentos em 75 exigências —
// sob o argumento de que "o cliente lê como cobrança e não tem o que fazer".
// Essa premissa caiu quando o robô passou a anexar o PDF da procuração já
// preenchida: agora ele tem o que fazer — imprimir, assinar à caneta e
// devolver, que é exatamente o que o INSS exige ("assinado de forma
// manuscrita", "procuração física/original").
//
// O que continua sendo nosso é UMA coisa só: o pedido do documento pessoal do
// procurador — "Documento de Identificação do procurador(a)", "documento de
// identificação com foto do procurador", RG/CPF/OAB do advogado. Isso o cliente
// não tem como providenciar. Medido sobre as 587 exigências com despacho
// (01/09/2026): 5 fragmentos, em 5 exigências.
//
// Duas armadilhas do corpus, as duas cobertas por `PEDIDO_DO_CLIENTE`:
//
//   1. O INSS junta os dois pedidos na mesma frase ("-PROCURAÇÃO E DOCUMENTOS
//      DE IDENTIFICAÇÃO DO PROCURADOR, COM PODERES PERANTE O INSS"). Cortar o
//      fragmento levaria junto a procuração, que é do cliente. Quando o
//      fragmento também pede procuração, termo de representação/responsabilidade
//      ou assinatura, ele FICA na mensagem — a segunda barreira é a instrução do
//      prompt, em lib/inss-mensagem-cliente, que proíbe repassar ao cliente o
//      documento do advogado.
//
//   2. "CNH" e "OAB" aparecem como documento de identidade DO CLIENTE na
//      exigência de biometria ("Documento de Identificação (RG, Carteira de
//      Trabalho, CNH, Passaporte, Carteira de Profissão - OAB...)"). Por isso o
//      corte exige a palavra da representação (procurador/advogado) perto do
//      nome do documento, nunca o nome do documento sozinho.
//
// "representante legal" NÃO entra: nas exigências de biometria de BPC e nas de
// guarda de menor ele é a mãe/tutor do requerente, não o advogado.
// ---------------------------------------------------------------------------

/**
 * Pedido do documento PESSOAL do procurador/advogado — a única pendência que
 * não vai para o grupo. Exige a palavra da representação perto do nome do
 * documento, para não confundir com a identidade do próprio cliente.
 */
const DOC_DO_PROCURADOR: RegExp[] = [
  /\b(documentos?|c[óo]pias?|identifica[çc][ãa]o|identidade|foto|rg|cpf|oab|carteira)\b[^.;:!?]{0,70}\b(procurador|advogad)/i,
  /\b(procurador|advogad)\w*\b[^.;:!?]{0,50}\b(documentos? de identifica|identidade|\brg\b|\bcpf\b|foto|oab)/i,
  /\bdocumento de identifica[çc][ãa]o do outorgad[oa]\b/i,
];

/**
 * O que o cliente providencia de próprio punho. Presente no fragmento, ele fica
 * na mensagem mesmo que o INSS tenha colado o documento do procurador na mesma
 * frase. Cobre também a "procuração ou fiança reciprocamente outorgada", que na
 * exigência de pensão por morte é prova de união estável do art. 22 §3º do
 * Dec. 3.048/99 — papel do casal, nunca nosso.
 */
const PEDIDO_DO_CLIENTE =
  /\b(procura[çc][ãa]o|termo de representa[çc][ãa]o|termo de responsabilidade|assinatura|assinad)/i;

/** Saudação e "solicitamos o envio dos documentos abaixo": não é pendência. */
const CABECALHO_NEUTRO =
  /^(NR:[\s\d]*)?(prezado|para (dar andamento|an[áa]lise d|dar continuidade)|solicitamos o envio|⏳)/i;

/**
 * Onde um item termina e o outro começa. Os marcadores (bullet, número, "?")
 * ficam com o item que abrem — assim, ao remover um item, não sobra o traço
 * órfão do vizinho. O separador é sempre só espaço em branco.
 */
const LIMITE_FRAGMENTO = new RegExp(
  [
    '\\n+',
    '(?<=[.;:])[ \\t]+(?=\\S)',
    '[ \\t]+(?=[-–—•*][ \\t]*[A-Za-zÀ-Ú0-9])',
    '[ \\t]*(?=\\?[ \\t]*[A-Za-zÀ-Ú])',
    '[ \\t]+(?=\\d{1,2}[ \\t]*[-.)][ \\t])',
    // Itens em letra ("a) procuração b) documento de identificação com foto do
    // procurador"): sem esta quebra os dois pedidos ficam no mesmo fragmento.
    '[ \\t]+(?=[a-z][ \\t]*\\)[ \\t])',
    // O INSS emenda o item seguinte sem pontuação nenhuma ("ANEXAR CARTEIRA DA
    // OAB Apresentar ao menos uma prova documental..."). Quebrar antes do verbo
    // de pedido evita que remover o item nosso leve junto o do cliente.
    '[ \\t]+(?=(Apresentar|Anexar|Enviar|Juntar|Informar|Comprovar|Encaminhar|Providenciar)\\b)',
  ].join('|'),
  'g',
);

type TipoFragmento = 'cliente' | 'escritorio' | 'neutro';

interface Fragmento {
  txt: string;
  sep: string;
  tipo: TipoFragmento;
}

function classificarFragmento(txt: string): TipoFragmento {
  if (CABECALHO_NEUTRO.test(txt.trim())) return 'neutro';
  if (PEDIDO_DO_CLIENTE.test(txt)) return 'cliente';
  return DOC_DO_PROCURADOR.some((re) => re.test(txt)) ? 'escritorio' : 'cliente';
}

function fragmentar(texto: string): Fragmento[] {
  const out: Fragmento[] = [];
  let cursor = 0;
  for (const m of texto.matchAll(LIMITE_FRAGMENTO)) {
    const ini = m.index ?? 0;
    if (ini < cursor) continue;
    const txt = texto.slice(cursor, ini);
    if (txt) out.push({ txt, sep: m[0], tipo: classificarFragmento(txt) });
    cursor = ini + m[0].length;
  }
  const resto = texto.slice(cursor);
  if (resto) out.push({ txt: resto, sep: '', tipo: classificarFragmento(resto) });
  return out;
}

/** Mínimo de caracteres úteis (sem espaço) para valer uma mensagem ao cliente. */
const MIN_UTIL_CLIENTE = 20;

export interface PendenciasSeparadas {
  /** O que o cliente precisa providenciar — `null` quando nada sobra pra ele. */
  cliente: string | null;
  /** O que o escritório resolve — só para a atividade interna, nunca no zap. */
  escritorio: string | null;
}

/**
 * Divide a saída de `extrairPontosPendentes` entre o que o cliente providencia
 * e o que o escritório resolve. Quando não há pendência nossa, devolve o texto
 * intacto — nenhuma exigência muda de forma sem motivo.
 */
export function separarPendencias(pontos?: string | null): PendenciasSeparadas {
  const txt = (pontos || '').trim();
  if (!txt) return { cliente: null, escritorio: null };

  const frags = fragmentar(txt);
  // Rótulo curto que só existia para abrir o item nosso ('"Assinado por:',
  // '1)-.') vira órfão quando o item sai. Sai junto.
  for (let i = 0; i < frags.length - 1; i++) {
    const f = frags[i];
    if (f.tipo !== 'cliente' || frags[i + 1].tipo !== 'escritorio') continue;
    if (f.txt.trim().replace(/[^\p{L}\p{N}]/gu, '').length <= 12) f.tipo = 'neutro';
  }
  const doEscritorio = frags.filter((f) => f.tipo === 'escritorio');
  if (!doEscritorio.length) return { cliente: txt, escritorio: null };

  const util = frags
    .filter((f) => f.tipo === 'cliente')
    .reduce((n, f) => n + f.txt.replace(/\s/g, '').length, 0);

  const restante = frags
    .filter((f) => f.tipo !== 'escritorio')
    .map((f) => f.txt + f.sep)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    cliente: util >= MIN_UTIL_CLIENTE ? restante : null,
    escritorio: doEscritorio.map((f) => f.txt.trim()).join('\n'),
  };
}

// =============================================================================
// Parser de MARCOS processuais a partir das movimentações do Escavador.
// Fase 1: detecção por palavra-chave + regex de valor (sem LLM).
// Puro/determinístico — sem Date.now()/random, sem I/O. Testável isolado.
//
// Marcos alvo (uma linha por marco na tabela process_movements):
//   peticao_inicial, sentenca_1grau, acordo, acordao_2grau,
//   acordao_superior, transito_julgado, pagamento
// =============================================================================

export type MarcoTipo =
  | 'peticao_inicial'
  | 'sentenca_1grau'
  | 'acordo'
  | 'acordao_2grau'
  | 'acordao_superior'
  | 'transito_julgado'
  | 'pagamento';

export interface EscavadorMovimentacao {
  id?: string | number;
  data?: string;
  data_hora?: string;
  tipo?: string;
  titulo?: string;
  conteudo?: string;
  descricao?: string;
  classificacao_predita?: { nome?: string; descricao?: string } | null;
  link?: string;
  url?: string;
  documento?: { url?: string } | null;
  anexos?: Array<{ url?: string; link?: string }> | null;
  [k: string]: any;
}

export interface MarcoExtraido {
  tipo_movimentacao: MarcoTipo;
  marco_ordem: number;
  data_movimentacao: string | null; // ISO — null é descartado (coluna NOT NULL)
  valor_indenizacao_fixado: number | null;
  link_decisao: string | null;
  descricao: string | null;
  escavador_movimentacao_id: string | null;
  conteudo_hash: string;
}

// Ordem canônica no ciclo de vida — usada pra ordenar a timeline quando datas empatam.
const MARCO_ORDEM: Record<MarcoTipo, number> = {
  peticao_inicial: 1,
  sentenca_1grau: 2,
  acordo: 3,
  acordao_2grau: 4,
  acordao_superior: 5,
  transito_julgado: 6,
  pagamento: 7,
};

// Palavras-chave já NORMALIZADAS (sem acento, minúsculas).
const KW = {
  transito: ['transito em julgado', 'transitou em julgado', 'certidao de transito'],
  // "pagamento" sozinho é ambíguo (aparece em sentença: "condeno ao pagamento de...").
  // Só instrumentos/frases concretas de quitação contam como marco de pagamento.
  pagamento: ['alvara', 'rpv', 'requisicao de pequeno valor', 'precatorio', 'levantamento', 'deposito judicial', 'pagamento efetuado', 'pagamento realizado', 'pagamento integral', 'comprovante de pagamento', 'quitacao'],
  acordaoMarkers: ['acordao', 'apelacao', 'deram provimento', 'negaram provimento', 'recurso ordinario', 'recurso especial', 'recurso extraordinario'],
  superiorMarkers: ['stj', 'stf', 'superior tribunal', 'supremo tribunal', 'recurso especial', 'recurso extraordinario', 'tribunal superior'],
  acordo: ['acordo', 'homologacao de acordo', 'transacao', 'conciliacao', 'autocomposicao'],
  sentenca: ['sentenca', 'julgo procedente', 'julgo improcedente', 'julgo parcialmente', 'extincao do processo', 'resolucao do merito', 'julgo extinto'],
  peticaoInicial: ['peticao inicial', 'distribuic', 'protocolo da inicial', 'autuac', 'ajuizamento'],
};

// Marcos que podem carregar valor de indenização no texto da decisão.
const MARCOS_COM_VALOR: MarcoTipo[] = ['sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior', 'pagamento'];

function normalize(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hasAny(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

// Hash determinístico (djb2 duplo → base36) pra dedup idempotente por re-sync.
function stableHash(input: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ (c + 1);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}`;
}

// Texto COMPLETO da movimentação — usado só pra extrair valor/snippet (não pra classificar).
function movText(mov: EscavadorMovimentacao): string {
  const cls = mov.classificacao_predita;
  return [
    mov.tipo,
    mov.titulo,
    mov.conteudo,
    mov.descricao,
    cls?.nome,
    cls?.descricao,
  ].filter(Boolean).join(' ');
}

// Janela de "cabeçalho": título + começo do conteúdo (onde fica o assunto da movimentação).
// Classificar pelo corpo inteiro é a fonte dos falsos-positivos (ex.: toda sentença tem o
// boilerplate "após o trânsito em julgado, arquive-se" lá no fim). Só olhamos o cabeçalho.
const HEAD_CHARS = 180;
function headText(mov: EscavadorMovimentacao): string {
  const body = String(mov.conteudo || mov.descricao || '').slice(0, HEAD_CHARS);
  return [mov.tipo, mov.titulo, body].filter(Boolean).join(' ');
}

function mk(tipo: MarcoTipo) {
  return { tipo, ordem: MARCO_ORDEM[tipo] };
}

// Casa um marco numa string normalizada `s`. `head` é usado só pra decidir 2º grau vs superior.
// Ordem: acórdão → acordo → sentença → trânsito → petição inicial → pagamento.
// Sentença ANTES de trânsito (sentença cita "após o trânsito em julgado" no corpo, mas aqui
// só vemos o cabeçalho — ainda assim mantemos a ordem por segurança).
function matchMarco(s: string, head: string): { tipo: MarcoTipo; ordem: number } | null {
  if (!s.trim()) return null;
  if (hasAny(s, KW.acordaoMarkers)) {
    return mk(hasAny(head, KW.superiorMarkers) ? 'acordao_superior' : 'acordao_2grau');
  }
  if (hasAny(s, KW.acordo)) return mk('acordo');
  if (hasAny(s, KW.sentenca)) return mk('sentenca_1grau');
  if (hasAny(s, KW.transito)) return mk('transito_julgado');
  if (hasAny(s, KW.peticaoInicial)) return mk('peticao_inicial');
  if (hasAny(s, KW.pagamento)) return mk('pagamento');
  return null;
}

// Classifica uma movimentação em marco (ou null).
// 1) Sinal primário: a classe que o Escavador já prediz (classificacao_predita.nome).
// 2) Fallback: keyword no cabeçalho (nunca no corpo inteiro).
function classify(mov: EscavadorMovimentacao): { tipo: MarcoTipo; ordem: number } | null {
  const clsName = normalize(mov.classificacao_predita?.nome || '');
  const head = normalize(headText(mov));
  const byClass = matchMarco(clsName, head);
  if (byClass) return byClass;
  return matchMarco(head, head);
}

// Extrai o MAIOR valor em R$ do texto (heurística: indenização costuma ser o maior).
// Retorna null quando não há valor confiável.
function extractValor(text: string): number | null {
  const re = /r\$\s*([\d]{1,3}(?:\.[\d]{3})*|[\d]+),(\d{2})/gi;
  let m: RegExpExecArray | null;
  let max: number | null = null;
  while ((m = re.exec(text)) !== null) {
    const intPart = m[1].replace(/\./g, '');
    const val = parseFloat(`${intPart}.${m[2]}`);
    if (!isNaN(val) && val > 0 && (max === null || val > max)) max = val;
  }
  return max;
}

function extractLink(mov: EscavadorMovimentacao): string | null {
  const candidates = [
    mov.link,
    mov.url,
    mov.documento?.url,
    ...(Array.isArray(mov.anexos) ? mov.anexos.map((a) => a?.url || a?.link) : []),
  ].filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  return candidates[0] ?? null;
}

function extractDate(mov: EscavadorMovimentacao): string | null {
  const raw = mov.data || mov.data_hora || '';
  if (!raw) return null;
  // Aceita 'YYYY-MM-DD' ou ISO completo; devolve como veio (Postgres parseia).
  const iso = String(raw).trim();
  return iso || null;
}

/**
 * Varre as movimentações e devolve os marcos identificados (dedup por hash).
 * @param movimentacoes array cru do Escavador (v2)
 * @param opts.numeroCnj usado no hash pra estabilidade entre re-syncs
 */
export function extractMarcos(
  movimentacoes: EscavadorMovimentacao[],
  opts: { numeroCnj?: string } = {},
): MarcoExtraido[] {
  if (!Array.isArray(movimentacoes)) return [];
  const numeroCnj = opts.numeroCnj || '';
  const seen = new Set<string>();
  const out: MarcoExtraido[] = [];

  for (const mov of movimentacoes) {
    const cls = classify(mov);
    if (!cls) continue;

    const data = extractDate(mov);
    if (!data) continue; // sem data não entra na timeline (coluna NOT NULL)

    const fullText = movText(mov);
    const snippet = normalize(fullText).slice(0, 120);
    const hash = stableHash(`${numeroCnj}|${cls.tipo}|${data}|${snippet}`);
    if (seen.has(hash)) continue;
    seen.add(hash);

    out.push({
      tipo_movimentacao: cls.tipo,
      marco_ordem: cls.ordem,
      data_movimentacao: data,
      valor_indenizacao_fixado: MARCOS_COM_VALOR.includes(cls.tipo) ? extractValor(fullText) : null,
      link_decisao: extractLink(mov),
      descricao: (mov.conteudo || mov.titulo || mov.descricao || '').toString().slice(0, 500) || null,
      escavador_movimentacao_id: mov.id != null ? String(mov.id) : null,
      conteudo_hash: hash,
    });
  }

  return dedupePeticaoInicial(out);
}

// Petição inicial é única (um ajuizamento). Se o parser pegou várias, mantém só a mais antiga
// (menor data_movimentacao — string ISO compara cronologicamente).
function dedupePeticaoInicial(marcos: MarcoExtraido[]): MarcoExtraido[] {
  const pis = marcos.filter((m) => m.tipo_movimentacao === 'peticao_inicial');
  if (pis.length <= 1) return marcos;
  const earliest = pis.reduce((a, b) => (a.data_movimentacao! <= b.data_movimentacao! ? a : b));
  return marcos.filter((m) => m.tipo_movimentacao !== 'peticao_inicial' || m === earliest);
}

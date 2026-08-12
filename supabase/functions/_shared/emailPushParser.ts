// =============================================================================
// Parser dos e-mails de PUSH dos tribunais (processual@ / adm@).
//
// Os tribunais já mandam de graça, em minutos, aquilo que o Escavador e o
// DataJud entregam devagar e pagando: 200 e-mails em 20 dias na caixa do
// escritório, quase todos com o número CNJ no assunto ou no corpo. Aqui esse
// texto vira movimentação estruturada para o feed do sino.
//
// Três famílias, medidas na caixa real em 11/08/2026:
//
//   PJe push (PJe dos TJs, TRTs, TST, TRFs) — 1 processo, N movimentos:
//     Número do Processo: 0004694-46.2016.8.18.0140
//     | 11/08/2026 13:23 - Conclusos para admissibilidade recursal |
//     | 10/08/2026 21:00 | Recebido o mandado pelo Oficial de Justiça |
//
//   EPROC (Justiça Federal da 4ª Região) — N processos, sem data no corpo:
//     | Num. Processo: | 5006477-98.2026.4.04.7208 |
//     | Movimentação:  | Confirmada a intimação eletrônica - |
//
//   e-SAJ (TJSP) — N processos, cada um com "Novas Movimentações":
//     Processo: 1070860-05.2020.8.26.0100 <link>
//     Novas Movimentações
//     10/08/2026 16:02 Petição Juntada
//
// Módulo puro: sem I/O, sem API do Deno — por isso os testes em
// src/lib/__tests__/emailPushParser.test.ts conseguem importá-lo direto.
// =============================================================================

export type FonteEmail = 'pje' | 'eproc' | 'esaj' | 'desconhecida';

/** Um evento do bloco "Eventos:" do push, como o tribunal escreveu. */
export interface EventoPush {
  /** ISO (YYYY-MM-DD). */
  data: string | null;
  /** HH:MM — o tribunal manda vários eventos no mesmo dia, a hora é o que os separa. */
  hora: string | null;
  texto: string;
}

export interface MovimentacaoEmail {
  /** Só dígitos — é assim que casamos com lead_processes.process_number. */
  cnjDigitos: string;
  /** Como apareceu no e-mail (0000000-00.0000.0.00.0000). */
  cnj: string;
  /** ISO (YYYY-MM-DD). Null quando o corpo não traz data — o chamador usa a do e-mail. */
  data: string | null;
  texto: string;
  fonte: FonteEmail;
  /**
   * Só no push agrupado (bloco "Eventos:" em linha corrida): a lista inteira do
   * e-mail. `texto` vira o resumo dela e isto é o que se consulta no card.
   */
  eventos?: EventoPush[];
  /** Frase curta do evento principal — vira o título da linha do feed. */
  titulo?: string;
}

const CNJ_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
const CNJ_RE_G = new RegExp(CNJ_RE.source, 'g');
const DATA_RE = /(\d{2})\/(\d{2})\/(\d{4})/;

const MAX_TEXTO = 300;

export function soDigitos(cnj: string): string {
  return (cnj || '').replace(/\D/g, '');
}

function isoDaData(br: string | null | undefined): string | null {
  const m = (br || '').match(DATA_RE);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function limpa(texto: string): string {
  return texto
    // O PJe cola o link do documento no meio da linha em três formatos:
    // <https://...>, [](>https://...<) e a URL solta. Nenhum diz nada ao leitor.
    .replace(/<[^>]*>/g, ' ')
    .replace(/\(?[<>]?https?:\/\/[^\s)<>]+[<>]?\)?/g, ' ')
    .replace(/\[\]|\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s\-–—(),;:]+$/, '')
    .slice(0, MAX_TEXTO);
}

/** Linhas de cabeçalho e separador das tabelas — não são movimentação. */
function ehCabecalho(texto: string): boolean {
  const t = texto.toLowerCase().replace(/[^a-zà-ú ]/g, '').trim();
  return t === '' || t === 'data' || t === 'evento' || t === 'movimento'
    || t === 'data movimento' || t === 'data evento';
}

// ---------------------------------------------------------------------------
// PJe / TRT / TST / TRF
// ---------------------------------------------------------------------------
function parsePje(corpo: string, assunto: string): MovimentacaoEmail[] {
  const cnj = (corpo.match(CNJ_RE) || assunto.match(CNJ_RE) || [])[0];
  if (!cnj) return [];

  const out: MovimentacaoEmail[] = [];
  for (const linhaRaw of corpo.split('\n')) {
    const linha = linhaRaw.trim();
    if (!linha.startsWith('|')) continue;
    if (/^\|[\s|:-]*$/.test(linha)) continue; // separador markdown

    const celulas = linha.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    let dataBr: string | null = null;
    let texto = '';

    if (celulas.length >= 2 && DATA_RE.test(celulas[0])) {
      // | 10/08/2026 21:00 | Recebido o mandado ... |
      dataBr = celulas[0];
      texto = celulas.slice(1).join(' ');
    } else if (celulas.length === 1 && DATA_RE.test(celulas[0])) {
      // | 11/08/2026 13:23 - Conclusos para admissibilidade recursal |
      const partes = celulas[0].split(/\s+-\s+/);
      if (partes.length < 2) continue;
      dataBr = partes[0];
      texto = partes.slice(1).join(' - ');
    } else {
      continue;
    }

    const limpo = limpa(texto);
    if (ehCabecalho(limpo)) continue;
    out.push({ cnj, cnjDigitos: soDigitos(cnj), data: isoDaData(dataBr), texto: limpo, fonte: 'pje' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// EPROC (TRF4 e seções judiciárias)
// ---------------------------------------------------------------------------
function parseEproc(corpo: string): MovimentacaoEmail[] {
  const out: MovimentacaoEmail[] = [];
  let atual: string | null = null;

  for (const linhaRaw of corpo.split('\n')) {
    const linha = linhaRaw.trim();
    if (/num\.?\s*processo/i.test(linha)) {
      atual = (linha.match(CNJ_RE) || [])[0] || atual;
      continue;
    }
    if (!atual) continue;
    const mov = linha.match(/movimenta(?:ç|c)(?:ã|a)o\s*:?\s*\|?\s*(.+?)\s*\|?\s*$/i);
    if (mov) {
      const texto = limpa(mov[1]);
      if (texto) {
        out.push({ cnj: atual, cnjDigitos: soDigitos(atual), data: null, texto, fonte: 'eproc' });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// e-SAJ (TJSP)
// ---------------------------------------------------------------------------
function parseEsaj(corpo: string): MovimentacaoEmail[] {
  const out: MovimentacaoEmail[] = [];
  let atual: string | null = null;
  let dentroDeMovimentacoes = false;

  for (const linhaRaw of corpo.split('\n')) {
    const linha = linhaRaw.trim();

    const inicioProcesso = /^processo:/i.test(linha) && CNJ_RE.test(linha);
    if (inicioProcesso) {
      atual = (linha.match(CNJ_RE) || [])[0];
      dentroDeMovimentacoes = false;
      continue;
    }
    if (/^novas movimenta/i.test(linha)) {
      dentroDeMovimentacoes = true;
      continue;
    }
    if (!atual || !dentroDeMovimentacoes) continue;

    // "10/08/2026 16:02 Petição Juntada" — as linhas de detalhe abaixo dela
    // (protocolo, teor do ato, lista de advogados) ficam de fora de propósito:
    // um único "Teor do ato" do e-SAJ tem 4 mil caracteres de OAB.
    const m = linha.match(/^(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(.+)$/);
    if (!m) continue;
    const texto = limpa(m[2]);
    if (!texto) continue;
    out.push({ cnj: atual, cnjDigitos: soDigitos(atual), data: isoDaData(m[1]), texto, fonte: 'esaj' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PJe / TST / TRT — bloco "Eventos:" em LINHA CORRIDA
//
// É o layout mais comum da caixa e o que estava passando batido: 804 dos 4.203
// e-mails, contra 166 no formato de tabela que o parsePje lê. Sem tabela, sem
// `|`, tudo numa linha só:
//
//   Eventos: Data Evento 06/08/2026 00:14 Decorrido o prazo de CGB ENERGIA LTDA
//   em 05/08/2026 05/08/2026 00:26 Documento sigiloso Para acessar este processo...
//
// Como o parsePje não achava nada, o e-mail caía no fallback do assunto e o
// sino mostrava "[TST] [PUSH] Atualizações de Informações Processuais do
// Processo 0016855-..." — 862 das 1.157 linhas de origem email_push (74,5%)
// estavam assim em 12/08/2026: o teor existia no banco e ninguém via.
//
// Aqui o e-mail vira UMA movimentação com a lista de eventos junto: quatro
// linhas de "Documento sigiloso" no feed seriam ruído, o resumo com os eventos
// consultáveis é o que a equipe pediu.
// ---------------------------------------------------------------------------

/** Onde o bloco de eventos acaba e começa o rodapé padrão do PJe. */
const FIM_DO_BLOCO = /(Para acessar|Caso n[ãa]o tenha mais interesse|ATEN[ÇC][ÃA]O|Este e-mail|TRIBUNAL (SUPERIOR|REGIONAL))/i;

const EVENTO_RE = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+([\s\S]*?)(?=\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}|$)/g;

/**
 * Evento que não serve de título: o tribunal repete "Documento sigiloso" a cada
 * anexo, e um card anunciando "Documento sigiloso" não diz o que aconteceu.
 * Continua na lista — só não fala pelo e-mail inteiro.
 */
const EVENTO_GENERICO = /^(documento(s)? sigiloso(s)?|documento|juntada de documento|anexo)\.?$/i;

/** Entidades HTML que o corpo do PJe traz cruas (&ccedil;, &atilde;, &#233;). */
function decodeEntidades(s: string): string {
  const nomeadas: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
    acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
    agrave: 'à', Agrave: 'À', ccedil: 'ç', Ccedil: 'Ç',
    ordf: 'ª', ordm: 'º', deg: '°', middot: '·', hellip: '…',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, nome) => nomeadas[nome] ?? m);
}

/** Lista de eventos do bloco, na ordem em que o tribunal mandou. */
export function extrairEventosInline(corpo: string): EventoPush[] {
  const texto = decodeEntidades((corpo || '').replace(/\r\n/g, '\n'));
  const inicio = texto.search(/\bEventos\b\s*:?\s*\*?\s*(Data)?/i);
  if (inicio < 0) return [];

  let bloco = texto.slice(inicio).replace(/^[^:]*:?/, '');
  const fim = bloco.search(FIM_DO_BLOCO);
  if (fim > 0) bloco = bloco.slice(0, fim);

  const out: EventoPush[] = [];
  EVENTO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EVENTO_RE.exec(bloco)) !== null) {
    const limpo = limpa(m[3]);
    if (!limpo || ehCabecalho(limpo)) continue;
    out.push({ data: isoDaData(m[1]), hora: m[2], texto: limpo });
  }
  return out;
}

/**
 * Título curto + resumo do conjunto. O título sai do primeiro evento que diz
 * alguma coisa; o resumo junta os distintos, com "(N)" quando o mesmo evento
 * aparece várias vezes — é assim que "3 documentos sigilosos" não vira três
 * repetições da mesma frase.
 */
export function resumirEventos(eventos: EventoPush[]): { titulo: string; resumo: string } {
  const principal = eventos.find((e) => !EVENTO_GENERICO.test(e.texto)) || eventos[0];
  const titulo = (principal?.texto || '').slice(0, 120);

  const contagem = new Map<string, number>();
  for (const e of eventos) contagem.set(e.texto, (contagem.get(e.texto) || 0) + 1);
  const partes: string[] = [];
  // Começa pelo principal para o resumo abrir com o que importa.
  for (const [texto, n] of contagem) {
    const t = n > 1 ? `${texto} (${n}x)` : texto;
    if (texto === principal?.texto) partes.unshift(t);
    else partes.push(t);
  }
  return { titulo, resumo: partes.join(' · ').slice(0, MAX_TEXTO) };
}

/** O e-mail inteiro vira UMA movimentação por processo, com os eventos junto. */
function parseEventosInline(corpo: string, assunto: string): MovimentacaoEmail[] {
  const cnj = (corpo.match(CNJ_RE) || assunto.match(CNJ_RE) || [])[0];
  if (!cnj) return [];
  const eventos = extrairEventosInline(corpo);
  if (eventos.length === 0) return [];

  const { titulo, resumo } = resumirEventos(eventos);
  // Data da linha do feed = a do evento mais recente. O feed é ordenado por
  // data_movimentacao, então usar a mais antiga do lote afundaria o card.
  const datas = eventos.map((e) => e.data).filter(Boolean) as string[];
  const data = datas.length ? datas.sort()[datas.length - 1] : null;

  return [{ cnj, cnjDigitos: soDigitos(cnj), data, texto: resumo, fonte: 'pje', eventos, titulo }];
}

/**
 * Descobre a família do e-mail e extrai as movimentações. Devolve lista vazia
 * quando não é push de tribunal — e-mail de marketing, alerta de login do CNJ
 * e afins caem aqui e são ignorados.
 */
export function parseEmailPush(input: { assunto?: string | null; corpo?: string | null }): MovimentacaoEmail[] {
  const corpo = input.corpo || '';
  const assunto = input.assunto || '';
  if (!CNJ_RE.test(corpo) && !CNJ_RE.test(assunto)) return [];

  let movs: MovimentacaoEmail[];
  if (/num\.?\s*processo\s*:/i.test(corpo)) movs = parseEproc(corpo);
  else if (/novas movimenta/i.test(corpo)) movs = parseEsaj(corpo);
  else movs = parsePje(corpo, assunto);

  // A tabela tem precedência: quando ela existe, cada movimento já vem separado
  // e com data própria. O bloco em linha corrida é o outro layout do mesmo PJe
  // (na caixa real os dois nunca aparecem no mesmo e-mail — 0 de 4.203).
  if (movs.length === 0) movs = parseEventosInline(corpo, assunto);

  // Push sem nenhuma linha reconhecida (tribunal mudou o layout): salva o
  // assunto para o processo aparecer no sino em vez de sumir calado.
  if (movs.length === 0) {
    const cnj = (corpo.match(CNJ_RE) || assunto.match(CNJ_RE) || [])[0];
    if (cnj && /movimenta|atualiza|intima|andamento/i.test(`${assunto} ${corpo.slice(0, 400)}`)) {
      return [{
        cnj,
        cnjDigitos: soDigitos(cnj),
        data: null,
        texto: limpa(assunto) || 'Movimentação comunicada por e-mail do tribunal',
        fonte: 'desconhecida',
      }];
    }
    return [];
  }

  // Dedupe dentro do próprio e-mail (o PJe repete o mesmo evento em blocos).
  const vistos = new Set<string>();
  return movs.filter((m) => {
    const chave = `${m.cnjDigitos}|${m.data || ''}|${m.texto}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** Todos os CNJs citados — usado para logar o que o e-mail trazia e não casou. */
export function cnjsDoEmail(corpo: string | null | undefined, assunto?: string | null): string[] {
  const achados = `${assunto || ''}\n${corpo || ''}`.match(CNJ_RE_G) || [];
  return [...new Set(achados)];
}

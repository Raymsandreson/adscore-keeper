// =============================================================================
// Prospecção de processos de ACIDENTE DE TRABALHO com valor de causa alto.
//
// Módulo PURO/determinístico — sem I/O, sem Date.now()/random, sem import de
// Deno. Por isso roda tanto na edge function quanto no vitest
// (src/lib/__tests__/prospeccaoAcidenteTrabalho.test.ts), mesmo padrão de
// emailPushParser.ts.
//
// LIMITE DA API (medido em 19/08/2026, ver docs/sistema/prospeccao-acidente-trabalho.md):
// a API v2 do Escavador NÃO tem busca global por assunto nem filtro por valor
// da causa. As rotas de busca são todas ancoradas em uma CHAVE:
// /processos/numero_cnj/{cnj}, /processos/buscar?nome=, /processos/cpf/{cpf},
// /processos/cnpj/{cnpj} e /advogado/processos?oab_numero=&oab_estado=.
// Logo "todos os processos de acidente de trabalho do Brasil" não é uma
// consulta que exista. O que existe é: enumerar processos a partir de uma
// SEMENTE (lista de OABs / CNPJs de empresas rés) e filtrar aqui, no cliente,
// pelos campos de capa. É isso que este módulo faz.
// =============================================================================

/** Recorte de `capa` do processo v2 do Escavador que interessa à prospecção. */
export interface CapaProcesso {
  assunto?: string | null;
  assunto_principal?: { nome?: string | null } | string | null;
  assuntos?: Array<{ nome?: string | null } | string> | null;
  classe?: { nome?: string | null } | string | null;
  valor_causa?: {
    valor?: string | number | null;
    valor_formatado?: string | null;
    moeda?: string | null;
  } | string | number | null;
  [k: string]: unknown;
}

export interface FonteProcesso {
  capa?: CapaProcesso | null;
  tribunal?: { nome?: string | null; sigla?: string | null } | null;
  grau?: number | null;
  [k: string]: unknown;
}

export interface ProcessoEscavador {
  numero_cnj?: string | null;
  titulo_polo_ativo?: string | null;
  titulo_polo_passivo?: string | null;
  data_inicio?: string | null;
  estado_origem?: { nome?: string | null; sigla?: string | null } | null;
  fontes?: FonteProcesso[] | null;
  capa?: CapaProcesso | null;
  [k: string]: unknown;
}

export interface OabRef {
  uf?: string | null;
  tipo?: string | null;
  numero?: number | string | null;
}

export interface EnvolvidoProcesso {
  nome?: string | null;
  tipo?: string | null;
  tipo_normalizado?: string | null;
  polo?: string | null;
  oabs?: OabRef[] | null;
  advogados?: EnvolvidoProcesso[] | null;
  [k: string]: unknown;
}

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

/** Faixa Unicode dos diacríticos combinantes, separada por legibilidade. */
const DIACRITICOS = /[̀-ͯ]/g;

/** minúsculas, sem acento, espaços colapsados. */
export function normalizar(texto: string | null | undefined): string {
  if (!texto) return '';
  return String(texto)
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// -----------------------------------------------------------------------------
// Assunto: acidente de trabalho
// -----------------------------------------------------------------------------

/**
 * Termos que caracterizam acidente de trabalho / doença ocupacional.
 *
 * Deliberadamente NÃO inclui códigos numéricos de assunto da TPU/CNJ: não foi
 * possível verificar a tabela oficial nesta sessão (api.escavador.com e o
 * suporte estão bloqueados pelo proxy de egress deste ambiente), e chutar
 * código de assunto produziria filtro silenciosamente errado. Se um dia a
 * tabela for confirmada, adicionar em CODIGOS_ASSUNTO_ACIDENTE abaixo.
 */
const TERMOS_ACIDENTE_TRABALHO = [
  'acidente de trabalho',
  'acidente do trabalho',
  'acidente de trajeto',
  'acidente do trajeto',
  'doenca ocupacional',
  'doenca do trabalho',
  'doenca profissional',
];

/** Vazio de propósito — ver comentário acima. Não preencher sem fonte oficial. */
export const CODIGOS_ASSUNTO_ACIDENTE: readonly string[] = [];

/**
 * Termos que NÃO devem contar como acidente de trabalho mesmo contendo
 * "acidente". Evita falso positivo com acidente de trânsito puro (DPVAT etc.).
 */
const TERMOS_EXCLUSAO = [
  'acidente de transito',
  'acidente de veiculo',
  'dpvat',
];

/** Achata `assunto`, `assunto_principal` e `assuntos[]` numa lista de strings. */
export function coletarAssuntos(capa: CapaProcesso | null | undefined): string[] {
  if (!capa) return [];
  const out: string[] = [];

  const push = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object' && v !== null && 'nome' in v) {
      const nome = (v as { nome?: string | null }).nome;
      if (nome) out.push(nome);
    }
  };

  push(capa.assunto);
  push(capa.assunto_principal);
  if (Array.isArray(capa.assuntos)) capa.assuntos.forEach(push);

  return out.filter(Boolean);
}

/**
 * true se algum assunto do processo caracteriza acidente de trabalho.
 * Exclusão tem precedência: assunto que só fala de acidente de trânsito é
 * descartado, mas se houver DOIS assuntos e um deles for de trabalho, entra.
 */
export function isAssuntoAcidenteTrabalho(
  capa: CapaProcesso | null | undefined,
): boolean {
  const assuntos = coletarAssuntos(capa).map(normalizar);
  if (!assuntos.length) return false;

  return assuntos.some((a) => {
    const bateExclusao = TERMOS_EXCLUSAO.some((t) => a.includes(t));
    const bateTermo = TERMOS_ACIDENTE_TRABALHO.some((t) => a.includes(t));
    if (bateTermo && !bateExclusao) return true;
    // "acidente de trabalho" citado junto de trânsito ainda vale.
    return bateTermo && bateExclusao && a.includes('trabalho');
  });
}

// -----------------------------------------------------------------------------
// Valor da causa
// -----------------------------------------------------------------------------

/**
 * Converte o valor da causa para número.
 *
 * Precisa aguentar os DOIS formatos que a API devolve no mesmo objeto:
 *   valor: "1500000.00"            -> ponto é decimal
 *   valor_formatado: "R$ 1.500.000,00" -> ponto é milhar, vírgula é decimal
 * Um parser ingênuo que só remove pontos transforma "1500000.00" em
 * 150000000 (100x maior) e faria qualquer filtro de valor mínimo passar.
 *
 * Retorna null quando não há valor confiável (nunca 0, que passaria por
 * "valor conhecido e baixo" e mascararia dado ausente).
 */
export function parseValorCausa(
  valorCausa: CapaProcesso['valor_causa'],
): number | null {
  if (valorCausa == null) return null;

  if (typeof valorCausa === 'number') {
    return Number.isFinite(valorCausa) && valorCausa > 0 ? valorCausa : null;
  }

  let bruto: string | null = null;
  if (typeof valorCausa === 'string') {
    bruto = valorCausa;
  } else if (typeof valorCausa === 'object') {
    const v = valorCausa.valor;
    if (typeof v === 'number') {
      return Number.isFinite(v) && v > 0 ? v : null;
    }
    bruto = (v as string | null) ?? valorCausa.valor_formatado ?? null;
  }
  if (!bruto) return null;

  let s = String(bruto).replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!s) return null;

  const temVirgula = s.includes(',');
  if (temVirgula) {
    // pt-BR: ponto é separador de milhar, vírgula é decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: só é decimal se o último ponto deixar exatamente 2 dígitos
    // depois E não houver outro ponto (senão "1.500.000" é milhar).
    const partes = s.split('.');
    if (partes.length === 2 && partes[1].length === 2) {
      // "1500000.00" -> decimal, mantém como está.
    } else {
      s = s.replace(/\./g, '');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pega o maior valor de causa entre todas as fontes do processo. */
export function valorCausaDoProcesso(
  processo: ProcessoEscavador,
): number | null {
  const capas: Array<CapaProcesso | null | undefined> = [
    processo.capa,
    ...((processo.fontes ?? []).map((f) => f?.capa)),
  ];
  const valores = capas
    .map((c) => parseValorCausa(c?.valor_causa))
    .filter((v): v is number => v != null);
  return valores.length ? Math.max(...valores) : null;
}

/** Primeira capa do processo que caracteriza acidente de trabalho. */
export function capaAcidenteTrabalho(
  processo: ProcessoEscavador,
): CapaProcesso | null {
  const capas: Array<CapaProcesso | null | undefined> = [
    processo.capa,
    ...((processo.fontes ?? []).map((f) => f?.capa)),
  ];
  return capas.find((c) => isAssuntoAcidenteTrabalho(c)) ?? null;
}

// -----------------------------------------------------------------------------
// Advogados do polo ativo
// -----------------------------------------------------------------------------

function formatarOab(oab: OabRef | null | undefined): string | null {
  if (!oab?.numero || !oab?.uf) return null;
  return `${String(oab.numero).trim()}/${String(oab.uf).trim().toUpperCase()}`;
}

export interface AdvogadoProspect {
  nome: string;
  oab: string | null;
  oab_numero: string | null;
  oab_uf: string | null;
}

/**
 * Advogados que atuam pelo POLO ATIVO (quem move a ação — a vítima do
 * acidente). É esse escritório que teria interesse numa antecipação, não o
 * advogado da empresa ré.
 */
export function extrairAdvogadosPoloAtivo(
  envolvidos: EnvolvidoProcesso[] | null | undefined,
): AdvogadoProspect[] {
  if (!Array.isArray(envolvidos)) return [];

  const ativos = envolvidos.filter(
    (e) => normalizar(e?.polo) === 'ativo',
  );

  const advs: EnvolvidoProcesso[] = [];
  for (const parte of ativos) {
    if (Array.isArray(parte.advogados)) advs.push(...parte.advogados);
  }
  // Alguns retornos trazem o advogado como envolvido de primeiro nível com
  // polo=ATIVO e OAB preenchida, sem aninhar sob a parte.
  for (const parte of ativos) {
    if (parte.oabs?.length && !parte.advogados?.length) advs.push(parte);
  }

  const porChave = new Map<string, AdvogadoProspect>();
  for (const a of advs) {
    const nome = (a?.nome ?? '').trim();
    if (!nome) continue;
    const oab = a?.oabs?.length ? a.oabs[0] : null;
    const chave = formatarOab(oab) ?? normalizar(nome);
    if (porChave.has(chave)) continue;
    porChave.set(chave, {
      nome,
      oab: formatarOab(oab),
      oab_numero: oab?.numero != null ? String(oab.numero).trim() : null,
      oab_uf: oab?.uf ? String(oab.uf).trim().toUpperCase() : null,
    });
  }
  return Array.from(porChave.values());
}

// -----------------------------------------------------------------------------
// Leitura da resposta da API
// -----------------------------------------------------------------------------

/**
 * A v2 devolve a coleção ora em `items`, ora em `data`, ora como array cru.
 * Normaliza para array — qualquer outra coisa vira lista vazia, nunca throw.
 */
export function itensDeResposta<T = unknown>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.items)) return d.items as T[];
    if (Array.isArray(d.data)) return d.data as T[];
  }
  return [];
}

/**
 * Devolve o `links.next` da resposta APENAS se ele apontar para a própria API.
 *
 * Por que a checagem existe: o link de paginação vem de dentro do corpo da
 * resposta, e o loop de paginação faz fetch nele com o Authorization header
 * junto. Seguir URL arbitrária vinda de resposta é SSRF — e, pior aqui,
 * vazaria o token do Escavador para o host que a resposta mandasse.
 *
 * Precisa casar o PREFIXO DE ORIGEM, não `startsWith` de string solta:
 * "https://api.escavador.com.evil.test/..." começa com a base se a comparação
 * for ingênua. Compara-se origin + início do path.
 */
export function proximaPaginaSegura(
  data: unknown,
  baseEsperada: string,
): string | null {
  const links = (data as { links?: { next?: unknown } } | null | undefined)?.links;
  const next = links?.next;
  if (!next || typeof next !== 'string') return null;

  let urlNext: URL;
  let urlBase: URL;
  try {
    urlNext = new URL(next);
    urlBase = new URL(baseEsperada);
  } catch {
    return null;
  }

  if (urlNext.origin !== urlBase.origin) return null;
  if (urlNext.protocol !== 'https:') return null;
  // O path da próxima página tem que continuar dentro da base (ex.:
  // /api/v2/advogado/processos), não pular para outra rota da mesma casa.
  if (!urlNext.pathname.startsWith(urlBase.pathname)) return null;

  return urlNext.toString();
}

// -----------------------------------------------------------------------------
// Filtro final
// -----------------------------------------------------------------------------

export interface CandidatoProspeccao {
  numero_cnj: string;
  valor_causa: number;
  assuntos: string[];
  polo_ativo: string | null;
  polo_passivo: string | null;
  tribunal: string | null;
  uf: string | null;
  data_inicio: string | null;
}

export interface FiltroProspeccao {
  /** Piso do valor da causa, inclusive-exclusivo: mantém `> valorMinimo`. */
  valorMinimo: number;
}

/**
 * Aplica o recorte pedido: assunto de acidente de trabalho E valor da causa
 * acima do piso. Processo sem valor de causa conhecido é DESCARTADO (não dá
 * pra afirmar que passa do piso) — o total de descartados por essa razão volta
 * em `semValor` pra não sumir silenciosamente.
 */
export function filtrarCandidatos(
  processos: ProcessoEscavador[] | null | undefined,
  filtro: FiltroProspeccao,
): { candidatos: CandidatoProspeccao[]; semValor: number; foraDoAssunto: number } {
  const candidatos: CandidatoProspeccao[] = [];
  let semValor = 0;
  let foraDoAssunto = 0;

  for (const p of processos ?? []) {
    const capa = capaAcidenteTrabalho(p);
    if (!capa) {
      foraDoAssunto++;
      continue;
    }
    const valor = valorCausaDoProcesso(p);
    if (valor == null) {
      semValor++;
      continue;
    }
    if (valor <= filtro.valorMinimo) continue;

    const fonte = (p.fontes ?? [])[0];
    candidatos.push({
      numero_cnj: String(p.numero_cnj ?? '').trim(),
      valor_causa: valor,
      assuntos: coletarAssuntos(capa),
      polo_ativo: p.titulo_polo_ativo ?? null,
      polo_passivo: p.titulo_polo_passivo ?? null,
      tribunal: fonte?.tribunal?.sigla ?? fonte?.tribunal?.nome ?? null,
      uf: p.estado_origem?.sigla ?? null,
      data_inicio: p.data_inicio ?? null,
    });
  }

  return { candidatos, semValor, foraDoAssunto };
}

// =============================================================================
// Radar de empresa — processos de um CNPJ (ou de TODA a raiz) no Escavador,
// contados por ano e separando acidente de trabalho / doença ocupacional.
//
// POR QUE EXISTE: para precificar carteira e decidir captação, "quantos
// processos por ano essa empresa tem, e quantos são acidentários" é a pergunta
// que abre a conversa. A busca por CNPJ já existia (edge search-escavador,
// action buscar_por_cpf_cnpj), mas devolvia uma página crua, sem capa lida e
// sem contagem.
//
// LÓGICA PURA, SEM REDE: quem chama a API é o hook (tela) ou o script CLI.
// Assim a mesma regra de classificação vale nos dois e é testável sem gastar
// consulta paga.
//
// O QUE ESTES NÚMEROS SÃO: o que o Escavador indexou. Processo em segredo de
// justiça ou tribunal fora da cobertura não aparece — nenhum total daqui é
// "todos os processos da empresa".
// =============================================================================

// -----------------------------------------------------------------------------
// CNPJ: raiz, filiais e dígito verificador
// -----------------------------------------------------------------------------

/** Só os dígitos. `01.588.098/0001-02` → `01588098000102`. */
export function limparCnpj(valor: string): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** `01588098000102` → `01.588.098/0001-02`. Devolve o cru se não tiver 14 dígitos. */
export function formatarCnpj(valor: string): string {
  const d = limparCnpj(valor);
  if (d.length !== 14) return valor;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Raiz = os 8 primeiros dígitos, o que é comum a matriz e filiais. */
export function raizDoCnpj(valor: string): string {
  return limparCnpj(valor).slice(0, 8);
}

/**
 * Dígitos verificadores de um CNPJ (módulo 11), a partir dos 12 primeiros
 * dígitos (raiz + ordem). É isso que permite montar o CNPJ de uma filial
 * sabendo só a raiz e o número de ordem — o DV não é informação nova, é conta.
 */
export function digitosVerificadores(base12: string): string {
  const d = limparCnpj(base12).padStart(12, '0').slice(0, 12);
  const calcular = (nums: number[], pesos: number[]): number => {
    const soma = nums.reduce((s, n, i) => s + n * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const nums = d.split('').map(Number);
  const dv1 = calcular(nums, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calcular([...nums, dv1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${dv1}${dv2}`;
}

/** CNPJ tem 14 dígitos e DV que fecha. Não diz se a empresa existe. */
export function cnpjValido(valor: string): boolean {
  const d = limparCnpj(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  return digitosVerificadores(d.slice(0, 12)) === d.slice(12);
}

/** CNPJ completo da filial de número `ordem` (1 = matriz) dentro da raiz. */
export function cnpjDaFilial(raiz: string, ordem: number): string {
  const base = raizDoCnpj(raiz).padStart(8, '0') + String(ordem).padStart(4, '0');
  return base + digitosVerificadores(base);
}

/**
 * Todos os CNPJs da raiz, da matriz (0001) até `ateOrdem`.
 *
 * ATENÇÃO — isto é uma VARREDURA, não uma lista da Receita: gera os CNPJs
 * possíveis, não os que existem. Ordem que nunca foi aberta simplesmente não
 * devolve processo. Quem já tem a lista real de filiais deve informá-la em vez
 * de varrer, porque cada CNPJ consultado é consulta paga no Escavador.
 */
export function cnpjsDaRaiz(raiz: string, ateOrdem: number): string[] {
  const r = raizDoCnpj(raiz);
  if (r.length !== 8) return [];
  const limite = Math.max(1, Math.min(ateOrdem, 9999));
  return Array.from({ length: limite }, (_, i) => cnpjDaFilial(r, i + 1));
}

// -----------------------------------------------------------------------------
// Classificação da matéria
// -----------------------------------------------------------------------------

export type Materia = 'ACIDENTE' | 'DOENCA' | 'AMBOS' | 'OUTRO' | 'INDETERMINADO';

/**
 * Termos de ACIDENTE. "Acidente de Trabalho" é assunto CNJ próprio e aparece
 * tanto na Justiça do Trabalho (indenização) quanto na Estadual (acidentária
 * contra o INSS). Trajeto entra porque é acidente de trabalho por equiparação
 * (Lei 8.213/91, art. 21, IV, "d").
 */
const TERMOS_ACIDENTE = [
  'acidente de trabalho',
  'acidente do trabalho',
  'acidente de trajeto',
  'acidente in itinere',
  'acidentaria',
  'acidentario',
];

/**
 * Termos de DOENÇA ocupacional. LER/DORT e PAIR (perda auditiva induzida por
 * ruído) entram porque é assim que a capa costuma nomear, em vez de escrever
 * "doença ocupacional".
 */
const TERMOS_DOENCA = [
  'doenca ocupacional',
  'doenca profissional',
  'doenca do trabalho',
  'molestia profissional',
  'ler/dort',
  'ler-dort',
  'ler dort',
  'perda auditiva induzida',
  'pair ',
];

/** Sem acento e em caixa baixa — a capa vem com grafia diferente por tribunal. */
export function normalizarTexto(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classifica a matéria pelo assunto/classe da capa.
 *
 * Capa sem assunto E sem classe vira INDETERMINADO — nunca OUTRO. Chutar "não
 * é acidente" no que não se sabe produz um percentual bonito e falso; o
 * INDETERMINADO é o que manda o processo para a esteira de conferência
 * (abrir a capa completa em /processos/numero_cnj/{cnj}).
 */
export function classificarMateria(p: {
  assuntos?: string[] | null;
  assunto_principal?: string | null;
  classe?: string | null;
}): Materia {
  const campos = [
    ...(Array.isArray(p.assuntos) ? p.assuntos : []),
    p.assunto_principal,
    p.classe,
  ].filter(Boolean);
  if (campos.length === 0) return 'INDETERMINADO';

  const texto = normalizarTexto(campos.join(' | '));
  const acidente = TERMOS_ACIDENTE.some((t) => texto.includes(t));
  const doenca = TERMOS_DOENCA.some((t) => texto.includes(t));

  if (acidente && doenca) return 'AMBOS';
  if (acidente) return 'ACIDENTE';
  if (doenca) return 'DOENCA';
  return 'OUTRO';
}

export const ROTULO_MATERIA: Record<Materia, string> = {
  ACIDENTE: 'Acidente de trabalho',
  DOENCA: 'Doença ocupacional',
  AMBOS: 'Acidente + doença',
  OUTRO: 'Outra matéria',
  INDETERMINADO: 'Sem assunto na capa',
};

// -----------------------------------------------------------------------------
// Mapeamento do item da busca
// -----------------------------------------------------------------------------

export type Polo = 'PASSIVO' | 'ATIVO' | 'INDETERMINADO';

export interface ProcessoDaEmpresa {
  numero_cnj: string | null;
  cnpj_consultado: string;
  polo_ativo: string | null;
  polo_passivo: string | null;
  classe: string | null;
  area: string | null;
  assunto_principal: string | null;
  assuntos: string[];
  tribunal_sigla: string | null;
  estado: string | null;
  data_distribuicao: string | null;
  data_inicio: string | null;
  ano_inicio: number | null;
  valor_causa: number | null;
  materia: Materia;
  polo_da_empresa: Polo;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s || null;
};

/**
 * Em que polo a empresa consultada está.
 *
 * Só responde quando o envolvido com AQUELE CNPJ vem na resposta — comparar
 * por nome erraria em grupo econômico com razões sociais parecidas. Sem o
 * envolvido, fica INDETERMINADO em vez de adivinhar pelo título do polo.
 */
export function poloDaEmpresa(raw: unknown, cnpjConsultado: string): Polo {
  const alvo = limparCnpj(cnpjConsultado);
  const fontes = Array.isArray(obj(raw).fontes) ? (obj(raw).fontes as unknown[]) : [];
  for (const f of fontes) {
    const envolvidos = Array.isArray(obj(f).envolvidos) ? (obj(f).envolvidos as unknown[]) : [];
    for (const e of envolvidos) {
      if (limparCnpj(String(obj(e).cnpj ?? '')) !== alvo) continue;
      const polo = normalizarTexto(obj(e).polo);
      if (polo === 'passivo') return 'PASSIVO';
      if (polo === 'ativo') return 'ATIVO';
    }
  }
  return 'INDETERMINADO';
}

/**
 * Item da busca por CNPJ → linha do relatório.
 *
 * A leitura da capa espelha `supabase/functions/_shared/escavadorCapa.ts`
 * (`fontes[0].capa`), que é onde a v2 guarda classe, área, assuntos
 * normalizados e data de distribuição.
 */
export function mapearProcessoDaEmpresa(raw: unknown, cnpjConsultado: string): ProcessoDaEmpresa {
  const r = obj(raw);
  const fontes = Array.isArray(r.fontes) ? (r.fontes as unknown[]) : [];
  const fonte = obj(fontes[0]);
  const capa = obj(fonte.capa);
  const valor = obj(capa.valor_causa);
  const assuntos = Array.isArray(capa.assuntos_normalizados)
    ? (capa.assuntos_normalizados as unknown[]).map((a) => txt(obj(a).nome)).filter((s): s is string => Boolean(s))
    : [];

  const base = {
    numero_cnj: txt(r.numero_cnj),
    cnpj_consultado: limparCnpj(cnpjConsultado),
    polo_ativo: txt(r.titulo_polo_ativo),
    polo_passivo: txt(r.titulo_polo_passivo),
    classe: txt(capa.classe) ?? txt(obj(fonte.classe).nome),
    area: txt(capa.area) ?? txt(obj(fonte.area).nome),
    assunto_principal: txt(obj(capa.assunto_principal_normalizado).nome) ?? txt(capa.assunto),
    assuntos,
    tribunal_sigla: txt(obj(fonte.tribunal).sigla) ?? txt(fonte.sigla),
    estado: txt(obj(r.estado_origem).sigla),
    data_distribuicao: txt(capa.data_distribuicao),
    data_inicio: txt(r.data_inicio) ?? txt(fonte.data_inicio),
    ano_inicio: r.ano_inicio != null ? Number(r.ano_inicio) : null,
    valor_causa: txt(valor.valor) ? Number(valor.valor) : null,
  };

  return {
    ...base,
    materia: classificarMateria(base),
    polo_da_empresa: poloDaEmpresa(raw, cnpjConsultado),
  };
}

// -----------------------------------------------------------------------------
// Agregação por ano
// -----------------------------------------------------------------------------

export interface LinhaAno {
  ano: string;
  total: number;
  acidente: number;
  doenca: number;
  ambos: number;
  outro: number;
  indeterminado: number;
  /** acidente + doença + ambos — o que interessa para captação. */
  acidentarios: number;
}

/** Ano de referência: distribuição → início → ano_inicio. */
export function anoDoProcesso(p: Pick<ProcessoDaEmpresa, 'data_distribuicao' | 'data_inicio' | 'ano_inicio'>): string {
  const data = p.data_distribuicao || p.data_inicio || null;
  if (data && /^\d{4}/.test(data)) return data.slice(0, 4);
  if (p.ano_inicio) return String(p.ano_inicio);
  return 'sem_data';
}

/** Uma linha por ano, em ordem crescente. `sem_data` fica no fim. */
export function agregarPorAno(processos: ProcessoDaEmpresa[]): LinhaAno[] {
  const porAno = new Map<string, LinhaAno>();
  for (const p of processos) {
    const ano = anoDoProcesso(p);
    if (!porAno.has(ano)) {
      porAno.set(ano, {
        ano, total: 0, acidente: 0, doenca: 0, ambos: 0, outro: 0, indeterminado: 0, acidentarios: 0,
      });
    }
    const l = porAno.get(ano)!;
    l.total += 1;
    if (p.materia === 'ACIDENTE') l.acidente += 1;
    else if (p.materia === 'DOENCA') l.doenca += 1;
    else if (p.materia === 'AMBOS') l.ambos += 1;
    else if (p.materia === 'OUTRO') l.outro += 1;
    else l.indeterminado += 1;
    l.acidentarios = l.acidente + l.doenca + l.ambos;
  }
  return [...porAno.values()].sort((a, b) => {
    if (a.ano === 'sem_data') return 1;
    if (b.ano === 'sem_data') return -1;
    return a.ano.localeCompare(b.ano);
  });
}

export interface TotaisEmpresa extends Omit<LinhaAno, 'ano'> {
  anos: number;
  /** Média de processos por ano, ignorando `sem_data` (ano sem base não é média). */
  mediaPorAno: number;
  mediaAcidentariosPorAno: number;
}

export function totalizar(linhas: LinhaAno[]): TotaisEmpresa {
  const comAno = linhas.filter((l) => l.ano !== 'sem_data');
  const soma = (k: keyof Omit<LinhaAno, 'ano'>) => linhas.reduce((s, l) => s + l[k], 0);
  const anos = comAno.length;
  const totalComAno = comAno.reduce((s, l) => s + l.total, 0);
  const acidentariosComAno = comAno.reduce((s, l) => s + l.acidentarios, 0);
  return {
    total: soma('total'),
    acidente: soma('acidente'),
    doenca: soma('doenca'),
    ambos: soma('ambos'),
    outro: soma('outro'),
    indeterminado: soma('indeterminado'),
    acidentarios: soma('acidentarios'),
    anos,
    mediaPorAno: anos ? totalComAno / anos : 0,
    mediaAcidentariosPorAno: anos ? acidentariosComAno / anos : 0,
  };
}

/**
 * Percentual de acidentários sobre o que foi POSSÍVEL classificar.
 *
 * O denominador exclui INDETERMINADO de propósito: dividir pelo total trataria
 * "não sei" como "não é", empurrando o percentual para baixo. Devolve null
 * quando não sobrou nada classificado — sem base, sem percentual.
 */
export function percentualAcidentarios(t: Pick<TotaisEmpresa, 'total' | 'indeterminado' | 'acidentarios'>): number | null {
  const base = t.total - t.indeterminado;
  return base > 0 ? (t.acidentarios / base) * 100 : null;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

const csvCampo = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvPorAno(linhas: LinhaAno[]): string {
  const cab = 'ano,total,acidente,doenca,ambos,acidentarios,outro,indeterminado';
  const corpo = linhas.map((l) =>
    [l.ano, l.total, l.acidente, l.doenca, l.ambos, l.acidentarios, l.outro, l.indeterminado].join(','));
  return [cab, ...corpo].join('\n') + '\n';
}

export function csvProcessos(processos: ProcessoDaEmpresa[]): string {
  const cab = [
    'numero_cnj', 'cnpj_consultado', 'ano', 'materia', 'polo_da_empresa', 'classe',
    'assunto_principal', 'assuntos', 'tribunal', 'estado', 'data_distribuicao',
    'valor_causa', 'polo_ativo', 'polo_passivo',
  ];
  const linhas = processos.map((p) => [
    p.numero_cnj, formatarCnpj(p.cnpj_consultado), anoDoProcesso(p), ROTULO_MATERIA[p.materia],
    p.polo_da_empresa, p.classe, p.assunto_principal, p.assuntos.join(' | '),
    p.tribunal_sigla, p.estado, p.data_distribuicao, p.valor_causa, p.polo_ativo, p.polo_passivo,
  ].map(csvCampo).join(','));
  return [cab.join(','), ...linhas].join('\n') + '\n';
}

// -----------------------------------------------------------------------------
// Leitura da resposta paginada da API v2
// -----------------------------------------------------------------------------

/** Itens de uma página, aceitando os formatos que a v2 usa. */
export function itensDaResposta(resposta: unknown): unknown[] {
  const d = obj(obj(resposta).data ?? resposta);
  if (Array.isArray(d.items)) return d.items as unknown[];
  if (Array.isArray(d.data)) return d.data as unknown[];
  if (Array.isArray(obj(resposta).data)) return obj(resposta).data as unknown[];
  return [];
}

/**
 * URL da próxima página (`links.next`), ou null.
 *
 * Devolve a URL INTEIRA de propósito: na v2 o `next` carrega mais parâmetros
 * que só o cursor (na rota de OAB, o id de cobrança), e remontar à mão dá 422.
 */
export function proximaPagina(resposta: unknown): string | null {
  const d = obj(obj(resposta).data ?? resposta);
  return txt(obj(d.links).next) ?? txt(d.next_page_url);
}

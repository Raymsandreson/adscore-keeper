// =============================================================================
// VOCABULÁRIO DOS LANÇAMENTOS FINANCEIROS — fonte da verdade única.
//
// Ditado pelo Raym em 18/08/2026, a partir da planilha "CONTROLE FINANCEIRO
// GRUPO PRUDÊNCIO" (aba Lançamentos), e conferido contra `jm_lancamentos`
// (4.742 linhas) no Externo. Cada categoria responde a três perguntas
// independentes — de quem é o dinheiro, que espécie é, e se já é caixa:
//
//   Honorários a receber   valores de acordo com pagamento em data FUTURA.
//                          É recebível do ESCRITÓRIO, não caixa.
//   Honorários             os que JÁ foram recebidos. À medida que a parcela é
//                          paga, a linha muda de "a receber" para esta — é o
//                          MESMO lançamento mudando de estado, nunca dois
//                          eventos. Somar os dois contaria o dinheiro duas vezes.
//   Honorários Adiantados  NÃO é o processo pagando: o processo continua em
//   Oriz                   tramitação e o valor foi ANTECIPADO junto ao FIDC da
//                          Oriz. Entra caixa, mas não liquida o recebível — por
//                          isso fica fora do "recebido do processo".
//   Indenização            valor efetivamente pago AO CLIENTE (a cota dele).
//                          Dinheiro do cliente, não receita do escritório.
//   Indenização a receber  mesmo raciocínio de "honorários a receber", só que o
//                          beneficiário é a PARTE e o valor é o líquido dela.
//   Indenização comprada   o escritório COMPROU a indenização a receber da
//                          parte. Comprado, o crédito passa a ser NOSSO — é a
//                          única categoria "indenização" cujo titular é o
//                          escritório.
//   Honorários Adv         honorário REPASSADO ao advogado parceiro. Sai da
//   Parceiro               nossa mão: o titular é o parceiro, não o escritório.

// A DATA NEM SEMPRE É VENCIMENTO: 31 linhas de "Honorários a receber"
// (R$ 4,72 mi, 15 processos) carregam a data da DECISÃO — o juiz fixou o valor e
// não há cronograma de pagamento. Isso NÃO é a categoria dizendo outra coisa; é
// um fato sobre a data, e mora na coluna `tem_data_pagamento` do banco (false
// nessas linhas). A régua lê como CONDENAÇÃO: valor certo, data incerta, nunca
// vencido. Sem isso, o "a receber" inflava ~10x e tudo parecia atrasado há anos.
//
// HC × HS: na planilha a coluna PESSOA carrega "HC" (honorário contratual) ou
// "HS" (honorário sucumbencial) nas linhas de honorário — 657 HC e 104 HS na
// base. Quando PESSOA traz um nome de pessoa, é de qual parte o valor decorre,
// e o titular continua sendo o escritório (a planilha marca Beneficiário =
// "Escritório" nessas linhas).
// =============================================================================

/**
 * De quem é o dinheiro do lançamento. `parceiro` é o advogado parceiro: a
 * planilha lança a metade dele como LINHA PRÓPRIA, de valor igual à nossa (ver
 * o CNJ 0002701-92.2017.5.22.0003, onde cada parcela do acordo aparece duas
 * vezes — uma com o nome do parceiro em PESSOA, outra sem). Por isso o repasse
 * NÃO se desconta do nosso honorário: ele nunca entrou nele.
 */
export type TitularLancamento = 'escritorio' | 'cliente' | 'parceiro';

/**
 * De que CAIXA a linha é — pergunta diferente de "de quem é o dinheiro".
 *
 * A planilha de lançamentos mistura três coisas numa tabela só: o dinheiro que
 * entra e sai por causa de PROCESSO, o custo de manter o ESCRITÓRIO, e a vida
 * PESSOAL do sócio. Medido em 19/08/2026: 81 categorias distintas, que colapsam
 * em 68 só normalizando caixa e acento, e apenas 8 delas movem dinheiro de
 * processo — mas essas 8 respondem por 2.769 das 4.713 linhas.
 *
 * Sem essa separação, "quanto o escritório ganhou" soma supermercado e farra, e
 * a carteira não tem como saber o que comparar com a leitura dos autos.
 */
export type NaturezaLancamento = 'processo' | 'escritorio' | 'pessoal';

export const NATUREZA_LABEL: Record<NaturezaLancamento, string> = {
  processo: 'Processo',
  escritorio: 'Escritório',
  pessoal: 'Pessoal',
};

/**
 * Onde o dinheiro está, na régua da carteira (skill whatsjud-fluxo-vocabulario).
 * Derivado da categoria + data; nunca digitado.
 *   CONDENACAO  valor certo, data incerta (a data da linha é a da decisão)
 *   A_RECEBER   valor e data certos, no prazo
 *   VENCIDO     tinha data, passou, não foi pago (ou não foi baixado)
 *   REALIZADO   já é caixa
 */
export type EstagioLancamento = 'CONDENACAO' | 'A_RECEBER' | 'VENCIDO' | 'REALIZADO';

export type EspecieLancamento =
  | 'honorario_contratual'
  | 'honorario_sucumbencial'
  | 'honorario'
  | 'adiantamento_fidc'
  | 'honorario_parceiro'
  | 'cota_cliente'
  | 'credito_comprado'
  | 'operacao';

export interface ClassificacaoLancamento {
  titular: TitularLancamento;
  especie: EspecieLancamento;
  /** Rótulo curto para badge. */
  especieLabel: string;
  /** Ainda NÃO é caixa: acordo com pagamento em data futura ("a receber"). */
  previsto: boolean;
  /**
   * Entrou caixa mas NÃO foi o processo que pagou — antecipação do FIDC (Oriz)
   * com o processo ainda em tramitação. Nunca somar junto do recebido.
   */
  adiantado: boolean;
}

export const ESPECIE_LABEL: Record<EspecieLancamento, string> = {
  honorario_contratual: 'contratual',
  honorario_sucumbencial: 'sucumbencial',
  honorario: 'honorário',
  adiantamento_fidc: 'adiantado FIDC',
  honorario_parceiro: 'repasse ao parceiro',
  cota_cliente: 'cota do cliente',
  credito_comprado: 'crédito comprado',
  operacao: 'operação',
};

/** A planilha escreve "oriz"/"Oriz", "INDENIZAÇÃO"/"Indenização" — comparar cru
 *  deixaria linha de fora. Tudo passa por aqui antes de qualquer teste. */
const normalizar = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Categorias oferecidas no formulário manual, na ordem em que aparecem. As
 * quatro primeiras são as do vocabulário acima; o resto é despesa de operação.
 */
export const CATEGORIAS_LANCAMENTO = [
  'Honorários Contratuais',
  'Honorários Sucumbenciais',
  'Honorários Adiantados (FIDC)',
  'Cota do Cliente',
  'Custas Processuais',
  'Perícia',
  'Deslocamento',
  'Documentação',
  'Publicidade/Anúncio',
  'Comissão',
  'Acordo',
  'Outros',
] as const;

/**
 * A lista que o formulário oferece: as categorias CURADAS primeiro, e depois as
 * que já foram usadas de fato nos lançamentos. É assim que uma categoria nascida
 * de sugestão da IA passa a existir para todo mundo — usar uma vez é criar —
 * sem tabela nova e sem ninguém administrar lista.
 *
 * Dedupe por caixa e acento — "Perícia" e "PERICIA" são a mesma coisa, e foi por
 * não fazer isso que a planilha antiga chegou a 81 categorias para 68 conceitos.
 * Quando as duas grafias existem, ganha a CURADA.
 *
 * NÃO usa `categoriaCanonica` de propósito, e isso é uma armadilha real: aquela
 * função foi feita para a PLANILHA, onde contratual × sucumbencial vem da coluna
 * PESSOA (HC/HS) e não da categoria — por isso ela colapsa "Honorários
 * Contratuais" e "Honorários Sucumbenciais" na mesma chave `HONORARIOS`. Aqui
 * são duas categorias distintas do formulário: deduplicar por ela apagaria uma
 * das duas da lista, silenciosamente.
 */
export function mesclarCategorias(
  curadas: readonly string[],
  usadas: readonly (string | null | undefined)[],
): string[] {
  const porChave = new Map<string, string>();
  for (const c of curadas) porChave.set(normalizar(c), c);
  for (const u of usadas) {
    const nome = (u ?? '').trim();
    if (!nome) continue;
    const chave = normalizar(nome);
    if (chave && !porChave.has(chave)) porChave.set(chave, nome);
  }
  return [...porChave.values()];
}

/**
 * Classifica uma linha de lançamento. Serve tanto para `jm_lancamentos` (onde
 * `pessoa` traz HC/HS) quanto para o lançamento manual do app (onde a própria
 * categoria já diz contratual/sucumbencial e `pessoa` não existe).
 *
 * A ORDEM dos testes importa: "Honorários Adiantados Oriz" casa com honorário e
 * com adiantado; "Indenização comprada" casa com indenização e com comprada. O
 * caso mais específico vem primeiro nos dois.
 */
/**
 * Colapsa as variações de escrita da mesma categoria. A planilha tem
 * "FOLHA DE PAGAMENTO Variável", "variavel", "VARIÁVEL", "VARIAVEL" e
 * "VIARIAVEL" como cinco categorias diferentes; "Indenização", "INDENIZAÇÃO" e
 * "Idenização" como três. Agrupar por texto cru parte a contagem em pedaços.
 */
export function categoriaCanonica(categoria?: string | null): string {
  const c = normalizar(categoria);
  if (!c) return 'SEM CATEGORIA';
  // Erros de digitação vistos no dado real, corrigidos antes de casar.
  const limpo = c
    .replace(/\bidenizacao\b/g, 'indenizacao')
    .replace(/\bviariavel\b/g, 'variavel')
    .replace(/\bpesoal\b/g, 'pessoal')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo.includes('folha de pagamento') || limpo === 'variavel' || limpo === 'pessoal variavel') {
    return limpo.includes('fixo') ? 'FOLHA DE PAGAMENTO FIXO' : 'FOLHA DE PAGAMENTO VARIAVEL';
  }
  if (limpo.includes('ajuda familia')) {
    return limpo.includes('a pagar') ? 'AJUDA FAMILIA A PAGAR' : 'AJUDA FAMILIA';
  }
  if (limpo.includes('adiantad')) return 'HONORARIOS ADIANTADOS FIDC';
  // Exige "honorário" junto: "Parceria" e "Parceira" (5 linhas) podem ser
  // rateio de sociedade, não repasse de honorário. Sem confirmação do Raym,
  // ficam como categoria própria em vez de entrar no bolo errado.
  if (limpo.includes('parceir') && limpo.includes('honorari')) return 'HONORARIOS ADV PARCEIRO';
  if (limpo.includes('comprad')) return 'INDENIZACAO COMPRADA';
  if (limpo.includes('indenizacao')) {
    return limpo.includes('a receber') ? 'INDENIZACAO A RECEBER' : 'INDENIZACAO';
  }
  if (limpo.includes('honorari')) {
    return limpo.includes('a receber') ? 'HONORARIOS A RECEBER' : 'HONORARIOS';
  }
  if (limpo.includes('emprestimo')) return 'EMPRESTIMO BANCARIO';
  return limpo.toUpperCase();
}

/** Categorias que sempre nascem de um processo, qualquer que seja o CNJ. */
const DE_PROCESSO = [
  'indenizacao', 'honorari', 'custas', 'pericia', 'acordo', 'alvara', 'sucumb',
];
/** Vida pessoal do sócio — nada disso é custo de operar o escritório. */
const PESSOAL = [
  'supermercado', 'restaurante', 'lanche', 'bebida', 'farra', 'noivado', 'viagem',
  'uber', 'roupa', 'cuidados pessoais', 'saude', 'educacao', 'livro', 'doacao',
  'ajuda familia', 'visita familia', 'manutencao casa', 'manutencao do carro',
  'combustivel', 'ipva', 'licenciamento', 'hillux', 'utv', 'previdenciario',
];

/**
 * De que caixa a linha é. Com CNJ preenchido a resposta é sempre `processo` —
 * a linha só existe porque um processo a gerou. Sem CNJ, decide pela categoria.
 */
export function naturezaDoLancamento(entrada: {
  categoria?: string | null;
  /** `jm_lancamentos.processo_cnj` preenchido, ou o vínculo do lançamento manual. */
  temProcesso?: boolean | null;
}): NaturezaLancamento {
  const c = normalizar(entrada.categoria);
  if (entrada.temProcesso) return 'processo';
  if (DE_PROCESSO.some(t => c.includes(t))) return 'processo';
  if (PESSOAL.some(t => c.includes(t))) return 'pessoal';
  return 'escritorio';
}

export function classificarLancamento(entrada: {
  categoria?: string | null;
  pessoa?: string | null;
  /**
   * Lançamento manual: o estado real vem de `lead_financials.settled_at`
   * (NULL = o dinheiro ainda não entrou), NÃO do texto da categoria. Nenhuma
   * das categorias do formulário tem "a receber" no nome, então sem isto um
   * honorário lançado com vencimento futuro virava caixa no mesmo instante.
   * Ausente = a linha veio da planilha, e lá a categoria decide como sempre.
   */
  previsto?: boolean | null;
}): ClassificacaoLancamento {
  const cat = normalizar(entrada.categoria);
  const pessoa = normalizar(entrada.pessoa);
  const previstoExplicito = entrada.previsto ?? null;
  const previsto = previstoExplicito ?? cat.includes('a receber');

  const monta = (
    titular: TitularLancamento,
    especie: EspecieLancamento,
    extra?: Partial<ClassificacaoLancamento>,
  ): ClassificacaoLancamento => ({
    titular,
    especie,
    especieLabel: ESPECIE_LABEL[especie],
    previsto,
    adiantado: false,
    ...extra,
  });

  // Antecipação do FIDC: caixa que não veio do processo. Antes de "honorário".
  if (cat.includes('adiantad')) {
    // Antecipação do fundo é caixa por definição — só um previsto EXPLÍCITO
    // (parcela contratada com a Oriz e ainda não liberada) contraria isso.
    return monta('escritorio', 'adiantamento_fidc', {
      adiantado: true,
      previsto: previstoExplicito ?? false,
    });
  }
  // Crédito da parte comprado pelo escritório. Antes de "indenização".
  if (cat.includes('comprad')) return monta('escritorio', 'credito_comprado');
  // Repasse ao advogado parceiro: o dinheiro é dele. Antes do bloco de
  // honorário porque PESSOA aqui traz "HC/HS <nome do parceiro>".
  if (cat.includes('parceiro')) return monta('parceiro', 'honorario_parceiro');

  if (cat.includes('honorari')) {
    // A espécie vem da categoria (lançamento manual) ou de PESSOA (planilha).
    if (cat.includes('contratu') || pessoa.startsWith('hc')) {
      return monta('escritorio', 'honorario_contratual');
    }
    if (cat.includes('sucumb') || pessoa.startsWith('hs')) {
      return monta('escritorio', 'honorario_sucumbencial');
    }
    return monta('escritorio', 'honorario');
  }

  // Cota da parte: indenização paga ao cliente, ou repasse lançado à mão.
  if (cat.includes('indeniza') || cat.includes('cota') || cat.includes('pagamento cliente')) {
    return monta('cliente', 'cota_cliente');
  }

  // Custas, perícia, deslocamento, folha, imposto: operação do escritório.
  return monta('escritorio', 'operacao');
}

/**
 * Em que estágio da régua está a linha. Precisa da DATA, que a classificação de
 * categoria sozinha não tem — por isso é função separada e não campo de
 * `classificarLancamento`.
 *
 * `hoje` entra por parâmetro para o teste não depender do relógio.
 */
export function estagioDoLancamento(entrada: {
  categoria?: string | null;
  pessoa?: string | null;
  /** Ver `classificarLancamento`: o lançamento manual manda o estado real. */
  previsto?: boolean | null;
  data?: string | null;
  /**
   * `jm_lancamentos.tem_data_pagamento`. false = a `data` é a da DECISÃO e não
   * há cronograma; a linha é CONDENAÇÃO e nunca vence. Ausente vale como true,
   * que é o padrão da coluna.
   */
  temDataPagamento?: boolean | null;
  hoje?: string;
}): EstagioLancamento {
  const cls = classificarLancamento(entrada);
  if (!cls.previsto) return 'REALIZADO';
  // Valor fixado sem cronograma: a data que a linha carrega é a da decisão, e
  // lê-la como vencimento marcaria como atrasado o que nunca teve prazo.
  if (entrada.temDataPagamento === false) return 'CONDENACAO';
  const hoje = entrada.hoje ?? new Date().toISOString().slice(0, 10);
  // Sem data não dá para dizer que venceu — fica como a receber, e a tela
  // mostra "sem data" em vez de inventar atraso.
  if (!entrada.data) return 'A_RECEBER';
  return entrada.data < hoje ? 'VENCIDO' : 'A_RECEBER';
}

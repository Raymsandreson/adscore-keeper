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
 * Classifica uma linha de lançamento. Serve tanto para `jm_lancamentos` (onde
 * `pessoa` traz HC/HS) quanto para o lançamento manual do app (onde a própria
 * categoria já diz contratual/sucumbencial e `pessoa` não existe).
 *
 * A ORDEM dos testes importa: "Honorários Adiantados Oriz" casa com honorário e
 * com adiantado; "Indenização comprada" casa com indenização e com comprada. O
 * caso mais específico vem primeiro nos dois.
 */
export function classificarLancamento(entrada: {
  categoria?: string | null;
  pessoa?: string | null;
}): ClassificacaoLancamento {
  const cat = normalizar(entrada.categoria);
  const pessoa = normalizar(entrada.pessoa);
  const previsto = cat.includes('a receber');

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
    return monta('escritorio', 'adiantamento_fidc', { adiantado: true, previsto: false });
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

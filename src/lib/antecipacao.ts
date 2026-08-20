// =============================================================================
// PARCELAMENTO E ANTECIPAÇÃO — as duas contas que o recebível pede.
//
// PARCELAR: um acordo em 12x é UM combinado com DOZE vencimentos. Lançar doze
// vezes à mão é onde nasce erro de data e de centavo, então o formulário
// pergunta o plano e esta função devolve as parcelas prontas.
//
// ANTECIPAR: quem tem R$ 10.000 para receber em 6 meses e quer o dinheiro hoje
// recebe menos — a diferença é o deságio. É a mesma conta que o FIDC faz com o
// nosso honorário e que o escritório faz com a cota do cliente:
//
//     valor presente = valor de face ÷ (1 + i)^(meses)
//
// Juros COMPOSTOS, porque é assim que o mercado precifica recebível: 3% a.m. em
// 6 meses não é 18%, é 19,4%. Simples subestimaria o desconto e a proposta ao
// cliente sairia mais generosa do que o pretendido.
//
// Deságio NÃO é multa nem mora. Ele paga o TEMPO que falta até o vencimento —
// por isso parcela já vencida não desconta nada aqui (ver `antecipar`). O que
// se cobra de quem atrasou é outra conta, e vive em outro lugar.
// =============================================================================
import { addDays, addMonths, addYears, differenceInCalendarDays, format, parseISO } from 'date-fns';

export type Periodicidade = 'diaria' | 'semanal' | 'quinzenal' | 'mensal' | 'anual';

/**
 * O que o número "valor" quer dizer quando há mais de uma parcela:
 *   dividir  R$ 1.200 em 12x -> doze parcelas de R$ 100 (acordo fechado no total)
 *   repetir  R$ 1.200 em 12x -> doze parcelas de R$ 1.200 (aluguel, mensalidade)
 * Confundir os dois erra o valor por um fator de 12 — daí ser escolha explícita
 * no formulário, sem padrão esperto.
 */
export type ModoParcelamento = 'dividir' | 'repetir';

export const PERIODICIDADE_LABEL: Record<Periodicidade, string> = {
  diaria: 'Diária — a cada dia',
  semanal: 'Semanal — a cada 7 dias',
  quinzenal: 'Quinzenal — a cada 15 dias',
  mensal: 'Mensal — mesmo dia do mês',
  anual: 'Anual — mesmo dia do ano',
};

export interface Parcela {
  /** 1..de */
  n: number;
  de: number;
  /** Vencimento, ISO yyyy-MM-dd. */
  data: string;
  valor: number;
}

const ISO = 'yyyy-MM-dd';
const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/**
 * Vencimento da parcela `i` (0 = a primeira).
 *
 * Mensal usa `addMonths`, que respeita fim de mês: 31/01 + 1 mês = 28/02, não
 * 03/03. Vencimento que escorrega de mês desalinha o carnê inteiro.
 *
 * "Quinzenal" aqui é a cada 15 DIAS, como no boleto — não "duas vezes por mês".
 */
export function vencimentoDaParcela(primeiraData: string, periodicidade: Periodicidade, i: number): string {
  const base = parseISO(primeiraData);
  switch (periodicidade) {
    case 'diaria': return format(addDays(base, i), ISO);
    case 'semanal': return format(addDays(base, 7 * i), ISO);
    case 'quinzenal': return format(addDays(base, 15 * i), ISO);
    case 'anual': return format(addYears(base, i), ISO);
    case 'mensal':
    default: return format(addMonths(base, i), ISO);
  }
}

/**
 * As parcelas de um plano, uma por vencimento.
 *
 * A SOBRA DE CENTAVO vai na ÚLTIMA: R$ 100 em 3x são 33,33 + 33,33 + 33,34, e
 * não três de 33,33 que somam R$ 99,99. A soma das parcelas fecha com o total
 * combinado — é o que o cliente confere.
 *
 * Recusa dividir valor pequeno demais (R$ 0,02 em 3x): melhor erro na cara do
 * que três linhas de R$ 0,00 no extrato.
 */
export function gerarParcelas(input: {
  valor: number;
  parcelas: number;
  periodicidade: Periodicidade;
  /** Vencimento da primeira, ISO yyyy-MM-dd. */
  primeiraData: string;
  modo: ModoParcelamento;
}): Parcela[] {
  const de = Math.trunc(input.parcelas);
  if (!Number.isFinite(de) || de < 1) throw new Error('Número de parcelas inválido');
  const total = centavos(input.valor);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Valor inválido');

  const valores: number[] = [];
  if (input.modo === 'repetir') {
    for (let i = 0; i < de; i += 1) valores.push(total);
  } else {
    if (total < de) throw new Error(`Valor pequeno demais para dividir em ${de} parcelas`);
    const base = Math.floor(total / de);
    for (let i = 0; i < de; i += 1) valores.push(base);
    valores[de - 1] += total - base * de;
  }

  return valores.map((c, i) => ({
    n: i + 1,
    de,
    data: vencimentoDaParcela(input.primeiraData, input.periodicidade, i),
    valor: reais(c),
  }));
}

export interface Antecipacao {
  valorFuturo: number;
  /** Dias corridos até o vencimento. 0 quando já venceu ou vence hoje. */
  dias: number;
  /** dias ÷ 30 — o expoente da conta, não mês de calendário. */
  meses: number;
  /** O que sai hoje para quem antecipa. */
  valorPresente: number;
  /** valorFuturo − valorPresente. É o que o deságio custa. */
  desconto: number;
}

const doisDecimais = (v: number) => Math.round(v * 100) / 100;

/**
 * Quanto vale HOJE um recebível que vence em `vencimento`, a `taxaMes` % ao mês.
 *
 * Parcela já vencida devolve o valor cheio, sem desconto: não há tempo a
 * comprar. Descontar aí seria cobrar do cliente o atraso disfarçado de deságio.
 *
 * `hoje` entra por parâmetro para o teste não depender do relógio.
 */
export function antecipar(input: {
  valorFuturo: number;
  /** ISO yyyy-MM-dd. */
  vencimento: string;
  /** Percentual ao mês: 3 = 3% a.m. */
  taxaMes: number;
  hoje?: string;
}): Antecipacao {
  const valorFuturo = doisDecimais(input.valorFuturo);
  const hoje = input.hoje ?? format(new Date(), ISO);
  const dias = Math.max(0, differenceInCalendarDays(parseISO(input.vencimento), parseISO(hoje)));
  const taxa = Math.max(0, input.taxaMes);
  const meses = dias / 30;
  const valorPresente = dias === 0 || taxa === 0
    ? valorFuturo
    : doisDecimais(valorFuturo / (1 + taxa / 100) ** meses);
  return { valorFuturo, dias, meses, valorPresente, desconto: doisDecimais(valorFuturo - valorPresente) };
}

/** Soma de uma carteira antecipada. Soma os já arredondados — é o que a tela mostra linha a linha. */
export function totalAntecipacao(itens: Antecipacao[]): { valorFuturo: number; valorPresente: number; desconto: number } {
  let valorFuturo = 0, valorPresente = 0;
  for (const i of itens) { valorFuturo += i.valorFuturo; valorPresente += i.valorPresente; }
  return {
    valorFuturo: doisDecimais(valorFuturo),
    valorPresente: doisDecimais(valorPresente),
    desconto: doisDecimais(valorFuturo - valorPresente),
  };
}

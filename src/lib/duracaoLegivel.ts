/**
 * Tempo em anos, meses e dias — porque "782 d" não diz nada a ninguém.
 *
 * Pedido do Raym em 26/08/2026: "o tempo ser em anos, meses e dias, pq pelo
 * número de dias é mais difícil ter noção, e entre parênteses o total de meses".
 *
 * Ele está certo, e o motivo é prático: quem negocia deságio raciocina em meses.
 * "782 d" exige uma divisão de cabeça no meio da conversa; "2 a 1 m 22 d
 * (25 meses)" entrega as duas leituras de uma vez — a humana e a da conta.
 *
 * ── A aproximação, dita na cara
 *
 *    Ano de 365 dias, mês de 30. Não é calendário exato: fevereiro e ano
 *    bissexto ficam de fora. É deliberado — o número de entrada já é uma MÉDIA
 *    de dias entre processos, então precisão de calendário seria falsa. O que
 *    importa é ser estável e conferível: `anos × 12 + meses` sempre bate com o
 *    total entre parênteses, e ninguém precisa saber a regra para confiar.
 */

export interface Duracao {
  anos: number;
  meses: number;
  dias: number;
  /** anos × 12 + meses. É o que vai entre parênteses. */
  totalMeses: number;
}

const DIAS_ANO = 365;
const DIAS_MES = 30;

export function decomporDuracao(diasTotais: number): Duracao {
  // Negativo não é duração: vira zero em vez de "-1 a 11 m", que confundiria
  // mais do que o número cru que se queria substituir.
  const d = Math.max(0, Math.round(Number(diasTotais) || 0));
  const anos = Math.floor(d / DIAS_ANO);
  const resto = d - anos * DIAS_ANO;
  const meses = Math.floor(resto / DIAS_MES);
  return { anos, meses, dias: resto - meses * DIAS_MES, totalMeses: anos * 12 + meses };
}

/**
 * "2 a 1 m 22 d (25 meses)". Omite o que é zero à esquerda — um processo de
 * 40 dias vira "1 m 10 d", não "0 a 1 m 10 d".
 *
 * `comTotal` desliga os parênteses onde não cabem (linha estreita, tooltip).
 */
export function duracaoLegivel(
  diasTotais: number | null | undefined,
  opts: { comTotal?: boolean } = {},
): string {
  if (diasTotais == null) return '—';
  const n = Math.round(Number(diasTotais) || 0);
  if (n <= 0) return 'hoje';

  const { anos, meses, dias, totalMeses } = decomporDuracao(n);
  const partes: string[] = [];
  if (anos > 0) partes.push(`${anos} a`);
  if (meses > 0) partes.push(`${meses} m`);
  // O dia só aparece quando é o único a dizer algo, ou quando há resto de fato.
  if (dias > 0 || partes.length === 0) partes.push(`${dias} d`);

  const base = partes.join(' ');
  // Menos de um mês já se lê direto: "(0 meses)" seria ruído.
  if (opts.comTotal === false || totalMeses === 0) return base;
  return `${base} (${totalMeses} ${totalMeses === 1 ? 'mês' : 'meses'})`;
}

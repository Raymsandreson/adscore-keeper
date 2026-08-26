/**
 * Conciliação de acordo — o que foi lançado bate com o que o acordo diz?
 *
 * A planilha "CONTROLE FINANCEIRO GRUPO PRUDÊNCIO" foi importada uma vez, à mão,
 * e nunca mais sincronizada. Ela é a única fonte de parcela para 39 dos 353
 * processos da carteira. Se o que está lá diverge do acordo, a carteira mente —
 * e ninguém tem como saber, porque não havia com o que comparar.
 *
 * ── A régua, ditada pelo Raym em 25/08/2026
 *
 *    O contratual é SEMPRE 30%, salvo negociação rara. Disso sai a estrutura
 *    inteira, sobre o valor BRUTO da indenização:
 *
 *      cliente = 70% do bruto      HC = 30% do bruto      HS = 10% do bruto
 *      acordo total = 110% do bruto
 *
 *    Logo, partindo do que o cliente recebe:
 *
 *      HC esperado = cliente × 3/7        HS esperado = cliente × 1/7
 *
 * ── Conferido contra documento, não contra teoria
 *
 *    Termo de acordo do caso 88 (0011351-63.2022.5.15.0031, juntado 08/04/2024):
 *    cliente R$ 397.727,26 → HC do termo R$ 170.454,55 e HS R$ 56.818,18.
 *    A fórmula devolve R$ 170.454,54 e R$ 56.818,18. Fecha ao centavo, e o
 *    total reconstruído dá exatamente os R$ 625.000,00 do acordo.
 *
 * ── A multa NÃO é divergência
 *
 *    Acordo descumprido gera multa (30% do saldo devedor, no caso 88), lançada
 *    como parcela extra com "Multa pelo descumprimento" na observação. São
 *    R$ 66.000 no caso 88 — e foi isso que fez a planilha somar R$ 684.561,39
 *    contra os R$ 625.000 do acordo. Entra na carteira (decisão do Raym), mas
 *    fora da conciliação: comparar acordo com acordo, multa à parte.
 */

/** Percentual contratual padrão. Negociação diferente é rara e vira exceção manual. */
export const HC_PADRAO = 0.30;

/**
 * O SUCUMBENCIAL NÃO TEM PADRÃO — e por isso não entra na régua.
 *
 * Corrigido em 25/08/2026, depois que o Raym desmentiu a primeira versão deste
 * arquivo: o HS varia de 5% a 15% conforme o juiz arbitrou, pode ser majorado de
 * novo no cumprimento de sentença, e pode ser dispensado. Tem acordo que traz,
 * tem acordo que não traz.
 *
 * Que o caso 88 tenha dado 10% redondos foi coincidência daquele caso, não regra.
 * Prever HS e cobrar a diferença acusaria divergência em acordo correto — o
 * pior defeito possível numa tela de conferência, porque destrói a confiança em
 * todos os outros alertas dela.
 *
 * Aqui o HS é OBSERVADO, nunca esperado. A faixa serve só para a tela comentar
 * quando o valor lançado cai fora do usual; fora dela nada é acusado.
 */
export const HS_FAIXA = { min: 0.05, max: 0.15 } as const;

/** Centavo de arredondamento não é divergência. Abaixo disso, é ruído. */
export const TOLERANCIA = 1;

export interface LancadoNoAcordo {
  /** Soma das linhas de indenização, JÁ sem a multa. */
  cliente: number;
  /** Soma das linhas de honorário contratual, já sem a multa. */
  hc: number;
  /** Honorário sucumbencial lançado. Quase sempre 0: foi lançado dentro do HC. */
  hs?: number | null;
  /** Multa por descumprimento. Fica fora da conta, mas viaja para a tela. */
  multa?: number | null;
}

export type SituacaoConciliacao = 'OK' | 'HC_FALTANDO' | 'HC_SOBRANDO' | 'SEM_CLIENTE';

export interface Conciliacao {
  cliente: number;
  hc: number;
  hs: number;
  multa: number;
  /** Valor da indenização antes do honorário: cliente ÷ 0,7. */
  bruto: number;
  hcEsperado: number;
  /** % do bruto que o HS lançado representa. null quando não há HS. */
  hsPctDoBruto: number | null;
  /** true = há HS lançado e ele cai fora da faixa usual de 5% a 15%. Comentário,
   *  não acusação: o juiz pode ter arbitrado assim. */
  hsForaDaFaixa: boolean;
  /** Positivo = falta lançar honorário nosso. Negativo = há honorário a mais. */
  faltaHc: number;
  /** O acordo como deveria ter sido lançado: cota + HC de 30% + o HS que a peça
   *  trouxe. O HS entra pelo valor OBSERVADO, porque não há como prevê-lo. */
  acordoEsperado: number;
  /** O que a planilha realmente traz, sem a multa. */
  acordoLancado: number;
  situacao: SituacaoConciliacao;
}

/** Centavos. O `+ 0` mata o zero NEGATIVO, que a tela mostraria como "-R$ 0,00". */
const arred = (n: number) => Math.round(n * 100) / 100 + 0;
const num = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function conciliarAcordo(l: LancadoNoAcordo): Conciliacao {
  const cliente = arred(num(l.cliente));
  const hc = arred(num(l.hc));
  const hs = arred(num(l.hs));
  const multa = arred(num(l.multa));

  // Sem cota de cliente não há régua: 30% de quê? Devolver zero fingiria
  // conciliação; a tela precisa saber que este caso não pode ser conferido.
  if (cliente <= 0) {
    return {
      cliente, hc, hs, multa, bruto: 0, hcEsperado: 0,
      hsPctDoBruto: null, hsForaDaFaixa: false,
      faltaHc: 0, acordoEsperado: 0, acordoLancado: arred(hc + hs),
      situacao: 'SEM_CLIENTE',
    };
  }

  const bruto = arred(cliente / (1 - HC_PADRAO));
  const hcEsperado = arred(bruto * HC_PADRAO);
  const faltaHc = arred(hcEsperado - hc);
  // HS zerado é legítimo: pode ter sido dispensado, ou o acordo não o previu.
  const hsPctDoBruto = hs > 0 ? Math.round((hs / bruto) * 10000) / 10000 : null;

  return {
    cliente, hc, hs, multa, bruto, hcEsperado, faltaHc,
    hsPctDoBruto,
    hsForaDaFaixa: hsPctDoBruto != null
      && (hsPctDoBruto < HS_FAIXA.min || hsPctDoBruto > HS_FAIXA.max),
    acordoEsperado: arred(cliente + hcEsperado + hs),
    acordoLancado: arred(cliente + hc + hs),
    situacao: Math.abs(faltaHc) <= TOLERANCIA ? 'OK'
      : faltaHc > 0 ? 'HC_FALTANDO' : 'HC_SOBRANDO',
  };
}

/** Ordena pelo que mais dói primeiro: maior divergência em reais, sem sinal. */
export function ordenarPorDivergencia<T extends { conciliacao: Conciliacao }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => Math.abs(b.conciliacao.faltaHc) - Math.abs(a.conciliacao.faltaHc));
}

export function totalizarConciliacao(cs: Conciliacao[]) {
  let faltando = 0, sobrando = 0, ok = 0, semCliente = 0, multa = 0;
  for (const c of cs) {
    multa += c.multa;
    if (c.situacao === 'OK') ok += 1;
    else if (c.situacao === 'SEM_CLIENTE') semCliente += 1;
    else if (c.faltaHc > 0) faltando += c.faltaHc;
    else sobrando += -c.faltaHc;
  }
  return {
    acordos: cs.length, ok, semCliente,
    hcFaltando: arred(faltando), hcSobrando: arred(sobrando),
    /** Saldo: quanto de honorário existe além do que está lançado. */
    saldo: arred(faltando - sobrando),
    multa: arred(multa),
  };
}

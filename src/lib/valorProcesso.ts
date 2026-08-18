/**
 * Quanto VALE o processo — a pergunta que o extrato não responde.
 *
 * Duas fontes, duas perguntas diferentes, que nunca se somam:
 *  - `jm_partes` (importado da aba Tab. Aux da jurimetria) é ESTOQUE: uma linha
 *    por PARTE, com a condenação corrigida e a separação cota do cliente ×
 *    honorário do escritório. Responde "de quanto é o processo".
 *  - `jm_lancamentos` / `jm_pagamentos` é FLUXO: uma linha por PARCELA.
 *    Responde "quando o dinheiro entra".
 *
 * Somar os dois conta o mesmo dinheiro duas vezes. Por isso este módulo é
 * separado do extrato e devolve o resumo já fechado, sem tocar em lançamento.
 *
 * ── Como as colunas da planilha se encaixam (medido nas 688 partes com valor
 *    em 18/08/2026, fecha em 679 = 98,7%):
 *
 *      condenação = cota da parte + honorário contratual À VISTA + sucumbencial
 *
 *    Duas armadilhas que essa identidade esconde, as duas verificadas no dado:
 *
 *    1. `hc_parcelado` NÃO é uma fatia a mais da condenação — ele já está DENTRO
 *       da cota da parte. É o honorário que o cliente paga em prestações com o
 *       dinheiro que recebeu, enquanto o "à vista" é retido antes de repassar.
 *       Somar os dois ao lado da cota inflava o total em 55 partes.
 *       Logo: do cliente, LÍQUIDO = cota − hc_parcelado.
 *
 *    2. Em 251 partes a coluna "TOTAL PARTE CJCM" vem zerada e o valor do cliente
 *       está só em "TOTAL À VISTA PARTE CJCM" — são as linhas ainda PROJETADAS,
 *       onde a planilha não preencheu o total. Nessas, a cota vem da coluna à
 *       vista, e o resumo marca quantas foram (`cotaProjetada`) para a tela poder
 *       dizer que ali é projeção, não acordo fechado.
 */

export interface ParteValor {
  parteId: string;
  cliente: string | null;
  /** Total da condenação corrigida (CJCM). null = a planilha não trouxe valor. */
  condenacao: number | null;
  /** "TOTAL PARTE CJCM" — o bruto do cliente, com o honorário parcelado dentro. */
  cota: number | null;
  /** "TOTAL À VISTA PARTE CJCM" — vale como cota quando a de cima vem zerada. */
  cotaVista: number | null;
  /** Honorário CONTRATUAL: à vista sai da condenação, parcelado sai da cota. */
  hcVista: number | null;
  hcParcelado: number | null;
  /** Honorário SUCUMBENCIAL — pago pela parte contrária, nunca sai da cota. */
  hs: number | null;
  status: string | null;
  fase: string | null;
}

export interface ResumoValorProcesso {
  partes: ParteValor[];
  /** Partes com condenação importada — as outras vieram só com status/fase. */
  comValor: number;
  semValor: number;
  condenacao: number;
  /** Cota do cliente antes de descontar o honorário parcelado. */
  cotaBruta: number;
  /** O que sobra para o cliente: cota − honorário contratual parcelado. */
  cotaLiquida: number;
  /** Honorário contratual total (à vista + parcelado). */
  hc: number;
  hcParcelado: number;
  hs: number;
  /** HC + HS: tudo que é nosso na condenação, venha da retenção ou do parcelamento. */
  escritorio: number;
  /** Partes cuja cota veio da coluna "à vista" porque o total estava zerado. */
  cotaProjetada: number;
  /**
   * condenação − cota − hc à vista − hs. Deveria ser zero e é em 98,7% das partes.
   * Onde sobra, a tela mostra em vez de esconder — número que não fecha e não
   * avisa é pior que número ausente.
   */
  diferenca: number;
  /** Status de pagamento presentes, do mais frequente ao menos. */
  status: Array<{ status: string; partes: number }>;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const texto = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

/**
 * Centavos: somar float direto deixa resíduo de 1e-10 na diferença. O `+ 0`
 * mata o zero NEGATIVO — sem ele um resíduo de -1e-12 vira `-0` e a tela mostra
 * "-R$ 0,00" numa conta que fechou.
 */
const arred = (n: number) => Math.round(n * 100) / 100 + 0;

/** Converte a linha crua de `jm_partes` — o client externo não é tipado. */
export function montarParteValor(row: Record<string, unknown>): ParteValor {
  return {
    parteId: String(row.parte_id ?? ''),
    cliente: texto(row.cliente),
    condenacao: num(row.condenacao_cjcm),
    cota: num(row.cota_parte_cjcm),
    cotaVista: num(row.cota_parte_vista_cjcm),
    hcVista: num(row.hc_vista),
    hcParcelado: num(row.hc_parcelado),
    hs: num(row.hs),
    status: texto(row.status_pagamento),
    fase: texto(row.fase_atual),
  };
}

/** Cota bruta da parte, com o fallback da coluna "à vista" (ver cabeçalho). */
export function cotaBrutaDaParte(p: ParteValor): number {
  return arred((p.cota ?? 0) > 0 ? (p.cota as number) : (p.cotaVista ?? 0));
}

/** true = a cota veio da coluna "à vista": é projeção, não acordo fechado. */
export function cotaEhProjecao(p: ParteValor): boolean {
  return (p.cota ?? 0) <= 0 && (p.cotaVista ?? 0) > 0;
}

/** Honorário do escritório na parte: contratual (à vista + parcelado) + sucumbencial. */
export function honorarioDaParte(p: ParteValor): number {
  return arred((p.hcVista ?? 0) + (p.hcParcelado ?? 0) + (p.hs ?? 0));
}

/** O que sobra para o cliente depois do contratual parcelado, que sai da cota dele. */
export function cotaLiquidaDaParte(p: ParteValor): number {
  return arred(cotaBrutaDaParte(p) - (p.hcParcelado ?? 0));
}

/** true = a parte veio da planilha só com status/fase, sem valor nenhum. */
export function parteSemValor(p: ParteValor): boolean {
  return p.condenacao == null && honorarioDaParte(p) === 0 && cotaBrutaDaParte(p) === 0;
}

export function resumirValorProcesso(partes: ParteValor[]): ResumoValorProcesso {
  let condenacao = 0, cotaBruta = 0, hcVista = 0, hcParcelado = 0, hs = 0;
  let comValor = 0, semValor = 0, cotaProjetada = 0;
  const porStatus = new Map<string, number>();
  for (const p of partes) {
    if (parteSemValor(p)) semValor += 1; else comValor += 1;
    if (cotaEhProjecao(p)) cotaProjetada += 1;
    condenacao += p.condenacao ?? 0;
    cotaBruta += cotaBrutaDaParte(p);
    hcVista += p.hcVista ?? 0;
    hcParcelado += p.hcParcelado ?? 0;
    hs += p.hs ?? 0;
    if (p.status) porStatus.set(p.status, (porStatus.get(p.status) ?? 0) + 1);
  }
  condenacao = arred(condenacao); cotaBruta = arred(cotaBruta);
  hcVista = arred(hcVista); hcParcelado = arred(hcParcelado); hs = arred(hs);
  const hc = arred(hcVista + hcParcelado);
  return {
    // Maior primeiro: numa ação com 32 partes, quem manda na conta aparece antes.
    partes: [...partes].sort((a, b) => (b.condenacao ?? 0) - (a.condenacao ?? 0)),
    comValor, semValor, condenacao, cotaBruta,
    cotaLiquida: arred(cotaBruta - hcParcelado),
    hc, hcParcelado, hs,
    escritorio: arred(hc + hs),
    cotaProjetada,
    diferenca: arred(condenacao - cotaBruta - hcVista - hs),
    status: [...porStatus.entries()]
      .map(([status, partes]) => ({ status, partes }))
      .sort((a, b) => b.partes - a.partes || a.status.localeCompare(b.status)),
  };
}

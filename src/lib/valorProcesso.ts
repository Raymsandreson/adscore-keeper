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
 * ── Como as colunas da planilha se encaixam
 *
 *    O caso é PENSIONAMENTO: a condenação não é um bolo único, é uma pensão
 *    mensal. As parcelas que já venceram viram pagamento à vista; as vincendas
 *    seguem correndo. Conforme o tempo passa, vincenda vira vencida e migra para
 *    o lado "à vista" — e o honorário sobre ela migra junto. Por isso as colunas
 *    da planilha são um RETRATO de uma data, não um valor fixo.
 *
 *      VENCIDO (à vista)      bruto = cota_parte_vista_cjcm + hc_vista
 *      VINCENDO (a correr)    bruto = (cota_parte_cjcm − cota_parte_vista_cjcm) / 0,7
 *
 *    O honorário contratual é 30% do BRUTO de cada fatia — conferido no dado:
 *    30,00% exatos em 54 das 55 partes com vincendo (à vista) e em 53 das 55
 *    (vincendo). Ou seja `cota_parte_cjcm` já vem LÍQUIDA, com o honorário
 *    descontado nas duas fatias. Descontar `hc_parcelado` dela de novo tira do
 *    cliente um dinheiro que já não estava lá.
 *
 *    E a coluna "condenação" NÃO é o valor bruto do processo:
 *
 *      condenacao_cjcm = cota líquida total + hc_vista + hs
 *
 *    Fecha exato nas 5 partes do processo 0000072-69.2023.5.13.0009 e em 679 das
 *    688 partes com valor. Repare no que falta: `hc_parcelado` fica FORA. É o
 *    honorário que ainda vai ser apurado conforme as parcelas vencerem — daí o
 *    bruto de verdade ser `condenação + hc_parcelado`.
 *
 *    Uma segunda leitura, independente dessa: em 251 partes "TOTAL PARTE CJCM"
 *    vem zerada e o valor do cliente está só em "TOTAL À VISTA PARTE CJCM" — são
 *    linhas ainda PROJETADAS. Nessas a cota vem da coluna à vista, e o resumo
 *    marca quantas foram (`cotaProjetada`) para a tela dizer que ali é projeção.
 */

export interface ParteValor {
  parteId: string;
  cliente: string | null;
  /** Total da condenação corrigida (CJCM). null = a planilha não trouxe valor. */
  condenacao: number | null;
  /** "TOTAL PARTE CJCM" — cota do cliente já LÍQUIDA, vencido + vincendo. */
  cota: number | null;
  /** "TOTAL À VISTA PARTE CJCM" — a fatia da cota que já venceu. */
  cotaVista: number | null;
  /** Honorário contratual (30%) sobre o que JÁ venceu. */
  hcVista: number | null;
  /** Honorário contratual (30%) sobre o que ainda vai vencer. Fora da condenação. */
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
  /** Cota do cliente — já LÍQUIDA na planilha, vencido + vincendo. */
  cotaCliente: number;
  /** A fatia da cota que já venceu e é paga à vista. */
  cotaVencida: number;
  /** Honorário contratual total (sobre o vencido + sobre o vincendo). */
  hc: number;
  /** Honorário contratual JÁ apurado, sobre as parcelas que venceram. */
  hcVista: number;
  /** Honorário contratual A APURAR, conforme as parcelas forem vencendo. */
  hcParcelado: number;
  hs: number;
  /** HC + HS: tudo que é nosso, apurado e a apurar. */
  escritorio: number;
  /** hc à vista + hs: o nosso que já está fechado na condenação de hoje. */
  escritorioApurado: number;
  /**
   * Valor BRUTO do processo: condenação + hc_parcelado. A coluna "condenação" da
   * planilha deixa o honorário das vincendas de fora, então ela sozinha
   * subestima o processo.
   */
  bruto: number;
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

/** Honorário do escritório na parte: contratual (vencido + vincendo) + sucumbencial. */
export function honorarioDaParte(p: ParteValor): number {
  return arred((p.hcVista ?? 0) + (p.hcParcelado ?? 0) + (p.hs ?? 0));
}

/**
 * Cota do cliente. A planilha já entrega LÍQUIDA — o honorário de 30% foi
 * descontado tanto do vencido quanto do vincendo. Não descontar de novo.
 */
export function cotaClienteDaParte(p: ParteValor): number {
  return cotaBrutaDaParte(p);
}

/**
 * Quanto ainda falta vencer, em valor BRUTO. É daqui que sai o `hc_parcelado`
 * (30% dele) conforme cada parcela vence e migra para o lado à vista.
 */
export function vincendoBrutoDaParte(p: ParteValor): number {
  const vincendoLiquido = cotaBrutaDaParte(p) - (p.cotaVista ?? 0);
  return vincendoLiquido > 0 ? arred(vincendoLiquido / 0.7) : 0;
}

/** true = a parte veio da planilha só com status/fase, sem valor nenhum. */
export function parteSemValor(p: ParteValor): boolean {
  return p.condenacao == null && honorarioDaParte(p) === 0 && cotaBrutaDaParte(p) === 0;
}

export function resumirValorProcesso(partes: ParteValor[]): ResumoValorProcesso {
  let condenacao = 0, cotaBruta = 0, cotaVencida = 0, hcVista = 0, hcParcelado = 0, hs = 0;
  let comValor = 0, semValor = 0, cotaProjetada = 0;
  const porStatus = new Map<string, number>();
  for (const p of partes) {
    if (parteSemValor(p)) semValor += 1; else comValor += 1;
    if (cotaEhProjecao(p)) cotaProjetada += 1;
    condenacao += p.condenacao ?? 0;
    cotaBruta += cotaBrutaDaParte(p);
    cotaVencida += p.cotaVista ?? 0;
    hcVista += p.hcVista ?? 0;
    hcParcelado += p.hcParcelado ?? 0;
    hs += p.hs ?? 0;
    if (p.status) porStatus.set(p.status, (porStatus.get(p.status) ?? 0) + 1);
  }
  condenacao = arred(condenacao); cotaBruta = arred(cotaBruta); cotaVencida = arred(cotaVencida);
  hcVista = arred(hcVista); hcParcelado = arred(hcParcelado); hs = arred(hs);
  const hc = arred(hcVista + hcParcelado);
  return {
    // Maior primeiro: numa ação com 32 partes, quem manda na conta aparece antes.
    partes: [...partes].sort((a, b) => (b.condenacao ?? 0) - (a.condenacao ?? 0)),
    comValor, semValor, condenacao,
    cotaCliente: cotaBruta, cotaVencida,
    hc, hcVista, hcParcelado, hs,
    escritorio: arred(hc + hs),
    escritorioApurado: arred(hcVista + hs),
    bruto: arred(condenacao + hcParcelado),
    cotaProjetada,
    diferenca: arred(condenacao - cotaBruta - hcVista - hs),
    status: [...porStatus.entries()]
      .map(([status, partes]) => ({ status, partes }))
      .sort((a, b) => b.partes - a.partes || a.status.localeCompare(b.status)),
  };
}

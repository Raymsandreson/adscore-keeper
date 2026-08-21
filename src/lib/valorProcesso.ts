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
 * ── CJCM: os valores JÁ VÊM CORRIGIDOS
 *
 *    "CJCM" = **com juros e correção monetária**. Toda coluna com essa sigla na
 *    Tab. Aux já foi atualizada pela planilha; NÃO são nominais e não se
 *    multiplicam por coeficiente nenhum — isso seria corrigir duas vezes.
 *    Prova: na Leocadia (0016074-62.2016.5.16.0014) o dano moral nominal é
 *    R$ 50.000 e o "DANO MORAL E ESTÉTICO CJCM" é R$ 72.960 — 1,4592 de
 *    correção já embutida, com termo inicial em 20/09/2022.
 *
 *    Os valores NOMINAIS ficam em outras colunas da planilha (dano moral, dano
 *    estético, base de cálculo × tempo de pensionamento) e na aba Lançamentos.
 *    Nenhuma delas importada ainda.
 *
 * ── A estrutura: à vista + parcelado
 *
 *    O caso é PENSIONAMENTO. A condenação da parte se divide em duas fatias:
 *
 *      À VISTA    o que já venceu, pago de uma vez
 *                 = valor vencido + dano moral e estético
 *      PARCELADO  o que ainda vai vencer, pago mês a mês
 *
 *    Conforme o tempo passa, parcela vincenda vira vencida e migra para o lado à
 *    vista — junto com o honorário sobre ela. As colunas são um RETRATO de uma
 *    data, não um valor fixo.
 *
 *    Sobre cada fatia o contrato leva 30%, e a parte fica com 70%:
 *
 *      bruto da fatia = cota da fatia / 0,7        honorário = 30% do bruto
 *
 *    Conferido: o honorário contratual total é 30% de `cota_parte_cjcm / 0,7`
 *    em 414 das 426 partes com cota. Ou seja `cota_parte_cjcm` já vem LÍQUIDA.
 *
 * ── Onde a planilha diverge do que a coluna promete
 *
 *    Pelo conceito, `TOTAL DA CONDENAÇÃO` deveria ser à vista + parcelado, isto
 *    é `cota_parte_cjcm / 0,7`. Não é: isso só bate em 77 das 426 partes. O que
 *    a coluna realmente traz é
 *
 *      condenacao_cjcm = cota líquida + honorário contratual do VENCIDO + sucumbencial
 *
 *    (417 de 426), deixando o honorário do vincendo de fora e somando o
 *    sucumbencial. Por isso `bruto` e `condenacao` aqui são campos SEPARADOS: um
 *    é a soma das duas fatias, o outro é o que a planilha chama de condenação.
 *    A divergência está reportada e não se resolve inventando fórmula.
 */

export interface ParteValor {
  parteId: string;
  cliente: string | null;
  /** Total da condenação corrigida (CJCM). null = a planilha não trouxe valor. */
  condenacao: number | null;
  /** "TOTAL PARTE CJCM" — do cliente, já líquido de honorário, à vista + parcelado. */
  cota: number | null;
  /** "TOTAL À VISTA PARTE CJCM" — do cliente, só a fatia à vista (já venceu). */
  cotaVista: number | null;
  /** "HONORÁRIOS CONTRATUAIS À VISTA" — 30% da fatia que já venceu. */
  hcVista: number | null;
  /** "HONORÁRIOS CONTRATUAIS PARCELADO" — 30% da fatia que ainda vai vencer. */
  hcParcelado: number | null;
  /** Honorário SUCUMBENCIAL — pago pela parte contrária, nunca sai da cota. */
  hs: number | null;
  status: string | null;
  fase: string | null;
  /** Termo inicial dos juros e da correção. É daqui que a atualização corre. */
  termoInicial: string | null;
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
   * À VISTA + PARCELADO, em valor bruto (antes do honorário contratual). É a
   * soma que responde "de quanto é a condenação desta parte" — e NÃO é o que a
   * coluna `TOTAL DA CONDENAÇÃO CJCM` traz (ver cabeçalho).
   */
  bruto: number;
  /** A fatia à vista, bruta: o que já venceu, cliente + honorário. */
  brutoVista: number;
  /** A fatia parcelada, bruta: o que ainda vai vencer, cliente + honorário. */
  brutoParcelado: number;
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
    termoInicial: texto(row.termo_inicial_jcm),
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

/** A fatia À VISTA em valor bruto: o que já venceu, cliente + honorário. */
export function vistaBrutaDaParte(p: ParteValor): number {
  const vista = Math.min(p.cotaVista ?? 0, cotaBrutaDaParte(p));
  return vista > 0 ? arred(vista / 0.7) : 0;
}

/** true = a parte veio da planilha só com status/fase, sem valor nenhum. */
export function parteSemValor(p: ParteValor): boolean {
  return p.condenacao == null && honorarioDaParte(p) === 0 && cotaBrutaDaParte(p) === 0;
}

export function resumirValorProcesso(partes: ParteValor[]): ResumoValorProcesso {
  let condenacao = 0, cotaBruta = 0, cotaVencida = 0, hcVista = 0, hcParcelado = 0, hs = 0;
  let comValor = 0, semValor = 0, cotaProjetada = 0, brutoVista = 0, brutoParcelado = 0;
  const porStatus = new Map<string, number>();
  for (const p of partes) {
    if (parteSemValor(p)) semValor += 1; else comValor += 1;
    if (cotaEhProjecao(p)) cotaProjetada += 1;
    condenacao += p.condenacao ?? 0;
    cotaBruta += cotaBrutaDaParte(p);
    cotaVencida += p.cotaVista ?? 0;
    brutoVista += vistaBrutaDaParte(p);
    brutoParcelado += vincendoBrutoDaParte(p);
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
    bruto: arred(brutoVista + brutoParcelado),
    brutoVista: arred(brutoVista), brutoParcelado: arred(brutoParcelado),
    cotaProjetada,
    diferenca: arred(condenacao - cotaBruta - hcVista - hs),
    status: [...porStatus.entries()]
      .map(([status, partes]) => ({ status, partes }))
      .sort((a, b) => b.partes - a.partes || a.status.localeCompare(b.status)),
  };
}

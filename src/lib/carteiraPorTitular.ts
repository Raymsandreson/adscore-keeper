/**
 * A carteira separada por DONO do dinheiro: o que é do cliente e o que é nosso.
 *
 * Pedido do Raym em 26/08/2026: ver "o que é do cliente, o que é honorários e o
 * estágio de cada uma separada e somados", com modo de visualização por titular.
 *
 * A pergunta muda conforme quem olha. Para negociar com o cliente, o que importa
 * é a cota dele. Para projetar o caixa do escritório, é o honorário. Somados,
 * respondem "quanto vale o processo". Três leituras do mesmo dado — e é por isso
 * que somar tudo num número só apaga as três.
 *
 * ── O TOTAL É O DA CARTEIRA, NÃO A SOMA DAS FATIAS
 *
 *    `juntos` soma a CONDENAÇÃO de cada parte, que é o que a carteira sempre
 *    mostrou. Não é `cliente + escritório`, e a diferença entre os dois é
 *    informação, não erro de arredondamento: é dinheiro da carteira que hoje
 *    não tem dono atribuído no banco (`semDono`).
 *
 *    Fazer `juntos = cliente + escritório` derrubaria o total da carteira de
 *    R$ 92,1 mi para R$ 30,0 mi sem que um centavo tivesse sumido do banco — o
 *    mesmo erro de esconder na tela o que precisa de conserto na origem.
 *
 * ── SÓ 16% DA CARTEIRA SABE DE QUEM É O DINHEIRO (medido em 27/08/2026)
 *
 *    `pop_carteira_marcos` tem duas fontes de valor:
 *
 *    - `decisao` (jm_valores) — 563 partes, R$ 32,0 mi. NÃO separa nada: cota e
 *      honorário voltam nulos. A decisão fixa o valor do processo; quem é o dono
 *      de cada pedaço está no contrato e na conta de liquidação, não ali.
 *    - `tab_aux` (jm_partes) — 262 partes, R$ 60,1 mi. Separa — mas 251 delas
 *      vêm com `cota_parte_cjcm = 0`, o que joga R$ 30,1 mi para `semDono`.
 *
 *    Nada disso é escondido aqui. Tudo soma; `Cobertura` diz quanto de cada
 *    coisa, e a tela leva o processo para a conferência. Ver a skill
 *    `conserto-estrutural-nao-pontual`.
 */

export interface ParteDaCarteira {
  processoCnj: string;
  cliente: string | null;
  /**
   * Condenação da parte. É o que a carteira soma, sempre, venha de onde vier.
   */
  valor: number;
  /**
   * Cota do cliente, já líquida do contratual.
   * `null` = a fonte deste valor não separa titular (veio da decisão).
   */
  cota: number | null;
  /**
   * Honorário do escritório na parte: contratual (à vista + parcelado) + o
   * sucumbencial. `null` = idem.
   */
  honorario: number | null;
  estagio: string;
}

export interface PorEstagio { estagio: string; valor: number; partes: number }

export interface FatiaTitular {
  total: number;
  /** Quantas partes têm valor > 0 nesta fatia. */
  partes: number;
  porEstagio: PorEstagio[];
}

/**
 * Quanto da carteira sabe responder "de quem é este dinheiro".
 *
 * Existe para a tela nunca ter de escolher entre mostrar um número incompleto e
 * não mostrar número nenhum: mostra os dois e diz o tamanho do buraco.
 */
export interface Cobertura {
  /** Valor das partes cuja fonte separa cliente/honorário. */
  comSeparacao: number;
  partesComSeparacao: number;
  /** Valor das partes cuja fonte não separa — a carteira soma, mas sem dono. */
  semSeparacao: number;
  partesSemSeparacao: number;
  /**
   * Dentro do que separa: `valor − cota − honorário`. Nem do cliente nem nosso.
   * Quase sempre é projeção pela metade: a Tab. Aux. projetou o honorário e
   * deixou a cota em zero, porque o processo ainda não tem decisão.
   */
  semDono: number;
  /** Partes que separam mas têm cota zerada com honorário projetado. */
  partesCotaZerada: number;
  /** Condenação dessas partes — o valor que a decisão vai repartir um dia. */
  valorCotaZerada: number;
}

export interface CarteiraPorTitular {
  /** Soma das cotas. */
  cliente: FatiaTitular;
  /** Soma dos honorários (contratual + sucumbencial). */
  escritorio: FatiaTitular;
  /** Soma das condenações: quanto o processo vale. O total da carteira. */
  juntos: FatiaTitular;
  cobertura: Cobertura;
}

/** Centavos. O `+ 0` mata o zero NEGATIVO, que a tela mostraria como "-R$ 0,00". */
const arred = (n: number) => Math.round(n * 100) / 100 + 0;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * A parte separa titular? Basta uma das duas colunas vir preenchida — importação
 * pela metade é justamente o caso que não pode sumir da conta.
 */
export function temSeparacao(p: { cota: number | null; honorario: number | null }): boolean {
  return p.cota != null || p.honorario != null;
}

/**
 * Cota zerada com honorário projetado.
 *
 * ── O QUE ISTO NÃO É (corrigido em 27/08/2026, no mesmo dia em que eu errei)
 *
 *    Escrevi antes que era erro de importação — "a Tab. Aux. gravou zero em vez
 *    do valor". Errado, e a evidência é limpa: das 251 partes com cota zerada e
 *    condenação, **251 estão marcadas `status_pagamento = 'PROJETADO'`** em
 *    `jm_partes`, quase todas em fase `Conhecimento`. Nenhuma parte marcada
 *    `A RECEBER` ou `PAGO` tem cota zerada.
 *
 *    Ou seja: a cota não está lá porque **ainda não existe**. O processo não
 *    tem decisão, o valor é projeção por tipo de parte, e não há o que repartir
 *    entre cliente e escritório. Zero é a resposta certa.
 *
 * ── O QUE SOBRA DE ESTRANHO
 *
 *    A Tab. Aux. projeta o HONORÁRIO (R$ 29,5 mi nessas mesmas partes) e deixa
 *    a cota em zero. A projeção é incompleta, não errada: quem projetou o
 *    honorário poderia ter projetado a cota pela mesma régua. É isto que o
 *    detector marca — projeção pela metade, que joga tudo para `semDono`.
 *
 * NÃO É FILTRO: nada é excluído por causa disto, o valor soma inteiro nos três
 * modos. É DETECTOR — e o conserto é a decisão sair e ser lida, não anexar peça
 * de um processo que ainda está em Conhecimento.
 */
export function cotaZeradaComHonorario(p: { cota: number | null; honorario: number | null }): boolean {
  return p.cota != null && num(p.cota) === 0 && num(p.honorario) > 0;
}

function somarPorEstagio(itens: Array<{ estagio: string; valor: number }>): PorEstagio[] {
  const mapa = new Map<string, { valor: number; partes: number }>();
  for (const i of itens) {
    if (i.valor === 0) continue;
    const e = mapa.get(i.estagio) ?? { valor: 0, partes: 0 };
    e.valor += i.valor; e.partes += 1;
    mapa.set(i.estagio, e);
  }
  return [...mapa.entries()]
    .map(([estagio, v]) => ({ estagio, valor: arred(v.valor), partes: v.partes }))
    .sort((a, b) => b.valor - a.valor);
}

function fatia(itens: Array<{ estagio: string; valor: number }>): FatiaTitular {
  const porEstagio = somarPorEstagio(itens);
  return {
    total: arred(porEstagio.reduce((s, e) => s + e.valor, 0)),
    partes: porEstagio.reduce((s, e) => s + e.partes, 0),
    porEstagio,
  };
}

export function separarPorTitular(partes: ParteDaCarteira[]): CarteiraPorTitular {
  const doCliente: Array<{ estagio: string; valor: number }> = [];
  const doEscritorio: Array<{ estagio: string; valor: number }> = [];
  const juntos: Array<{ estagio: string; valor: number }> = [];
  const cob: Cobertura = {
    comSeparacao: 0, partesComSeparacao: 0,
    semSeparacao: 0, partesSemSeparacao: 0,
    semDono: 0, partesCotaZerada: 0, valorCotaZerada: 0,
  };

  for (const p of partes ?? []) {
    const valor = num(p.valor);
    const estagio = p.estagio || 'SEM ESTÁGIO';

    // A condenação soma sempre. É a carteira, e ela não depende de sabermos de
    // quem é o dinheiro.
    juntos.push({ estagio, valor });

    if (!temSeparacao(p)) {
      cob.semSeparacao += valor;
      if (valor > 0) cob.partesSemSeparacao += 1;
      continue;
    }

    const cota = num(p.cota);
    const honorario = num(p.honorario);
    cob.comSeparacao += valor;
    if (valor > 0) cob.partesComSeparacao += 1;
    // O que a condenação tem a mais que cota + honorário não é de ninguém ainda.
    // Negativo seria dado pior ainda (as fatias passando do bolo) — some do
    // mesmo jeito, para a tela poder mostrar que passou.
    cob.semDono += valor - cota - honorario;

    if (cotaZeradaComHonorario(p)) {
      cob.partesCotaZerada += 1;
      cob.valorCotaZerada += valor;
    }

    doCliente.push({ estagio, valor: cota });
    doEscritorio.push({ estagio, valor: honorario });
  }

  return {
    cliente: fatia(doCliente),
    escritorio: fatia(doEscritorio),
    juntos: fatia(juntos),
    cobertura: {
      comSeparacao: arred(cob.comSeparacao),
      partesComSeparacao: cob.partesComSeparacao,
      semSeparacao: arred(cob.semSeparacao),
      partesSemSeparacao: cob.partesSemSeparacao,
      semDono: arred(cob.semDono),
      partesCotaZerada: cob.partesCotaZerada,
      valorCotaZerada: arred(cob.valorCotaZerada),
    },
  };
}

/** Os três modos de leitura da carteira. */
export type ModoCarteira = 'JUNTOS' | 'CLIENTE' | 'ESCRITORIO';

export const MODOS: ModoCarteira[] = ['JUNTOS', 'CLIENTE', 'ESCRITORIO'];

/** Rótulo do seletor — curto, porque são três botões lado a lado. */
export const MODO_LABEL: Record<ModoCarteira, string> = {
  JUNTOS: 'Tudo',
  CLIENTE: 'Do cliente',
  ESCRITORIO: 'Honorários',
};

/** O que aquele número é, escrito por extenso embaixo do valor. */
export const MODO_DESCRICAO: Record<ModoCarteira, string> = {
  JUNTOS: 'quanto os processos valem — cliente e honorários juntos',
  CLIENTE: 'cota dos clientes, já líquida do contratual',
  ESCRITORIO: 'honorário contratual e sucumbencial do escritório',
};

export function fatiaDoModo(c: CarteiraPorTitular, modo: ModoCarteira): FatiaTitular {
  return modo === 'CLIENTE' ? c.cliente : modo === 'ESCRITORIO' ? c.escritorio : c.juntos;
}

/**
 * Peso de cada titular dentro do que TEM separação — a barrinha de composição.
 *
 * A base é `comSeparacao`, não a carteira inteira: misturar o que não separa
 * daria uma barra em que "sem dono" seria maioria por motivo errado.
 */
export function composicao(c: CarteiraPorTitular): { cliente: number; escritorio: number; semDono: number } {
  const base = c.cobertura.comSeparacao;
  if (base <= 0) return { cliente: 0, escritorio: 0, semDono: 0 };
  const pct = (v: number) => Math.max(0, Math.round((v / base) * 1000) / 10);
  return {
    cliente: pct(c.cliente.total),
    escritorio: pct(c.escritorio.total),
    semDono: pct(c.cobertura.semDono),
  };
}

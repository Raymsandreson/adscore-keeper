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
 * ── A CARTEIRA SOMA O QUE ESTÁ NO BANCO. SEM EXCEÇÃO.
 *
 *    A primeira versão deste arquivo excluía do total o sucumbencial
 *    "implausível" (HS maior que a cota, R$ 37,2 mi em 258 partes). Errado, e o
 *    Raym cortou na hora: filtrar na tela troca um número errado por outro
 *    número errado, agora para menos, e ainda esconde da vista o processo que
 *    precisa de conserto.
 *
 *    O valor suspeito continua somando aqui. Quem age sobre ele é a
 *    CONCILIAÇÃO: o processo entra na fila com o motivo, e dali sai o caminho
 *    que já existe — anexar a peça certa, ler, corrigir `jm_valores`. Corrigido
 *    o dado, este módulo acerta sozinho, sem trava nenhuma.
 *
 *    A regra geral, que vale para todo este projeto: tela não conserta dado.
 *    Tela mostra o dado e aponta o caminho do conserto.
 */

export interface ParteDaCarteira {
  processoCnj: string;
  cliente: string | null;
  /** Cota do cliente, já líquida do contratual. */
  cota: number;
  /** Honorário contratual: vencido + vincendo. */
  hc: number;
  /** Sucumbencial. Pago pela parte contrária, não sai da cota. */
  hs: number;
  estagio: string;
}

export interface PorEstagio { estagio: string; valor: number; partes: number }

export interface FatiaTitular {
  total: number;
  porEstagio: PorEstagio[];
}

export interface CarteiraPorTitular {
  cliente: FatiaTitular;
  escritorio: FatiaTitular;
  /** cliente + escritório: quanto o processo vale. */
  juntos: FatiaTitular;
  /**
   * HS que não pode estar certo — DENTRO dos totais acima, porque a carteira
   * soma o banco. Viaja junto só para a conferência saber a quem chamar.
   */
  hsSuspeito: { valor: number; partes: number };
}

/** Centavos. O `+ 0` mata o zero NEGATIVO, que a tela mostraria como "-R$ 0,00". */
const arred = (n: number) => Math.round(n * 100) / 100 + 0;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * O sucumbencial não pode passar da cota do cliente.
 *
 * A régua: sobre o bruto, o cliente fica com 70% e o HS roda de 5% a 15%. Para o
 * HS alcançar a cota, o juiz teria de arbitrar 70% — que não existe. Quando
 * passa, o dado está errado, não o caso.
 *
 * NÃO É FILTRO: nada é excluído por causa disto. É DETECTOR — o que ele marca
 * vira linha na conferência, com o caminho para anexar a peça que traz o valor
 * certo. Conservador de propósito: só acusa o IMPOSSÍVEL, não o alto.
 */
export function hsEhSuspeito(p: { hs: number; cota: number }): boolean {
  return num(p.hs) > 0 && num(p.hs) > num(p.cota);
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

export function separarPorTitular(partes: ParteDaCarteira[]): CarteiraPorTitular {
  const doCliente: Array<{ estagio: string; valor: number }> = [];
  const doEscritorio: Array<{ estagio: string; valor: number }> = [];
  const juntos: Array<{ estagio: string; valor: number }> = [];
  let hsSuspeitoValor = 0, hsSuspeitoPartes = 0;

  for (const p of partes ?? []) {
    const cota = num(p.cota);
    const hc = num(p.hc);
    const hs = num(p.hs);
    const estagio = p.estagio || 'SEM ESTÁGIO';

    // Contado, nunca descontado: o número entra no total e o processo entra na
    // fila de conferência. Ver o cabeçalho.
    if (hsEhSuspeito({ hs, cota })) { hsSuspeitoValor += hs; hsSuspeitoPartes += 1; }

    const nosso = hc + hs;
    doCliente.push({ estagio, valor: cota });
    doEscritorio.push({ estagio, valor: nosso });
    juntos.push({ estagio, valor: cota + nosso });
  }

  const fatia = (itens: Array<{ estagio: string; valor: number }>): FatiaTitular => {
    const porEstagio = somarPorEstagio(itens);
    return { total: arred(porEstagio.reduce((s, e) => s + e.valor, 0)), porEstagio };
  };

  return {
    cliente: fatia(doCliente),
    escritorio: fatia(doEscritorio),
    juntos: fatia(juntos),
    hsSuspeito: { valor: arred(hsSuspeitoValor), partes: hsSuspeitoPartes },
  };
}

/** Os três modos de leitura da carteira. */
export type ModoCarteira = 'JUNTOS' | 'CLIENTE' | 'ESCRITORIO';

export const MODO_LABEL: Record<ModoCarteira, string> = {
  JUNTOS: 'Cliente + honorários',
  CLIENTE: 'Só a parte do cliente',
  ESCRITORIO: 'Só honorários',
};

export function fatiaDoModo(c: CarteiraPorTitular, modo: ModoCarteira): FatiaTitular {
  return modo === 'CLIENTE' ? c.cliente : modo === 'ESCRITORIO' ? c.escritorio : c.juntos;
}

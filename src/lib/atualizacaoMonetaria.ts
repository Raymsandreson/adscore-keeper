/**
 * Qual régua de atualização vale para um crédito, e como aplicá-la.
 *
 * A carteira tinha UM índice só — `SELIC_SIMPLES_JT`, a soma simples da SELIC.
 * Isso é o regime da ADC 58 DEPOIS do ajuizamento, e nada mais. Aplicado a tudo,
 * erra em duas frentes (as duas medidas em 19/08/2026):
 *
 *  - **70 processos são de justiça comum** (segmentos 8 e 4 do CNJ). Nunca
 *    seguiram a SELIC simples. Corrigidos pela régua certa, valem R$ 8,7 mi a
 *    mais — a maior distorção da base, e vinha de omissão, não de decisão.
 *  - **Desde 30/08/2024 vale a Lei 14.905/2024** para os dois ramos: correção
 *    pelo IPCA e juros pela taxa legal (SELIC − IPCA, com PISO ZERO). Ignorar
 *    isso subestimava o trabalhista em R$ 3,0 mi.
 *
 * A regra é POR MÊS, não por crédito: um crédito de 2022 corre sob ADC 58 até
 * ago/2024 e sob a Lei 14.905 daí em diante. Quem monta o fator mês a mês é a
 * função `jm_regua_por_ramo()` no Postgres; aqui só se escolhe a régua e se
 * aplica o coeficiente que ela já publicou em `jm_indices`.
 *
 * Ver docs/sistema/metodologia-atualizacao.md para as fontes e o que falta.
 */

/** Nome do índice em `jm_indices`. É o que a consulta filtra. */
export type ReguaAtualizacao = 'REGUA_TRABALHISTA' | 'REGUA_COMUM';

export const REGUA_LABEL: Record<ReguaAtualizacao, string> = {
  REGUA_TRABALHISTA: 'Justiça do Trabalho',
  REGUA_COMUM: 'Justiça comum',
};

/**
 * Dígito J do CNJ (posição 14 dos 20 dígitos) diz o segmento do Judiciário.
 * 5 = Justiça do Trabalho. Os demais (8 estadual, 4 federal, 1/2/3 superiores)
 * seguem o Código Civil, não a tabela do CSJT.
 *
 * CNJ ausente ou malformado devolve `null` — e crédito sem régua conhecida NÃO
 * se corrige por palpite: a tela mostra o nominal e diz que falta o número.
 */
export function reguaDoProcesso(cnj: string | null | undefined): ReguaAtualizacao | null {
  const d = String(cnj ?? '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  return d[13] === '5' ? 'REGUA_TRABALHISTA' : 'REGUA_COMUM';
}

/** Competência de uma data-base: o índice é mensal, a data é diária. */
export function competenciaDe(data: string | Date | null | undefined): string | null {
  if (!data) return null;
  const s = typeof data === 'string' ? data : data.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export interface ValorAtualizado {
  nominal: number;
  /** null = não foi possível corrigir; o motivo está em `porque`. */
  atualizado: number | null;
  coeficiente: number | null;
  regua: ReguaAtualizacao | null;
  /** Por que não corrigiu, ou por que corrigiu assim. Vai para a tela. */
  porque: 'ok' | 'pago' | 'sem-data-base' | 'sem-cnj' | 'sem-coeficiente';
}

export interface EntradaAtualizacao {
  valor: number | null;
  cnj: string | null | undefined;
  /** Termo inicial dos juros e da correção monetária. */
  dataBase: string | Date | null | undefined;
  /** Dinheiro que já caiu na conta não corrige — correção é do que falta receber. */
  pago?: boolean;
  /** competência (YYYY-MM-01) -> coeficiente, já filtrado pela régua e pela safra. */
  coeficientes: Map<string, number>;
}

/**
 * Aplica a régua a um valor. Devolve SEMPRE o nominal, e o atualizado só quando
 * há como calcular — em vez de "corrigir" por um coeficiente inventado, o que
 * produziria um número que ninguém consegue auditar depois.
 */
export function atualizarValor(e: EntradaAtualizacao): ValorAtualizado {
  const nominal = e.valor ?? 0;
  const regua = reguaDoProcesso(e.cnj);
  const base = { nominal, atualizado: null as number | null, coeficiente: null as number | null, regua };
  // A ordem importa: PAGO vence tudo. Um crédito pago sem data-base não é um
  // problema de dado — é um crédito que simplesmente não corrige mais.
  if (e.pago) return { ...base, atualizado: nominal, coeficiente: 1, porque: 'pago' };
  if (!regua) return { ...base, porque: 'sem-cnj' };
  const comp = competenciaDe(e.dataBase);
  if (!comp) return { ...base, porque: 'sem-data-base' };
  const coef = e.coeficientes.get(comp);
  if (coef == null) return { ...base, porque: 'sem-coeficiente' };
  return {
    ...base,
    atualizado: Math.round(nominal * coef * 100) / 100,
    coeficiente: coef,
    porque: 'ok',
  };
}

/** Motivo em português, para a tela não mostrar o código cru. */
export const PORQUE_LABEL: Record<ValorAtualizado['porque'], string> = {
  ok: '',
  pago: 'já pago — não corrige',
  'sem-data-base': 'sem termo inicial na planilha',
  'sem-cnj': 'sem CNJ válido para saber o ramo',
  'sem-coeficiente': 'sem coeficiente para essa competência',
};

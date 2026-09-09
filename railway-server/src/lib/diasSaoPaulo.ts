// Dia civil brasileiro — o calendário que o painel de métricas usa.
//
// POR QUE EXISTE. `new Date().toISOString().slice(0,10)` devolve o dia **UTC**,
// e o Brasil é UTC-3. Com ele, "hoje" começava às 21h de ontem: medido em
// 09/09/2026, o card dizia 130 leads e 5 tinham chegado entre 21:01 e 22:24 do
// dia anterior.
//
// Pior, o insights da Meta já vem no fuso DA CONTA, e as duas contas de anúncio
// são `America/Sao_Paulo`. Agrupar lead por dia UTC contra gasto por dia de São
// Paulo deslocava a barra e a linha do gráfico em três horas.
//
// O Brasil não tem horário de verão desde 2019, então o deslocamento é fixo —
// mas quem decide isso aqui é o `Intl`, não uma subtração de 3h escrita à mão.
export const FUSO = 'America/Sao_Paulo';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia civil de São Paulo de um instante. `en-CA` é o locale que dá YYYY-MM-DD. */
export function diaLocal(quando: Date): string {
  return formatador.format(quando);
}

export function hojeISO(): string {
  return diaLocal(new Date());
}

/** `diasAtras(6)` = o dia de 6 dias atrás. Para montar janela, use `corteDeDias`. */
export function diasAtras(n: number): string {
  return diaLocal(new Date(Date.now() - n * 86_400_000));
}

/**
 * Primeiro dia de uma janela de `dias` dias que **inclui hoje**, para usar com
 * filtro `>=`.
 *
 * Existe para tornar o off-by-one impossível de escrever. "Últimos 7 dias" é
 * hoje mais os 6 anteriores, então o corte é `diasAtras(6)` — quem escrevia
 * `diasAtras(7)` produzia uma janela de OITO dias, e o card passava a discordar
 * do próprio gráfico ao lado: 3.615 contra 3.536 leads, e 63 fechamentos contra
 * 38 reais (medido em 09/09/2026). Agora se pede a janela pelo tamanho dela.
 */
export function corteDeDias(dias: number): string {
  if (!Number.isInteger(dias) || dias < 1) throw new Error(`janela inválida: ${dias}`);
  return diasAtras(dias - 1);
}

/** Para coluna `timestamptz` (ex.: `leads.created_at`): converte o fuso. */
export function diaDoInstante(valor: unknown): string {
  if (!valor) return '';
  const d = new Date(valor as string);
  return Number.isNaN(d.getTime()) ? '' : diaLocal(d);
}

/**
 * Para coluna `DATE` (ex.: `leads.became_client_date`): NÃO converte.
 *
 * Um DATE já é o dia civil, sem hora e sem fuso. Passá-lo por conversão o
 * interpretaria como meia-noite UTC e jogaria todo fechamento um dia para trás.
 */
export function diaDaColuna(valor: unknown): string {
  return String(valor || '').slice(0, 10);
}

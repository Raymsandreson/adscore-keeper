// =============================================================================
// Prazo de um passo do POP: quanto tempo se espera para executá-lo.
//
// Serve para medir quem está dentro do prazo e quem não está (pedido do
// usuário, 08/08/2026).
//
// POR QUE TRÊS UNIDADES E NÃO SÓ "DIAS": prazo processual quase sempre corre em
// DIAS ÚTEIS — os próprios passos deste POP dizem "8 dias úteis JT e 15 dias
// úteis JC", "5 dias úteis" nos embargos. Guardar tudo em dias corridos
// obrigaria a converter na cabeça e erraria por 2 dias a cada semana. Já prazo
// de acompanhamento ("cobrar em 3 meses") é natural em meses.
//
// FERIADO NÃO É CONSIDERADO. Pular sábado e domingo é o que dá para fazer sem
// uma tabela de feriados forenses (que varia por tribunal e por ano). O
// resultado é uma data OTIMISTA no dias-úteis: o prazo real pode cair depois.
// Isto aqui mede desempenho da equipe, não prazo fatal — para prazo fatal a
// fonte continua sendo a intimação.
//
// Módulo puro: sem I/O e sem Date.now() implícito — a data de hoje entra por
// parâmetro para o cálculo ser testável.
// =============================================================================

export type PrazoUnidade = 'dias_uteis' | 'dias' | 'meses';

export const UNIDADE_LABEL: Record<PrazoUnidade, string> = {
  dias_uteis: 'dias úteis',
  dias: 'dias corridos',
  meses: 'meses',
};

export interface Prazo {
  valor: number;
  unidade: PrazoUnidade;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Interpreta 'YYYY-MM-DD' ao meio-dia UTC — evita o dia virar por fuso. */
function parse(dataIso: string): Date {
  return new Date(`${dataIso.slice(0, 10)}T12:00:00Z`);
}

/**
 * Data em que o passo vence, contando a partir de `inicio` (inclusive o dia
 * seguinte como primeiro dia — quem recebe a tarefa hoje tem o dia de hoje).
 */
export function calcularVencimento(inicioIso: string, prazo: Prazo): string | null {
  if (!inicioIso || !prazo || !Number.isFinite(prazo.valor) || prazo.valor <= 0) return null;
  const d = parse(inicioIso);

  if (prazo.unidade === 'meses') {
    d.setUTCMonth(d.getUTCMonth() + Math.round(prazo.valor));
    return iso(d);
  }

  if (prazo.unidade === 'dias') {
    d.setUTCDate(d.getUTCDate() + Math.round(prazo.valor));
    return iso(d);
  }

  // dias úteis: avança dia a dia pulando sábado (6) e domingo (0).
  let restantes = Math.round(prazo.valor);
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return iso(d);
}

export type SituacaoPrazo = 'sem_prazo' | 'no_prazo' | 'vence_hoje' | 'atrasado';

export interface AvaliacaoPrazo {
  situacao: SituacaoPrazo;
  vencimento: string | null;
  /** Negativo = dias de atraso; positivo = dias que faltam. */
  diasRestantes: number | null;
}

/**
 * Onde o passo está em relação ao prazo. `hoje` entra por parâmetro para o
 * teste não depender do relógio.
 */
export function avaliarPrazo(inicioIso: string | null, prazo: Prazo | null | undefined, hojeIso: string): AvaliacaoPrazo {
  if (!inicioIso || !prazo || !prazo.valor) {
    return { situacao: 'sem_prazo', vencimento: null, diasRestantes: null };
  }
  const vencimento = calcularVencimento(inicioIso, prazo);
  if (!vencimento) return { situacao: 'sem_prazo', vencimento: null, diasRestantes: null };

  const msDia = 24 * 60 * 60 * 1000;
  const diff = Math.round((parse(vencimento).getTime() - parse(hojeIso).getTime()) / msDia);

  if (diff < 0) return { situacao: 'atrasado', vencimento, diasRestantes: diff };
  if (diff === 0) return { situacao: 'vence_hoje', vencimento, diasRestantes: 0 };
  return { situacao: 'no_prazo', vencimento, diasRestantes: diff };
}

/** Rótulo curto para a tela: "8 dias úteis", "3 meses". */
export function prazoLabel(prazo: Prazo | null | undefined): string | null {
  if (!prazo || !prazo.valor) return null;
  const n = Math.round(prazo.valor);
  if (prazo.unidade === 'meses') return `${n} ${n === 1 ? 'mês' : 'meses'}`;
  if (prazo.unidade === 'dias') return `${n} ${n === 1 ? 'dia' : 'dias'}`;
  return `${n} ${n === 1 ? 'dia útil' : 'dias úteis'}`;
}

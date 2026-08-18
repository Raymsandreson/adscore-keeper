// Contagem de status por assessor responsável no painel de Feedbacks
// (atividades em que EU sou observador/criador).
//
// Fica fora do componente porque é regra de negócio pura — a mesma
// classificação que o funil usa nas colunas — e assim dá pra testar sem
// montar a árvore React inteira.

export type FeedbackStatusKey =
  | 'atrasada'
  | 'reagendada'
  | 'a_avaliar'
  | 'satisfeito'
  | 'incompleto'
  | 'insatisfeito';

export const FEEDBACK_STATUS_KEYS: FeedbackStatusKey[] = [
  'atrasada',
  'reagendada',
  'a_avaliar',
  'satisfeito',
  'incompleto',
  'insatisfeito',
];

/** Linha sem retorno ainda (atrasada ou reagendada). */
export interface LateLike {
  assigned_to_name: string | null;
  status: string | null;
}

/** Linha com retorno preenchido — avaliada ou não. */
export interface FeedbackLike {
  assigned_to_name: string | null;
  feedback_outcome: string | null;
}

export interface AssessorStatusCount {
  assessor: string;
  atrasada: number;
  reagendada: number;
  a_avaliar: number;
  satisfeito: number;
  incompleto: number;
  insatisfeito: number;
  total: number;
}

export const SEM_RESPONSAVEL = '—';

/** Mesma regra da coluna do funil: reagendada tem status próprio, o resto é atrasada. */
export function statusDeLate(row: LateLike): Extract<FeedbackStatusKey, 'atrasada' | 'reagendada'> {
  return row.status === 'reagendada' ? 'reagendada' : 'atrasada';
}

/** Sem desfecho registrado = ainda a avaliar. */
export function statusDeFeedback(row: FeedbackLike): FeedbackStatusKey {
  const out = row.feedback_outcome;
  if (out === 'satisfeito' || out === 'incompleto' || out === 'insatisfeito') return out;
  return 'a_avaliar';
}

function linhaVazia(assessor: string): AssessorStatusCount {
  return {
    assessor,
    atrasada: 0,
    reagendada: 0,
    a_avaliar: 0,
    satisfeito: 0,
    incompleto: 0,
    insatisfeito: 0,
    total: 0,
  };
}

/**
 * Quantidade de cada status por assessor responsável, já ordenada:
 * primeiro quem tem mais atrasadas, depois maior total, depois nome.
 * É a leitura de cobrança — quem está devendo aparece no topo.
 */
export function contarPorAssessor(late: LateLike[], feedback: FeedbackLike[]): AssessorStatusCount[] {
  const mapa = new Map<string, AssessorStatusCount>();
  const bump = (nome: string | null, key: FeedbackStatusKey) => {
    const assessor = nome || SEM_RESPONSAVEL;
    let linha = mapa.get(assessor);
    if (!linha) { linha = linhaVazia(assessor); mapa.set(assessor, linha); }
    linha[key] += 1;
    linha.total += 1;
  };

  for (const r of late) bump(r.assigned_to_name, statusDeLate(r));
  for (const r of feedback) bump(r.assigned_to_name, statusDeFeedback(r));

  return Array.from(mapa.values()).sort((a, b) =>
    b.atrasada - a.atrasada || b.total - a.total || a.assessor.localeCompare(b.assessor)
  );
}

/** Rodapé da tabela — soma de todas as linhas. */
export function totalGeral(linhas: AssessorStatusCount[]): Omit<AssessorStatusCount, 'assessor'> {
  return linhas.reduce((acc, l) => {
    for (const k of FEEDBACK_STATUS_KEYS) acc[k] += l[k];
    acc.total += l.total;
    return acc;
  }, { atrasada: 0, reagendada: 0, a_avaliar: 0, satisfeito: 0, incompleto: 0, insatisfeito: 0, total: 0 });
}

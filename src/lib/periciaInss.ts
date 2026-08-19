// =============================================================================
// Perícia como EVENTO DE AGENDA — regras puras.
//
// A data marcada no cabeçalho da atividade vira uma linha em `hearings`, a
// mesma tabela onde a audiência mora (migration 20260819110000). Antes ela ia
// para `lead_processes.pericia_medica_at`, que em 19/08/2026 tinha 1 linha no
// banco inteiro: o chip só aparecia em processo intitulado "Benefício INSS" e
// 35% das atividades de perícia não têm processo nenhum vinculado.
//
// FUSO: `hearings` guarda `hearing_date` (date) + `hearing_time` (time SEM
// fuso) + `timezone_label` textual — hora local, como a convocação diz. Por
// isso aqui não há conversão UTC nenhuma: a string "2026-09-24T08:00" do
// `datetime-local` vira ('2026-09-24', '08:00') e volta igual. O caminho antigo
// precisava converter porque gravava em timestamptz, e era onde a hora escorregava.
// =============================================================================

/** Os dois eventos que o cabeçalho da atividade marca. */
export type PericiaTipo = 'medica' | 'social';

export const PERICIA_TIPOS: PericiaTipo[] = ['medica', 'social'];

/**
 * `hearing_type` gravado no banco. O sufixo "(INSS)" separa a perícia
 * administrativa da judicial que vem da planilha ("Perícia Médica", 71 linhas
 * em 19/08/2026) — as duas são perícia e convivem na mesma aba do calendário,
 * mas quem trabalha precisa saber se o cliente vai ao INSS ou ao fórum.
 */
export const PERICIA_HEARING_TYPE: Record<PericiaTipo, string> = {
  medica: 'Perícia Médica (INSS)',
  social: 'Avaliação Social (INSS)',
};

/** Rótulo curto do chip. */
export const PERICIA_LABEL: Record<PericiaTipo, string> = {
  medica: 'Perícia médica',
  social: 'Avaliação social',
};

function normalize(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * O processo é o "Benefício INSS" do caso?
 *
 * Título literal, e não heurística de INSS/BPC/auxílio: é assim que o processo
 * nasce (724 dos 1.000 primeiros processos administrativos em 13/08/2026) e é a
 * mesma string que `processAssignment` já usa pra decidir responsável. Ampliar
 * pra qualquer título "previdenciário" traria perícia pra processo que não tem.
 */
export function isBeneficioInssProcess(title?: string | null): boolean {
  return normalize(title) === 'beneficio inss';
}

/**
 * A ATIVIDADE fala de perícia? Segundo caminho para o chip aparecer.
 *
 * Sem isto o chip fica invisível justamente onde a equipe mais precisa: das 326
 * atividades vivas de perícia em 19/08/2026, 115 (35%) não têm processo
 * vinculado e outras tantas apontam para processo judicial, então a regra do
 * "Benefício INSS" não as alcançava.
 *
 * `\bpericias?\b` e não `includes('peric')`: "Peticionar cobrando a juntada do
 * LAUDO PERICIAL" e "manifestar sobre laudo pericial" são trabalho SOBRE a
 * perícia já realizada, não convocação — ganhar um chip de "marcar data" ali só
 * suja o cabeçalho. "Avaliação social" entra porque é o nome que o BPC usa.
 */
export function ehAtividadeDePericia(title?: string | null, activityTypeLabel?: string | null): boolean {
  const alvo = `${normalize(title)} ${normalize(activityTypeLabel)}`;
  return /\bpericias?\b/.test(alvo) || alvo.includes('avaliacao social');
}

/** ('2026-09-24', '08:00:00') → '2026-09-24T08:00' para o `datetime-local`. */
export function periciaInputValue(data?: string | null, hora?: string | null): string {
  if (!data) return '';
  const d = data.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const h = (hora || '').slice(0, 5);
  return `${d}T${/^\d{2}:\d{2}$/.test(h) ? h : '09:00'}`;
}

/**
 * '2026-09-24T08:00' → { data, hora } para gravar em `hearings`.
 * Devolve null quando a string não é uma data-hora completa — o chamador não
 * deve gravar meia data.
 */
export function periciaPartesDoInput(value?: string | null): { data: string; hora: string } | null {
  const m = (value || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { data: m[1], hora: m[2] } : null;
}

/** Rótulo do chip: "24/09/2026 08:00". Sem hora, só a data. */
export function formatPericia(data?: string | null, hora?: string | null): string {
  if (!data) return '';
  const m = data.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dia = `${m[3]}/${m[2]}/${m[1]}`;
  const h = (hora || '').slice(0, 5);
  return /^\d{2}:\d{2}$/.test(h) ? `${dia} ${h}` : dia;
}

export type PericiaTom = 'vazio' | 'futura' | 'hoje' | 'passada';

/**
 * Em que pé está a perícia, pra colorir o chip. `agora` é injetável pra teste.
 * "hoje" é o dia civil da perícia — quem abre a atividade nesse dia precisa ver
 * na hora que o cliente tem perícia marcada.
 *
 * Comparação de DATA por string, não por Date: `hearing_date` é uma data civil
 * ("o dia da convocação"), e virar Date só reintroduziria o fuso que a coluna
 * foi feita para não ter.
 */
export function periciaTom(data?: string | null, agora: Date = new Date()): PericiaTom {
  const d = (data || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'vazio';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hoje = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
  if (d === hoje) return 'hoje';
  return d > hoje ? 'futura' : 'passada';
}

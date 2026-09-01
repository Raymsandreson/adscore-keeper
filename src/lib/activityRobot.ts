/**
 * Quem criou a atividade: uma pessoa ou um robô.
 *
 * A marca vem do banco (`lead_activities`), nunca de adivinhação na tela:
 *
 * - `action_source = 'system'`  → algum robô nosso criou (o robô fica em
 *   `action_source_detail`: "Robô do INSS", "Follow-up automático", etc.)
 * - `action_source = 'escavador_compromissos'` → sync de prazos/audiências do
 *   Escavador (valor já usado desde a sync-process-compromissos, mantido porque
 *   é a chave de dedupe daquela função)
 * - `created_by_ai = true` → a IA gerou (generate-case-activities)
 * - `action_source = 'manual'` ou nulo → pessoa
 *
 * `is_system` NÃO entra aqui de propósito: no formulário ele é o botão
 * "Interna" (demanda de membro para membro), marcado por gente. Usá-lo como
 * sinal de robô carimbaria de robô atividade que uma pessoa digitou.
 *
 * Atividade antiga criada por robô antes deste carimbo fica sem marca — é o
 * certo: sem marca no banco, a tela não inventa uma.
 */

/** Carimbo que todo robô deve gravar em `lead_activities.action_source`. */
export const ACTIVITY_SOURCE_ROBOT = 'system';
/** Carimbo do que uma pessoa criou pela interface. */
export const ACTIVITY_SOURCE_MANUAL = 'manual';

/** Valores de `action_source` que significam "robô criou". */
const ROBOT_SOURCES = new Set([ACTIVITY_SOURCE_ROBOT, 'escavador_compromissos']);

/** Nome do robô quando a linha não trouxe `action_source_detail`. */
const ROBOT_SOURCE_LABELS: Record<string, string> = {
  system: 'Robô do sistema',
  escavador_compromissos: 'Robô de prazos e audiências (Escavador)',
};

/** O mínimo que a atividade precisa trazer do banco para ser classificada. */
export interface ActivityRobotFields {
  action_source?: string | null;
  action_source_detail?: string | null;
  created_by_ai?: boolean | null;
}

// Quem lista atividade com o símbolo do robô precisa trazer estas três colunas
// no `select`, LITERAIS (o supabase-js perde a tipagem se a lista de colunas for
// montada por concatenação):
//   action_source, action_source_detail, created_by_ai

/** true quando a atividade nasceu de um robô/automação, não de uma pessoa. */
export function isRobotActivity(activity: ActivityRobotFields | null | undefined): boolean {
  if (!activity) return false;
  if (activity.created_by_ai === true) return true;
  const source = activity.action_source;
  return !!source && ROBOT_SOURCES.has(source);
}

/**
 * Texto do tooltip: quem foi o robô. Retorna null quando não é robô, para o
 * chamador simplesmente não desenhar o símbolo.
 */
export function robotActivityLabel(activity: ActivityRobotFields | null | undefined): string | null {
  if (!isRobotActivity(activity)) return null;
  const source = activity?.action_source || '';
  // `action_source_detail` só é nome de robô quando o carimbo é 'system'. Na
  // sync do Escavador aquela coluna guarda o HASH de dedupe do compromisso
  // ('1gnyxtwbqje3h') — mostrá-lo viraria "Criada automaticamente por:
  // 1gnyxtwbqje3h" na tela de quem só quer saber quem criou.
  const detail = source === ACTIVITY_SOURCE_ROBOT ? activity?.action_source_detail?.trim() : null;
  if (detail) return `Criada automaticamente por: ${detail}`;
  if (activity?.created_by_ai === true) return 'Criada automaticamente pela IA';
  return `Criada automaticamente por: ${ROBOT_SOURCE_LABELS[source] || 'robô do sistema'}`;
}

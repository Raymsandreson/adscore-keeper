/**
 * Utility to classify Kanban stages by type.
 *
 * Convention:
 *  - First stage of a board = "Caixa de Entrada" (inbox)
 *  - Stages with IDs matching CLOSED patterns = "Fechado" (won)
 *  - Stages with IDs matching REFUSED patterns = "Recusado" (lost)
 *  - Everything else = "Em Andamento" (funnel / in progress)
 */

const CLOSED_STAGE_IDS = ['closed', 'fechado', 'fechados', 'done'];
const REFUSED_STAGE_IDS = ['recusado', 'recusados', 'not_qualified', 'lost', 'inviáveis'];

function matchesPattern(stageId: string, patterns: string[]): boolean {
  const lower = stageId.toLowerCase();
  return patterns.some(p => lower === p || lower.startsWith(p + '_'));
}

export type StageType = 'inbox' | 'closed' | 'refused' | 'funnel';

export function getStageType(stageId: string, stages: { id: string }[]): StageType {
  if (stages.length > 0 && stages[0].id === stageId) return 'inbox';
  if (matchesPattern(stageId, CLOSED_STAGE_IDS)) return 'closed';
  if (matchesPattern(stageId, REFUSED_STAGE_IDS)) return 'refused';
  return 'funnel';
}

export function isInboxStage(stageId: string, stages: { id: string }[]): boolean {
  return stages.length > 0 && stages[0].id === stageId;
}

export function isClosedStage(stageId: string): boolean {
  return matchesPattern(stageId, CLOSED_STAGE_IDS);
}

export function isRefusedStage(stageId: string): boolean {
  return matchesPattern(stageId, REFUSED_STAGE_IDS);
}

export function isFunnelStage(stageId: string, stages: { id: string }[]): boolean {
  return !isInboxStage(stageId, stages) && !isClosedStage(stageId) && !isRefusedStage(stageId);
}

export function findClosedStageId(stages: { id: string }[]): string | null {
  return stages.find(s => isClosedStage(s.id))?.id || null;
}

export function findRefusedStageId(stages: { id: string }[]): string | null {
  return stages.find(s => isRefusedStage(s.id))?.id || null;
}

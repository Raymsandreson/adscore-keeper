/**
 * Utility to classify Kanban stages by type.
 *
 * Convention:
 *  - First stage of a board = "Caixa de Entrada" (inbox)
 *  - Stages with IDs matching CLOSED patterns = "Fechado" (won)
 *  - Stages with IDs matching REFUSED patterns = "Recusado" (lost)
 *  - Everything else = "Em Andamento" (funnel / in progress)
 */

const CLOSED_STAGE_IDS = ['closed', 'fechado', 'done'];
const REFUSED_STAGE_IDS = ['recusado', 'not_qualified', 'lost'];

export type StageType = 'inbox' | 'closed' | 'refused' | 'funnel';

export function getStageType(stageId: string, stages: { id: string }[]): StageType {
  if (stages.length > 0 && stages[0].id === stageId) return 'inbox';
  if (CLOSED_STAGE_IDS.includes(stageId)) return 'closed';
  if (REFUSED_STAGE_IDS.includes(stageId)) return 'refused';
  return 'funnel';
}

export function isInboxStage(stageId: string, stages: { id: string }[]): boolean {
  return stages.length > 0 && stages[0].id === stageId;
}

export function isClosedStage(stageId: string): boolean {
  return CLOSED_STAGE_IDS.includes(stageId);
}

export function isRefusedStage(stageId: string): boolean {
  return REFUSED_STAGE_IDS.includes(stageId);
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

/**
 * Hierarchical progress calculation:
 * - Each Phase (stage) has equal weight (e.g., 5 phases = 20% each)
 * - Within a phase, each Objective (checklist instance) has equal weight
 * - Within an objective, each Step (item) has equal weight
 * 
 * Example: 5 phases, Phase 1 has 2 objectives:
 *   - Phase weight = 20%
 *   - Objective 1 weight = 10% (20% / 2)
 *   - If Objective 1 has 5 steps → each step = 2% (10% / 5)
 *   - If Objective 2 has 2 steps → each step = 5% (10% / 2)
 */

interface ProgressItem {
  id: string;
  checked?: boolean;
}

interface ProgressInstance {
  id: string;
  stage_id: string;
  items: ProgressItem[];
}

interface StageProgress {
  stageId: string;
  stagePercent: number;
  completedPercent: number;
  objectives: {
    instanceId: string;
    objectiveWeight: number;
    totalSteps: number;
    completedSteps: number;
    completedPercent: number;
  }[];
}

export interface HierarchicalProgress {
  globalPercent: number;
  stageDetails: StageProgress[];
}

export function calculateHierarchicalProgress(
  stageIds: string[],
  instances: ProgressInstance[]
): HierarchicalProgress {
  const totalStages = stageIds.length;
  if (totalStages === 0) {
    return { globalPercent: 0, stageDetails: [] };
  }

  const phaseWeight = 100 / totalStages;
  let globalPercent = 0;

  const stageDetails: StageProgress[] = stageIds.map(stageId => {
    const stageInstances = instances.filter(i => i.stage_id === stageId);
    const totalObjectives = stageInstances.length;

    if (totalObjectives === 0) {
      // No objectives configured — stage counts as 0% completed
      return {
        stageId,
        stagePercent: phaseWeight,
        completedPercent: 0,
        objectives: [],
      };
    }

    const objectiveWeight = phaseWeight / totalObjectives;
    let stageCompletedPercent = 0;

    const objectives = stageInstances.map(instance => {
      const totalSteps = instance.items.length;
      const completedSteps = instance.items.filter(item => item.checked).length;

      let objCompletedPercent = 0;
      if (totalSteps > 0) {
        objCompletedPercent = (completedSteps / totalSteps) * objectiveWeight;
      }

      stageCompletedPercent += objCompletedPercent;

      return {
        instanceId: instance.id,
        objectiveWeight,
        totalSteps,
        completedSteps,
        completedPercent: objCompletedPercent,
      };
    });

    globalPercent += stageCompletedPercent;

    return {
      stageId,
      stagePercent: phaseWeight,
      completedPercent: stageCompletedPercent,
      objectives,
    };
  });

  return {
    globalPercent: Math.round(globalPercent * 100) / 100,
    stageDetails,
  };
}

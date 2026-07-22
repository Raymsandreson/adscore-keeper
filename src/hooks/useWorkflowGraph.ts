import { useQuery } from '@tanstack/react-query';
import { db as supabase } from '@/integrations/supabase';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import type { ChecklistItem } from '@/hooks/useChecklists';

/**
 * Monta o "grafo" de um fluxo/funil para visualização (fluxograma e mapa
 * mental): fases → objetivos → passos.  Reusa exatamente a mesma origem de
 * dados que o FunnelBoardCard (checklist_stage_links + checklist_templates),
 * apenas em formato estruturado para desenho.
 *
 * As arestas do fluxograma saem dos passos: `nextStageId` (destino direto) e
 * `answers[].nextStageId` (destino por resposta).  '__finalize__' = terminal.
 */

export interface WorkflowGraphAnswer {
  id: string;
  label: string;
  nextStageId?: string;
}

export interface WorkflowGraphStep {
  id: string;
  label: string;
  activityType?: string;
  nextStageId?: string;
  answers?: WorkflowGraphAnswer[];
}

export interface WorkflowGraphObjective {
  templateId: string;
  name: string;
  isMandatory: boolean;
  steps: WorkflowGraphStep[];
}

export interface WorkflowGraphStage {
  id: string;
  name: string;
  color: string;
  objectives: WorkflowGraphObjective[];
}

export interface WorkflowGraph {
  boardId: string;
  boardName: string;
  boardType: 'funnel' | 'workflow';
  stages: WorkflowGraphStage[];
}

interface DBLink {
  stage_id: string;
  checklist_template_id: string;
  display_order: number;
}

interface DBTemplate {
  id: string;
  name: string;
  is_mandatory: boolean | null;
  items: unknown;
}

export function useWorkflowGraph(board: KanbanBoard | null | undefined, enabled = true) {
  return useQuery<WorkflowGraph>({
    queryKey: ['workflow-graph', board?.id],
    enabled: !!board && enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const b = board!;
      const stages = b.stages || [];

      const { data: links, error: linksError } = await supabase
        .from('checklist_stage_links')
        .select('stage_id, checklist_template_id, display_order')
        .eq('board_id', b.id)
        .order('display_order');
      if (linksError) throw linksError;

      const linkRows = (links || []) as DBLink[];
      const templateIds = [...new Set(linkRows.map(l => l.checklist_template_id))];

      let templateMap = new Map<string, DBTemplate>();
      if (templateIds.length > 0) {
        const { data: templates, error: tplError } = await supabase
          .from('checklist_templates')
          .select('id, name, is_mandatory, items')
          .in('id', templateIds);
        if (tplError) throw tplError;
        templateMap = new Map((templates || []).map(t => [t.id, t as DBTemplate]));
      }

      const graphStages: WorkflowGraphStage[] = stages.map(stage => {
        const stageLinks = linkRows
          .filter(l => l.stage_id === stage.id)
          .sort((a, b2) => a.display_order - b2.display_order);

        const objectives: WorkflowGraphObjective[] = stageLinks.map(link => {
          const tpl = templateMap.get(link.checklist_template_id);
          const items = (tpl?.items as ChecklistItem[] | undefined) || [];
          return {
            templateId: link.checklist_template_id,
            name: tpl?.name || 'Objetivo',
            isMandatory: !!tpl?.is_mandatory,
            steps: items.map(step => ({
              id: step.id,
              label: step.label,
              activityType: step.activityType,
              nextStageId: step.nextStageId,
              answers: step.answers?.map(a => ({
                id: a.id,
                label: a.label,
                nextStageId: a.nextStageId,
              })),
            })),
          };
        });

        return {
          id: stage.id,
          name: stage.name,
          color: stage.color || '#3b82f6',
          objectives,
        };
      });

      return {
        boardId: b.id,
        boardName: b.name,
        boardType: b.board_type,
        stages: graphStages,
      };
    },
  });
}

/**
 * Aresta derivada de um passo/resposta, para desenho do fluxograma.
 * `to === '__finalize__'` representa o nó terminal "Finalizar".
 */
export interface WorkflowEdge {
  from: string;
  to: string;
  label: string;
  kind: 'answer' | 'direct' | 'sequential';
}

export const FINALIZE_ID = '__finalize__';

/**
 * Extrai as arestas explícitas (roteamento configurado nos passos) e completa
 * com a progressão sequencial das fases que não têm saída explícita.
 */
export function buildWorkflowEdges(graph: WorkflowGraph): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];
  const stageHasExplicitOut = new Set<string>();
  const seen = new Set<string>();

  const push = (e: WorkflowEdge) => {
    const key = `${e.from}->${e.to}:${e.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };

  for (const stage of graph.stages) {
    for (const obj of stage.objectives) {
      for (const step of obj.steps) {
        if (step.answers?.length) {
          for (const ans of step.answers) {
            if (!ans.nextStageId) continue;
            stageHasExplicitOut.add(stage.id);
            push({ from: stage.id, to: ans.nextStageId, label: ans.label || step.label, kind: 'answer' });
          }
        } else if (step.nextStageId) {
          stageHasExplicitOut.add(stage.id);
          push({ from: stage.id, to: step.nextStageId, label: step.label, kind: 'direct' });
        }
      }
    }
  }

  // Progressão sequencial para fases sem saída explícita configurada.
  for (let i = 0; i < graph.stages.length - 1; i++) {
    const cur = graph.stages[i];
    if (stageHasExplicitOut.has(cur.id)) continue;
    push({ from: cur.id, to: graph.stages[i + 1].id, label: '', kind: 'sequential' });
  }

  return edges;
}

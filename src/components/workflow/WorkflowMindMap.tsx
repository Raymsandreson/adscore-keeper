import { useMemo } from 'react';
import { sameNodeRef, type WorkflowGraph, type WorkflowNodeRef } from '@/hooks/useWorkflowGraph';

/**
 * Mapa mental: árvore horizontal (left-to-right) com curvas.
 *   raiz (fluxo) → fases → objetivos → passos → [itens de checklist]
 * Layout "tidy tree": cada folha ocupa uma linha; nós-pais centralizam sobre
 * os filhos. Passos com checklist mostram um indicador clicável que expande os
 * itens (nível 4). Em modo edição, clicar num nó o seleciona. SVG puro.
 */

const ROW_H = 30;
const COL = [40, 250, 470, 720, 1000]; // raiz, fase, objetivo, passo, item de checklist
const TOP = 24;

type Level = 0 | 1 | 2 | 3 | 4;

interface LaidNode {
  id: string;
  label: string;
  level: Level;
  x: number;
  y: number;
  color: string;
  parentX?: number;
  parentY?: number;
  ref?: WorkflowNodeRef;
  hasChecklist?: boolean;
  checklistCount?: number;
  checklistOpen?: boolean;
  stepId?: string;
}

interface Props {
  graph: WorkflowGraph;
  expandedChecklists: Set<string>;
  onToggleChecklist: (stepId: string) => void;
  editMode?: boolean;
  selected?: WorkflowNodeRef | null;
  onSelectNode?: (ref: WorkflowNodeRef) => void;
}

export function WorkflowMindMap({
  graph,
  expandedChecklists,
  onToggleChecklist,
  editMode = false,
  selected,
  onSelectNode,
}: Props) {
  const { nodes, width, height } = useMemo(() => {
    const laid: LaidNode[] = [];
    let leafRow = 0;
    const nextLeafY = () => {
      const y = TOP + leafRow * ROW_H;
      leafRow++;
      return y;
    };
    const center = (ys: number[]) => ys.reduce((a, b) => a + b, 0) / ys.length;

    const stageNodes: LaidNode[] = [];

    for (const stage of graph.stages) {
      const objNodes: LaidNode[] = [];

      for (const obj of stage.objectives) {
        const stepNodes: LaidNode[] = [];
        for (const step of obj.steps) {
          const hasChecklist = !!step.docChecklist?.length;
          const open = hasChecklist && expandedChecklists.has(step.id);

          // Itens de checklist (nível 4) quando expandido.
          const itemNodes: LaidNode[] = [];
          if (open) {
            for (const item of step.docChecklist!) {
              const inode: LaidNode = {
                id: `${step.id}:${item.id}`, label: item.label, level: 4,
                x: COL[4], y: nextLeafY(), color: stage.color, parentX: COL[3],
              };
              laid.push(inode);
              itemNodes.push(inode);
            }
          }

          const stepY = itemNodes.length ? center(itemNodes.map(i => i.y)) : nextLeafY();
          const stepNode: LaidNode = {
            id: step.id, label: step.label, level: 3, x: COL[3], y: stepY,
            color: stage.color, parentX: COL[2],
            ref: { kind: 'step', stageId: stage.id, templateId: obj.templateId, stepId: step.id },
            hasChecklist, checklistCount: step.docChecklist?.length || 0, checklistOpen: open,
            stepId: step.id,
          };
          laid.push(stepNode);
          stepNodes.push(stepNode);
          itemNodes.forEach(i => { i.parentY = stepY; });
        }

        const objY = stepNodes.length ? center(stepNodes.map(s => s.y)) : nextLeafY();
        const objNode: LaidNode = {
          id: obj.templateId, label: obj.name, level: 2, x: COL[2], y: objY,
          color: stage.color, parentX: COL[1],
          ref: { kind: 'objective', stageId: stage.id, templateId: obj.templateId },
        };
        laid.push(objNode);
        objNodes.push(objNode);
        stepNodes.forEach(s => { s.parentY = objY; });
      }

      const stageY = objNodes.length ? center(objNodes.map(o => o.y)) : nextLeafY();
      const stageNode: LaidNode = {
        id: stage.id, label: stage.name, level: 1, x: COL[1], y: stageY,
        color: stage.color, ref: { kind: 'stage', stageId: stage.id },
      };
      laid.push(stageNode);
      stageNodes.push(stageNode);
      objNodes.forEach(o => { o.parentY = stageY; });
    }

    const rootY = stageNodes.length ? center(stageNodes.map(s => s.y)) : TOP;
    laid.push({ id: '__root__', label: graph.boardName, level: 0, x: COL[0], y: rootY, color: '#3b82f6' });
    stageNodes.forEach(s => { s.parentY = rootY; });

    const anyOpen = laid.some(n => n.level === 4);
    const height = Math.max(TOP + leafRow * ROW_H + TOP, rootY + ROW_H);
    const width = (anyOpen ? COL[4] + 240 : COL[3] + 260);
    return { nodes: laid, width, height };
  }, [graph, expandedChecklists]);

  if (graph.stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-16">
        Este fluxo ainda não tem fases configuradas.
      </div>
    );
  }

  const rootNode = nodes.find(n => n.level === 0)!;

  const chipW = (level: number, label: string) => {
    const base = level === 0 ? 150 : level === 1 ? 180 : level === 2 ? 200 : level === 3 ? 230 : 200;
    return Math.min(base, 40 + label.length * 7);
  };
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="max-w-none"
      role="img"
      aria-label={`Mapa mental de ${graph.boardName}`}
    >
      {/* Curvas de ligação */}
      {nodes.map(n => {
        if (n.level === 0 || n.parentY === undefined) return null;
        const x1 = n.level === 1 ? rootNode.x : (n.parentX ?? rootNode.x);
        const y1 = n.parentY;
        const x2 = n.x - chipW(n.level, n.label) / 2 - 2;
        const y2 = n.y;
        const midX = (x1 + x2) / 2;
        const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        return (
          <path
            key={`edge-${n.level}-${n.id}`}
            d={d}
            fill="none"
            stroke={n.color}
            strokeOpacity={n.level === 4 ? 0.3 : 0.45}
            strokeWidth={n.level === 1 ? 2.5 : n.level === 2 ? 1.8 : 1.2}
            strokeDasharray={n.level === 4 ? '4 3' : undefined}
          />
        );
      })}

      {/* Nós */}
      {nodes.map(n => {
        const w = chipW(n.level, n.label);
        const h = 24;
        const isRoot = n.level === 0;
        const maxChars = Math.floor((w - 20) / 7);
        const isSelected = editMode && sameNodeRef(selected, n.ref);
        const selectable = editMode && !!n.ref;

        return (
          <g
            key={`node-${n.level}-${n.id}`}
            className={selectable ? 'cursor-pointer' : undefined}
            onClick={selectable ? () => onSelectNode?.(n.ref!) : undefined}
          >
            <rect
              x={n.x - w / 2}
              y={n.y - h / 2}
              width={w}
              height={h}
              rx={12}
              fill={n.level <= 1 ? n.color : undefined}
              className={n.level >= 2 ? 'fill-card' : ''}
              stroke={n.level >= 2 ? n.color : (isSelected ? '#0ea5e9' : 'transparent')}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            {isSelected && (
              <rect
                x={n.x - w / 2 - 2}
                y={n.y - h / 2 - 2}
                width={w + 4}
                height={h + 4}
                rx={14}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={2}
              />
            )}
            {n.level >= 2 && (
              <rect x={n.x - w / 2} y={n.y - h / 2} width={4} height={h} rx={2} fill={n.color} />
            )}
            <text
              x={n.x + (n.level >= 2 ? 2 : 0)}
              y={n.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={
                n.level <= 1
                  ? 'text-[12px] font-semibold'
                  : n.level === 2
                  ? 'fill-foreground text-[11px] font-medium'
                  : n.level === 3
                  ? 'fill-foreground text-[10px]'
                  : 'fill-muted-foreground text-[10px]'
              }
              fill={n.level <= 1 ? '#fff' : undefined}
            >
              {truncate(n.label, Math.max(6, maxChars))}
            </text>

            {/* Indicador de checklist clicável (expande/colapsa itens) */}
            {n.hasChecklist && (
              <g
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onToggleChecklist(n.stepId!); }}
              >
                <rect
                  x={n.x + w / 2 + 4}
                  y={n.y - 9}
                  width={34}
                  height={18}
                  rx={9}
                  className="fill-orange-100 dark:fill-orange-900/30 stroke-orange-400"
                  strokeWidth={1}
                />
                <text
                  x={n.x + w / 2 + 4 + 17}
                  y={n.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-orange-600 dark:fill-orange-400 text-[9px] font-bold"
                >
                  {n.checklistOpen ? '▾' : '▸'}{n.checklistCount}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

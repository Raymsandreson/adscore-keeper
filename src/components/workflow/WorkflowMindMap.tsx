import { useMemo } from 'react';
import type { WorkflowGraph } from '@/hooks/useWorkflowGraph';

/**
 * Mapa mental: árvore horizontal (left-to-right) com curvas.
 *   raiz (fluxo) → fases → objetivos → passos
 * Layout "tidy tree": cada folha (passo) ocupa uma linha; nós-pais são
 * centralizados verticalmente sobre seus filhos.  SVG puro, determinístico.
 */

const ROW_H = 30;      // altura por folha
const COL = [40, 250, 470, 720]; // x de cada nível: raiz, fase, objetivo, passo
const TOP = 24;

interface LaidNode {
  id: string;
  label: string;
  level: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  color: string;
  parentY?: number;
  parentX?: number;
}

interface Props {
  graph: WorkflowGraph;
}

export function WorkflowMindMap({ graph }: Props) {
  const { nodes, width, height } = useMemo(() => {
    const laid: LaidNode[] = [];
    let leafRow = 0;

    // Centro de um conjunto de filhos = média dos seus centros; se vazio,
    // consome uma linha própria para não colapsar.
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
          const node: LaidNode = {
            id: step.id, label: step.label, level: 3, x: COL[3],
            y: nextLeafY(), color: stage.color, parentX: COL[2],
          };
          laid.push(node);
          stepNodes.push(node);
        }

        const objY = stepNodes.length ? center(stepNodes.map(s => s.y)) : nextLeafY();
        const objNode: LaidNode = {
          id: obj.templateId, label: obj.name, level: 2, x: COL[2],
          y: objY, color: stage.color, parentX: COL[1],
        };
        laid.push(objNode);
        objNodes.push(objNode);
        stepNodes.forEach(s => { s.parentY = objY; });
      }

      const stageY = objNodes.length ? center(objNodes.map(o => o.y)) : nextLeafY();
      const stageNode: LaidNode = {
        id: stage.id, label: stage.name, level: 1, x: COL[1],
        y: stageY, color: stage.color,
      };
      laid.push(stageNode);
      stageNodes.push(stageNode);
      objNodes.forEach(o => { o.parentY = stageY; });
    }

    const rootY = stageNodes.length ? center(stageNodes.map(s => s.y)) : TOP;
    laid.push({ id: '__root__', label: graph.boardName, level: 0, x: COL[0], y: rootY, color: '#3b82f6' });
    stageNodes.forEach(s => { s.parentY = rootY; });

    const height = Math.max(TOP + leafRow * ROW_H + TOP, rootY + ROW_H);
    const width = COL[3] + 260;
    return { nodes: laid, width, height };
  }, [graph]);

  if (graph.stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-16">
        Este fluxo ainda não tem fases configuradas.
      </div>
    );
  }

  const nodeById = (id: string, level: number) => nodes.find(n => n.id === id && n.level === level);
  const rootNode = nodeById('__root__', 0)!;

  // largura de rótulo por nível (chip)
  const chipW = (level: number, label: string) => {
    const base = level === 0 ? 150 : level === 1 ? 180 : level === 2 ? 200 : 230;
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
      {/* Curvas de ligação (desenha antes dos nós). x1 = centro da coluna-pai,
          x2 = borda esquerda do chip do nó. Uniforme para todos os níveis. */}
      {nodes.map(n => {
        if (n.level === 0 || n.parentY === undefined) return null;
        const parentColX = n.level === 1 ? rootNode.x : (n.parentX ?? rootNode.x);
        const x1 = parentColX;
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
            strokeOpacity={0.45}
            strokeWidth={n.level === 1 ? 2.5 : n.level === 2 ? 1.8 : 1.2}
          />
        );
      })}

      {/* Nós */}
      {nodes.map(n => {
        const w = chipW(n.level, n.label);
        const h = 24;
        const isRoot = n.level === 0;
        const maxChars = Math.floor((w - 20) / 7);
        return (
          <g key={`node-${n.level}-${n.id}`}>
            <rect
              x={n.x - w / 2}
              y={n.y - h / 2}
              width={w}
              height={h}
              rx={12}
              fill={
                isRoot
                  ? n.color
                  : n.level === 1
                  ? n.color
                  : 'var(--card, #fff)'
              }
              fillOpacity={n.level >= 2 ? 1 : 1}
              className={n.level >= 2 ? 'fill-card stroke-border' : ''}
              stroke={n.level >= 2 ? undefined : n.color}
              strokeWidth={1.5}
            />
            {n.level >= 2 && (
              <rect
                x={n.x - w / 2}
                y={n.y - h / 2}
                width={4}
                height={h}
                rx={2}
                fill={n.color}
              />
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
                  : 'fill-muted-foreground text-[10px]'
              }
              fill={n.level <= 1 ? '#fff' : undefined}
            >
              {truncate(n.label, Math.max(6, maxChars))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

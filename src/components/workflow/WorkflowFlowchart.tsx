import { useMemo } from 'react';
import { CheckCircle2, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildWorkflowEdges,
  FINALIZE_ID,
  type WorkflowGraph,
} from '@/hooks/useWorkflowGraph';

/**
 * Fluxograma vertical (spine): fases como caixas de cima para baixo na ordem
 * configurada.  A progressão sequencial é a coluna central; transições
 * condicionais (respostas / "mover para" que pulam ou voltam fases) e a
 * finalização são desenhadas como setas curvas na calha da direita.
 *
 * SVG puro — sem dependências novas.
 */

const NODE_W = 300;
const NODE_H = 84;
const V_GAP = 56; // espaço vertical entre caixas
const TOP = 24;
const LEFT = 24;
const GUTTER = 150; // calha à direita para arestas condicionais

interface Props {
  graph: WorkflowGraph;
}

export function WorkflowFlowchart({ graph }: Props) {
  const edges = useMemo(() => buildWorkflowEdges(graph), [graph]);

  const layout = useMemo(() => {
    const stageY = new Map<string, number>();
    graph.stages.forEach((s, i) => {
      stageY.set(s.id, TOP + i * (NODE_H + V_GAP));
    });

    const hasFinalize = edges.some(e => e.to === FINALIZE_ID);
    const finalizeY = hasFinalize ? TOP + graph.stages.length * (NODE_H + V_GAP) : null;

    const width = LEFT + NODE_W + GUTTER + 24;
    const height =
      (finalizeY ?? TOP + (graph.stages.length - 1) * (NODE_H + V_GAP)) + NODE_H + TOP;

    return { stageY, finalizeY, width, height, hasFinalize };
  }, [graph, edges]);

  const centerX = LEFT + NODE_W / 2;
  const rightX = LEFT + NODE_W;

  // Índice de cada fase p/ decidir se a aresta é "para frente" curta (spine) ou desvio.
  const stageIndex = useMemo(() => {
    const m = new Map<string, number>();
    graph.stages.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [graph]);

  // Desvios entre fases (calha direita) — exclui sequencial, a próxima fase
  // imediata (já é a spine) e finalizações (têm conector dedicado ao terminal).
  const conditionalEdges = edges.filter(e => {
    if (e.kind === 'sequential') return false;
    if (e.to === FINALIZE_ID) return false;
    const from = stageIndex.get(e.from);
    const to = stageIndex.get(e.to);
    if (from !== undefined && to !== undefined && to === from + 1) return false;
    return true;
  });

  // Fases que finalizam o fluxo (aresta para o terminal).
  const finalizeSources = [...new Set(edges.filter(e => e.to === FINALIZE_ID).map(e => e.from))];

  const getY = (id: string) => layout.stageY.get(id) ?? 0;

  if (graph.stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-16">
        Este fluxo ainda não tem fases configuradas.
      </div>
    );
  }

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="max-w-none"
      role="img"
      aria-label={`Fluxograma de ${graph.boardName}`}
    >
      <defs>
        <marker
          id="fc-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
        </marker>
        <marker
          id="fc-arrow-cond"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
        </marker>
      </defs>

      {/* Spine: setas sequenciais entre caixas consecutivas */}
      {graph.stages.map((s, i) => {
        if (i === graph.stages.length - 1) return null;
        const y1 = (layout.stageY.get(s.id) ?? 0) + NODE_H;
        const y2 = (layout.stageY.get(graph.stages[i + 1].id) ?? 0);
        return (
          <line
            key={`spine-${s.id}`}
            x1={centerX}
            y1={y1}
            x2={centerX}
            y2={y2 - 2}
            className="stroke-muted-foreground"
            strokeWidth={2}
            markerEnd="url(#fc-arrow)"
          />
        );
      })}

      {/* Conectores das fases que finalizam o fluxo → nó terminal.
          Última fase: reta pelo centro. Fase do meio: curva pela calha direita
          até a lateral do terminal (evita cruzar as caixas). */}
      {layout.hasFinalize && finalizeSources.map((srcId, idx) => {
        const lastId = graph.stages[graph.stages.length - 1].id;
        const targetTop = layout.finalizeY ?? 0;
        if (srcId === lastId) {
          const y1 = getY(srcId) + NODE_H;
          const d = `M ${centerX} ${y1} C ${centerX} ${y1 + 24}, ${centerX} ${targetTop - 24}, ${centerX} ${targetTop - 2}`;
          return (
            <path key={`fin-${srcId}`} d={d} fill="none" className="stroke-green-500" strokeWidth={2} markerEnd="url(#fc-arrow)" />
          );
        }
        const y1 = getY(srcId) + NODE_H / 2;
        const termRightX = centerX + 80;
        const termMidY = targetTop + (NODE_H - 24) / 2;
        const bend = rightX + 40 + (idx % 3) * 34;
        const d = `M ${rightX} ${y1} C ${bend} ${y1}, ${bend} ${termMidY}, ${termRightX} ${termMidY}`;
        return (
          <path key={`fin-${srcId}`} d={d} fill="none" className="stroke-green-500" strokeWidth={1.75} strokeDasharray="5 3" markerEnd="url(#fc-arrow)" />
        );
      })}

      {/* Arestas condicionais (desvios / respostas) na calha direita */}
      {conditionalEdges.map((e, idx) => {
        const y1 = getY(e.from) + NODE_H / 2;
        const y2 = getY(e.to) + NODE_H / 2;
        const bend = rightX + 40 + (idx % 3) * 34; // dispersa curvas p/ não sobrepor
        const midY = (y1 + y2) / 2;
        const d = `M ${rightX} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${rightX} ${y2}`;
        return (
          <g key={`cond-${idx}`}>
            <path
              d={d}
              fill="none"
              className="stroke-primary/70"
              strokeWidth={1.75}
              strokeDasharray="5 3"
              markerEnd="url(#fc-arrow-cond)"
            />
            {e.label && (
              <text
                x={bend + 4}
                y={midY}
                className="fill-primary text-[10px]"
                dominantBaseline="middle"
              >
                {e.label.length > 22 ? e.label.slice(0, 21) + '…' : e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Caixas das fases */}
      {graph.stages.map((stage, i) => {
        const y = layout.stageY.get(stage.id) ?? 0;
        const stepCount = stage.objectives.reduce((s, o) => s + o.steps.length, 0);
        return (
          <g key={stage.id}>
            <rect
              x={LEFT}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={12}
              className="fill-card stroke-border"
              strokeWidth={1.5}
            />
            {/* faixa de cor da fase */}
            <rect x={LEFT} y={y} width={6} height={NODE_H} rx={3} fill={stage.color} />
            <circle cx={LEFT + 26} cy={y + 24} r={11} fill={stage.color} opacity={0.18} />
            <text
              x={LEFT + 26}
              y={y + 24}
              textAnchor="middle"
              dominantBaseline="central"
              className="text-[11px] font-bold"
              fill={stage.color}
            >
              {i + 1}
            </text>
            <text
              x={LEFT + 46}
              y={y + 26}
              className="fill-foreground text-[14px] font-semibold"
            >
              {stage.name.length > 26 ? stage.name.slice(0, 25) + '…' : stage.name}
            </text>
            <text x={LEFT + 46} y={y + 50} className="fill-muted-foreground text-[11px]">
              {stage.objectives.length} objetivo(s) · {stepCount} passo(s)
            </text>
            {/* chips de objetivos (até 3) */}
            <text x={LEFT + 46} y={y + 68} className="fill-muted-foreground/80 text-[10px]">
              {stage.objectives.slice(0, 3).map(o => o.name).join(' • ').slice(0, 46) ||
                'sem objetivos'}
              {stage.objectives.length > 3 ? ' …' : ''}
            </text>
          </g>
        );
      })}

      {/* Nó Finalizar */}
      {layout.hasFinalize && (
        <g>
          <rect
            x={centerX - 80}
            y={layout.finalizeY ?? 0}
            width={160}
            height={NODE_H - 24}
            rx={30}
            className="fill-green-500/10 stroke-green-500"
            strokeWidth={1.5}
          />
          <text
            x={centerX}
            y={(layout.finalizeY ?? 0) + (NODE_H - 24) / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-green-600 dark:fill-green-400 text-[13px] font-semibold"
          >
            ✓ Finalizar
          </text>
        </g>
      )}
    </svg>
  );
}

/** Legenda compacta reutilizada pelo dialog. */
export function FlowchartLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground', className)}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 border-t-2 border-muted-foreground" /> Progressão
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-6 border-t-2 border-dashed border-primary" /> Condicional / resposta
      </span>
      <span className="flex items-center gap-1.5">
        <Flag className="h-3 w-3 text-green-500" /> Terminal
      </span>
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="h-3 w-3" /> Fase do fluxo
      </span>
    </div>
  );
}

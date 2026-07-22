import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  GitBranch,
  Network,
  ZoomIn,
  ZoomOut,
  Maximize,
  Loader2,
} from 'lucide-react';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import { useWorkflowGraph } from '@/hooks/useWorkflowGraph';
import { WorkflowFlowchart, FlowchartLegend } from './WorkflowFlowchart';
import { WorkflowMindMap } from './WorkflowMindMap';

interface Props {
  board: KanbanBoard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;

/**
 * Dialog de visualização do fluxo/funil em dois formatos:
 *   • Fluxograma — sequência de fases com ramificações condicionais
 *   • Mapa mental — árvore fase → objetivo → passo
 * Ambos em SVG puro, com zoom e scroll.
 */
export function WorkflowVisualizationDialog({ board, open, onOpenChange }: Props) {
  const { data: graph, isLoading, error } = useWorkflowGraph(board, open);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<'flowchart' | 'mindmap'>('flowchart');

  const zoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  const typeLabel = board?.board_type === 'workflow' ? 'Fluxo de Trabalho' : 'Funil de Vendas';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" />
            Visualização — {board?.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {typeLabel} · fluxograma e mapa mental das fases, objetivos e passos.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={view} onValueChange={v => setView(v as typeof view)} className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 px-5 py-2 border-b flex-wrap">
            <TabsList className="h-8">
              <TabsTrigger value="flowchart" className="text-xs gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                Fluxograma
              </TabsTrigger>
              <TabsTrigger value="mindmap" className="text-xs gap-1.5">
                <Network className="h-3.5 w-3.5" />
                Mapa Mental
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut} title="Diminuir zoom">
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11px] text-muted-foreground w-10 text-center tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn} title="Aumentar zoom">
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomReset} title="Zoom 100%">
                <Maximize className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-muted/20 [background-image:radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando estrutura do fluxo…
              </div>
            ) : error ? (
              <div className="h-full flex items-center justify-center text-destructive text-sm">
                Erro ao carregar a estrutura do fluxo.
              </div>
            ) : graph ? (
              <div
                className="p-6 origin-top-left transition-transform"
                style={{ transform: `scale(${zoom})`, width: 'max-content' }}
              >
                <TabsContent value="flowchart" className="mt-0">
                  <WorkflowFlowchart graph={graph} />
                </TabsContent>
                <TabsContent value="mindmap" className="mt-0">
                  <WorkflowMindMap graph={graph} />
                </TabsContent>
              </div>
            ) : null}
          </div>

          {view === 'flowchart' && graph && (
            <div className="px-5 py-2 border-t">
              <FlowchartLegend />
            </div>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

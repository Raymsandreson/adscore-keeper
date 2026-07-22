import { useState, useCallback, useEffect } from 'react';
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
  ListTree,
  ZoomIn,
  ZoomOut,
  Maximize,
  Loader2,
  Pencil,
  MousePointerClick,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import { useWorkflowGraph, type WorkflowNodeRef } from '@/hooks/useWorkflowGraph';
import { WorkflowFlowchart, FlowchartLegend } from './WorkflowFlowchart';
import { WorkflowMindMap } from './WorkflowMindMap';
import { WorkflowDetails } from './WorkflowDetails';
import { WorkflowNodeEditor } from './WorkflowNodeEditor';

interface Props {
  board: KanbanBoard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando fornecido, exibe o botão que abre o editor completo do fluxo. */
  onEdit?: () => void;
}

type View = 'flowchart' | 'mindmap' | 'details';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;

/**
 * Dialog de visualização do fluxo/funil:
 *   • Fluxograma — sequência de fases com ramificações condicionais
 *   • Mapa mental — árvore fase → objetivo → passo; checklist expansível no nó
 *     e edição rápida in-loco (renomear, mover/finalizar, add/remover passo)
 *   • Detalhes — checklists, tipo de atividade, mover/finalizar e respostas
 */
export function WorkflowVisualizationDialog({ board, open, onOpenChange, onEdit }: Props) {
  const { data: graph, isLoading, error } = useWorkflowGraph(board, open);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<View>('flowchart');
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<WorkflowNodeRef | null>(null);

  // Limpa estado ao fechar ou trocar de board.
  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setSelected(null);
      setExpandedChecklists(new Set());
      setZoom(1);
      setView('flowchart');
    }
  }, [open, board?.id]);

  // Painel de edição só faz sentido no mapa mental.
  useEffect(() => {
    if (view !== 'mindmap') setSelected(null);
  }, [view]);

  const zoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  const toggleChecklist = useCallback((stepId: string) => {
    setExpandedChecklists(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
      return next;
    });
  }, []);

  const typeLabel = board?.board_type === 'workflow' ? 'Fluxo de Trabalho' : 'Funil de Vendas';
  const isCanvas = view === 'flowchart' || view === 'mindmap';

  const handleFullEditor = () => {
    onOpenChange(false);
    onEdit?.();
  };

  const showEditorPanel = view === 'mindmap' && editMode && !!selected && !!graph;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" />
            Visualização — {board?.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {typeLabel} · fluxograma, mapa mental e detalhes das fases, objetivos e passos.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={view} onValueChange={v => setView(v as View)} className="flex-1 flex flex-col min-h-0">
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
              <TabsTrigger value="details" className="text-xs gap-1.5">
                <ListTree className="h-3.5 w-3.5" />
                Detalhes
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              {view === 'mindmap' && (
                <Button
                  size="sm"
                  variant={editMode ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => { setEditMode(e => !e); setSelected(null); }}
                  title="Selecionar nós para editar direto no mapa"
                >
                  <MousePointerClick className="h-3.5 w-3.5 mr-1.5" />
                  {editMode ? 'Editando no mapa' : 'Editar no mapa'}
                </Button>
              )}
              {isCanvas && (
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
              )}
              {onEdit && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleFullEditor}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editor completo
                </Button>
              )}
            </div>
          </div>

          {view === 'mindmap' && editMode && (
            <div className="px-5 py-1.5 border-b bg-primary/5 text-[11px] text-primary flex items-center gap-1.5">
              <MousePointerClick className="h-3 w-3" />
              Clique em uma fase, objetivo ou passo para editar. Clique no selo laranja para abrir/fechar o checklist.
            </div>
          )}

          <div className="flex-1 min-h-0 flex">
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
                <>
                  {isCanvas && (
                    <div
                      className="p-6 origin-top-left transition-transform"
                      style={{ transform: `scale(${zoom})`, width: 'max-content' }}
                    >
                      <TabsContent value="flowchart" className="mt-0">
                        <WorkflowFlowchart graph={graph} />
                      </TabsContent>
                      <TabsContent value="mindmap" className="mt-0">
                        <WorkflowMindMap
                          graph={graph}
                          expandedChecklists={expandedChecklists}
                          onToggleChecklist={toggleChecklist}
                          editMode={editMode}
                          selected={selected}
                          onSelectNode={setSelected}
                        />
                      </TabsContent>
                    </div>
                  )}
                  <TabsContent value="details" className="mt-0 p-5">
                    <WorkflowDetails graph={graph} />
                  </TabsContent>
                </>
              ) : null}
            </div>

            {showEditorPanel && board && (
              <WorkflowNodeEditor
                board={board}
                graph={graph!}
                selected={selected!}
                onClose={() => setSelected(null)}
                onOpenFullEditor={handleFullEditor}
              />
            )}
          </div>

          {view === 'flowchart' && graph && (
            <div className={cn('px-5 py-2 border-t')}>
              <FlowchartLegend />
            </div>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

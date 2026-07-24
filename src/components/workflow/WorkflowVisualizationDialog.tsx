import { useState, useCallback, useEffect, useRef } from 'react';
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
  Minimize,
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

  // Tela cheia real (Fullscreen API) sobre o próprio conteúdo do dialog.
  const contentRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // "Mãozinha": arrastar o canvas para movê-lo (fluxograma e mapa mental).
  const scrollRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const onPanStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // só botão esquerdo
    const el = scrollRef.current;
    if (!el) return;
    panState.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    setIsPanning(true);
  }, []);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      const p = panState.current;
      if (!el || !p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) p.moved = true;
      el.scrollLeft = p.left - dx;
      el.scrollTop = p.top - dy;
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  // Se houve arrasto, cancela o clique que selecionaria um nó no modo edição.
  const onCanvasClickCapture = useCallback((e: React.MouseEvent) => {
    if (panState.current?.moved) {
      e.stopPropagation();
      panState.current.moved = false;
    }
  }, []);

  // Limpa estado ao fechar ou trocar de board.
  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setSelected(null);
      setExpandedChecklists(new Set());
      setZoom(1);
      setView('flowchart');
      if (document.fullscreenElement) document.exitFullscreen?.();
    }
  }, [open, board?.id]);

  // Painel de edição só faz sentido no mapa mental.
  useEffect(() => {
    if (view !== 'mindmap') setSelected(null);
  }, [view]);

  const zoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Entra/sai de tela cheia usando o elemento do dialog (mesmo padrão do telão).
  const toggleFullscreen = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()?.catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // Sincroniza o estado com o browser (cobre saída via tecla Esc).
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === contentRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleChecklist = useCallback((stepId: string) => {
    setExpandedChecklists(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
      return next;
    });
  }, []);

  const typeLabel = board?.board_type === 'workflow' ? 'POP' : 'Funil de Vendas';
  const isCanvas = view === 'flowchart' || view === 'mindmap';

  const handleFullEditor = () => {
    onOpenChange(false);
    onEdit?.();
  };

  const showEditorPanel = view === 'mindmap' && editMode && !!selected && !!graph;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className={cn(
          'max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0',
          isFullscreen &&
            '!max-w-none !w-screen !h-screen !left-0 !top-0 !translate-x-0 !translate-y-0 !rounded-none',
        )}
      >
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
                  <button
                    type="button"
                    onClick={zoomReset}
                    title="Voltar o zoom para 100%"
                    className="text-[11px] text-muted-foreground w-10 text-center tabular-nums hover:text-foreground transition-colors"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn} title="Aumentar zoom">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                  >
                    {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
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
            <div
              ref={scrollRef}
              onMouseDown={isCanvas ? onPanStart : undefined}
              onClickCapture={isCanvas ? onCanvasClickCapture : undefined}
              className={cn(
                'flex-1 min-h-0 overflow-auto bg-muted/20 [background-image:radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]',
                isCanvas && (isPanning ? 'cursor-grabbing select-none' : 'cursor-grab'),
              )}
            >
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

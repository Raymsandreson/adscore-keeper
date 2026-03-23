import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { CheckCircle2, Circle, ChevronRight, ArrowRight, SkipForward, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { KanbanStage } from '@/hooks/useKanbanBoards';
import { cn } from '@/lib/utils';

interface WorkflowBoard {
  id: string;
  name: string;
  stages: KanbanStage[];
}

interface CaseWorkflowBoardProps {
  caseId: string;
  processes: any[];
  onProcessUpdated: () => void;
}

export function CaseWorkflowBoard({ caseId, processes, onProcessUpdated }: CaseWorkflowBoardProps) {
  const [workflowBoards, setWorkflowBoards] = useState<WorkflowBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWorkflowBoards = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('kanban_boards')
        .select('id, name, stages')
        .eq('board_type', 'workflow')
        .order('display_order');
      if (error) throw error;
      const parsed = (data || []).map(b => ({
        ...b,
        stages: (b.stages as unknown as KanbanStage[]) || [],
      }));
      setWorkflowBoards(parsed);

      // Check if case already has a workflow_board_id
      const { data: caseData } = await supabase
        .from('legal_cases')
        .select('workflow_board_id')
        .eq('id', caseId)
        .maybeSingle();
      
      if (caseData?.workflow_board_id) {
        setSelectedBoardId(caseData.workflow_board_id);
      } else if (parsed.length === 1) {
        // Auto-select if only one workflow board
        setSelectedBoardId(parsed[0].id);
      }
    } catch (err) {
      console.error('Error fetching workflow boards:', err);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchWorkflowBoards();
  }, [fetchWorkflowBoards]);

  const handleSelectBoard = async (boardId: string) => {
    setSelectedBoardId(boardId);
    await supabase
      .from('legal_cases')
      .update({ workflow_board_id: boardId })
      .eq('id', caseId);
  };

  const selectedBoard = workflowBoards.find(b => b.id === selectedBoardId);

  const handleMoveProcess = async (processId: string, newStageId: string) => {
    try {
      const { error } = await supabase
        .from('lead_processes')
        .update({ workflow_stage_id: newStageId } as any)
        .eq('id', processId);
      if (error) throw error;
      toast.success('Processo movido de fase');
      onProcessUpdated();
    } catch {
      toast.error('Erro ao mover processo');
    }
  };

  if (loading) return null;

  if (workflowBoards.length === 0) {
    return (
      <div className="text-center py-4 text-xs text-muted-foreground">
        <Workflow className="h-5 w-5 mx-auto mb-1 opacity-40" />
        Nenhum quadro do tipo "Fluxo de Trabalho" configurado.
        <br />
        <span className="text-[10px]">Crie um quadro com tipo "workflow" nas configurações do Kanban.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Workflow className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-semibold">Fluxo de Trabalho</h4>
        {workflowBoards.length > 1 && (
          <Select value={selectedBoardId || ''} onValueChange={handleSelectBoard}>
            <SelectTrigger className="h-7 text-xs w-[180px]">
              <SelectValue placeholder="Selecionar fluxo" />
            </SelectTrigger>
            <SelectContent>
              {workflowBoards.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {workflowBoards.length === 1 && (
          <span className="text-xs text-muted-foreground">{workflowBoards[0].name}</span>
        )}
      </div>

      {selectedBoard && (
        <WorkflowStagesView
          stages={selectedBoard.stages}
          processes={processes}
          onMoveProcess={handleMoveProcess}
        />
      )}
    </div>
  );
}

function WorkflowStagesView({
  stages,
  processes,
  onMoveProcess,
}: {
  stages: KanbanStage[];
  processes: any[];
  onMoveProcess: (processId: string, stageId: string) => void;
}) {
  // Map processes to their current stage
  const getProcessStageIndex = (process: any): number => {
    if (!process.workflow_stage_id) return 0; // Default to first stage
    const idx = stages.findIndex(s => s.id === process.workflow_stage_id);
    return idx >= 0 ? idx : 0;
  };

  if (processes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3">
        Nenhum processo neste caso para acompanhar.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {processes.map(process => {
        const currentIdx = getProcessStageIndex(process);
        return (
          <ProcessWorkflowTrack
            key={process.id}
            process={process}
            stages={stages}
            currentStageIndex={currentIdx}
            onMoveProcess={onMoveProcess}
          />
        );
      })}
    </div>
  );
}

function ProcessWorkflowTrack({
  process,
  stages,
  currentStageIndex,
  onMoveProcess,
}: {
  process: any;
  stages: KanbanStage[];
  currentStageIndex: number;
  onMoveProcess: (processId: string, stageId: string) => void;
}) {
  const canAdvance = currentStageIndex < stages.length - 1;
  const currentStage = stages[currentStageIndex];

  return (
    <div className="border rounded-lg p-3 bg-card space-y-2">
      {/* Process info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium truncate">{process.title}</span>
          {process.process_number && (
            <span className="text-[10px] text-muted-foreground">Nº {process.process_number}</span>
          )}
        </div>
        <Badge
          variant="secondary"
          className="text-[10px] shrink-0"
          style={{ backgroundColor: currentStage?.color + '20', color: currentStage?.color }}
        >
          {currentStage?.name || 'Início'}
        </Badge>
      </div>

      {/* Stage progress bar */}
      <ScrollArea className="w-full">
        <div className="flex items-center gap-1 py-1">
          {stages.map((stage, idx) => {
            const isCompleted = idx < currentStageIndex;
            const isCurrent = idx === currentStageIndex;
            const isFuture = idx > currentStageIndex;

            return (
              <div key={stage.id} className="flex items-center">
                <button
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap",
                    isCompleted && "bg-primary/10 text-primary cursor-default",
                    isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                    isFuture && "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                  )}
                  onClick={() => {
                    if (isFuture || isCompleted) {
                      onMoveProcess(process.id, stage.id);
                    }
                  }}
                  title={isFuture ? `Pular para: ${stage.name}` : isCompleted ? `Voltar para: ${stage.name}` : `Fase atual`}
                >
                  {isCompleted && <CheckCircle2 className="h-3 w-3" />}
                  {isCurrent && <Circle className="h-3 w-3 fill-current" />}
                  {isFuture && <Circle className="h-3 w-3" />}
                  {stage.name}
                </button>
                {idx < stages.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Quick advance button */}
      {canAdvance && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 text-primary"
            onClick={() => onMoveProcess(process.id, stages[currentStageIndex + 1].id)}
          >
            <ArrowRight className="h-3 w-3" />
            Avançar para {stages[currentStageIndex + 1].name}
          </Button>
        </div>
      )}
    </div>
  );
}

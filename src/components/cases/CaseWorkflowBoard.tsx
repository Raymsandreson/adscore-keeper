import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, Circle, ChevronRight, ArrowRight, Workflow, ListChecks, MessageSquareText, ClipboardList, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { KanbanStage } from '@/hooks/useKanbanBoards';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface WorkflowBoard {
  id: string;
  name: string;
  stages: KanbanStage[];
}

interface ChecklistItemData {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  script?: string;
  docChecklist?: { id: string; label: string; checked?: boolean; type?: string }[];
}

interface ChecklistInstance {
  id: string;
  checklist_template_id: string;
  stage_id: string;
  items: ChecklistItemData[];
  is_completed: boolean;
  is_readonly: boolean;
  template_name?: string;
  stage_name?: string;
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

      const { data: caseData } = await supabase
        .from('legal_cases')
        .select('workflow_board_id')
        .eq('id', caseId)
        .maybeSingle();
      
      if (caseData?.workflow_board_id) {
        setSelectedBoardId(caseData.workflow_board_id);
      } else if (parsed.length === 1) {
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
          <Select value={selectedBoardId || undefined} onValueChange={handleSelectBoard}>
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
          board={selectedBoard}
          stages={selectedBoard.stages}
          processes={processes}
          onMoveProcess={handleMoveProcess}
        />
      )}
    </div>
  );
}

function WorkflowStagesView({
  board,
  stages,
  processes,
  onMoveProcess,
}: {
  board: WorkflowBoard;
  stages: KanbanStage[];
  processes: any[];
  onMoveProcess: (processId: string, stageId: string) => void;
}) {
  const getProcessStageIndex = (process: any): number => {
    if (!process.workflow_stage_id) return 0;
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
            board={board}
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
  board,
  stages,
  currentStageIndex,
  onMoveProcess,
}: {
  process: any;
  board: WorkflowBoard;
  stages: KanbanStage[];
  currentStageIndex: number;
  onMoveProcess: (processId: string, stageId: string) => void;
}) {
  const canAdvance = currentStageIndex < stages.length - 1;
  const currentStage = stages[currentStageIndex];
  const [showChecklist, setShowChecklist] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

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
        <div className="flex items-center gap-1">
          <Badge
            variant="secondary"
            className="text-[10px] shrink-0"
            style={{ backgroundColor: currentStage?.color + '20', color: currentStage?.color }}
          >
            {currentStage?.name || 'Início'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expandir' : 'Minimizar'}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !collapsed && "rotate-180")} />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
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

          {/* Checklist items for current stage */}
          <ProcessStageChecklists
            processId={process.id}
            boardId={board.id}
            stageId={currentStage?.id || ''}
            stages={stages}
            show={showChecklist}
            onToggleShow={() => setShowChecklist(!showChecklist)}
          />

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
        </>
      )}
    </div>
  );
}

function ProcessStageChecklists({
  processId,
  boardId,
  stageId,
  stages,
  show,
  onToggleShow,
}: {
  processId: string;
  boardId: string;
  stageId: string;
  stages: KanbanStage[];
  show: boolean;
  onToggleShow: () => void;
}) {
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadAndAutoCreate = useCallback(async () => {
    try {
      // 1. Fetch stage links for this board
      const { data: stageLinks } = await supabase
        .from('checklist_stage_links')
        .select('checklist_template_id, stage_id')
        .eq('board_id', boardId);

      if (!stageLinks || stageLinks.length === 0) {
        setInstances([]);
        setLoaded(true);
        return;
      }

      // 2. Fetch existing instances for this process (using process id as lead_id)
      const { data: existingInstances } = await supabase
        .from('lead_checklist_instances')
        .select('id, checklist_template_id, stage_id, items, is_completed, is_readonly')
        .eq('lead_id', processId)
        .eq('board_id', boardId);

      // 3. Find missing instances
      const existingKeys = new Set(
        (existingInstances || []).map(i => `${i.checklist_template_id}_${i.stage_id}`)
      );

      const missingLinks = stageLinks.filter(
        l => !existingKeys.has(`${l.checklist_template_id}_${l.stage_id}`)
      );

      // 4. Auto-create missing instances
      if (missingLinks.length > 0) {
        const templateIds = [...new Set(missingLinks.map(l => l.checklist_template_id))];
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('id, items')
          .in('id', templateIds);

        const templateItemsMap: Record<string, ChecklistItemData[]> = {};
        (templates || []).forEach(t => {
          templateItemsMap[t.id] = ((t.items as unknown as ChecklistItemData[]) || []).map(item => ({
            ...item,
            checked: false,
          }));
        });

        const newInstances = missingLinks
          .filter(l => templateItemsMap[l.checklist_template_id])
          .map(l => ({
            lead_id: processId,
            board_id: boardId,
            stage_id: l.stage_id,
            checklist_template_id: l.checklist_template_id,
            items: JSON.parse(JSON.stringify(templateItemsMap[l.checklist_template_id])),
            is_completed: false,
            is_readonly: false,
          }));

        if (newInstances.length > 0) {
          await supabase.from('lead_checklist_instances').insert(newInstances);
        }
      }

      // 5. Re-fetch all instances
      const { data: allInstances } = await supabase
        .from('lead_checklist_instances')
        .select('id, checklist_template_id, stage_id, items, is_completed, is_readonly')
        .eq('lead_id', processId)
        .eq('board_id', boardId)
        .order('created_at');

      if (!allInstances || allInstances.length === 0) {
        setInstances([]);
        setLoaded(true);
        return;
      }

      // 6. Fetch template names
      const templateIds = [...new Set(allInstances.map(d => d.checklist_template_id))];
      const { data: templates } = await supabase
        .from('checklist_templates')
        .select('id, name')
        .in('id', templateIds);

      const nameMap: Record<string, string> = {};
      (templates || []).forEach(t => { nameMap[t.id] = t.name; });

      // 7. Build stage name map
      const stageNameMap: Record<string, string> = {};
      stages.forEach(s => { stageNameMap[s.id] = s.name; });

      setInstances(allInstances.map(d => ({
        ...d,
        items: (d.items as unknown as ChecklistItemData[]) || [],
        template_name: nameMap[d.checklist_template_id] || 'Objetivo',
        stage_name: stageNameMap[d.stage_id] || d.stage_id,
      })));
    } catch (error) {
      console.error('Error loading process checklists:', error);
    } finally {
      setLoaded(true);
    }
  }, [processId, boardId, stageId, stages]);

  useEffect(() => {
    loadAndAutoCreate();
  }, [loadAndAutoCreate]);

  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    const allChecked = updatedItems.every(i => i.checked);

    setInstances(prev => prev.map(inst =>
      inst.id === instance.id
        ? { ...inst, items: updatedItems, is_completed: allChecked }
        : inst
    ));

    await supabase
      .from('lead_checklist_instances')
      .update({
        items: JSON.parse(JSON.stringify(updatedItems)),
        is_completed: allChecked,
        completed_at: allChecked ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);
  };

  if (!loaded || instances.length === 0) return null;

  // Calculate progress
  const totalItems = instances.reduce((sum, i) => sum + i.items.length, 0);
  const checkedItems = instances.reduce((sum, i) => sum + i.items.filter(it => it.checked).length, 0);
  const overallPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  // Group instances by stage
  const instancesByStage: Record<string, ChecklistInstance[]> = {};
  instances.forEach(inst => {
    if (!instancesByStage[inst.stage_id]) instancesByStage[inst.stage_id] = [];
    instancesByStage[inst.stage_id].push(inst);
  });

  // Current stage instances
  const currentStageInstances = instancesByStage[stageId] || [];

  return (
    <div className="space-y-1.5 border-t pt-2">
      {/* Overall progress */}
      <div className="flex items-center gap-1.5 cursor-pointer" onClick={onToggleShow}>
        <ListChecks className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <Progress value={overallPercent} className="h-1.5 flex-1" />
        <span className={cn(
          "text-[10px] font-medium min-w-[32px] text-right",
          overallPercent === 100 ? "text-green-600" : "text-muted-foreground"
        )}>
          {checkedItems}/{totalItems}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", show && "rotate-180")} />
      </div>

      {/* Checklist items */}
      {show && (
        <div className="space-y-2">
          {/* Current stage items - expanded */}
          {currentStageInstances.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-primary">
                📍 {currentStageInstances[0]?.stage_name}
              </p>
              {currentStageInstances.map(instance => (
                <div key={instance.id} className="space-y-0.5">
                  {instance.items.length > 1 && (
                    <p className="text-[10px] font-medium text-muted-foreground pl-1">{instance.template_name}</p>
                  )}
                  {instance.items.map(item => (
                    <label
                      key={item.id}
                      className="flex items-center gap-1.5 cursor-pointer group/item hover:bg-muted/30 rounded px-1 py-0.5"
                    >
                      <Checkbox
                        checked={item.checked || false}
                        onCheckedChange={() => handleToggleItem(instance, item.id)}
                        disabled={instance.is_readonly}
                        className="h-3 w-3"
                      />
                      <span className={cn(
                        "text-[10px] leading-tight flex-1",
                        item.checked && "line-through text-muted-foreground"
                      )}>
                        {item.label}
                      </span>
                      {item.script && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <MessageSquareText className="h-3 w-3 text-primary flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[250px]">
                            <p className="text-[10px] font-semibold mb-1">Script</p>
                            <p className="text-[10px] whitespace-pre-wrap line-clamp-4">{item.script}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {item.docChecklist && item.docChecklist.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <ClipboardList className="h-3 w-3 text-orange-500 flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-[10px]">{item.docChecklist.length} documentos</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Other stages - collapsed */}
          {Object.entries(instancesByStage)
            .filter(([sid]) => sid !== stageId)
            .map(([sid, stageInstances]) => {
              const stageName = stageInstances[0]?.stage_name || sid;
              const stageTotal = stageInstances.reduce((s, i) => s + i.items.length, 0);
              const stageChecked = stageInstances.reduce((s, i) => s + i.items.filter(it => it.checked).length, 0);
              const stageComplete = stageChecked === stageTotal;
              const stageIdx = stages.findIndex(s => s.id === sid);
              const currentIdx = stages.findIndex(s => s.id === stageId);
              const isPast = stageIdx < currentIdx;

              return (
                <Collapsible key={sid}>
                  <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left hover:bg-muted/30 rounded px-1 py-0.5">
                    {stageComplete ? (
                      <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                    ) : (
                      <Circle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={cn(
                      "text-[10px] font-medium flex-1",
                      isPast && stageComplete && "text-green-600",
                      !isPast && "text-muted-foreground"
                    )}>
                      {stageName}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{stageChecked}/{stageTotal}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 space-y-0.5 mt-0.5">
                    {stageInstances.map(instance => (
                      <div key={instance.id} className="space-y-0.5">
                        {instance.items.map(item => (
                          <label
                            key={item.id}
                            className="flex items-center gap-1.5 cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5"
                          >
                            <Checkbox
                              checked={item.checked || false}
                              onCheckedChange={() => handleToggleItem(instance, item.id)}
                              disabled={instance.is_readonly}
                              className="h-3 w-3"
                            />
                            <span className={cn(
                              "text-[10px] leading-tight flex-1",
                              item.checked && "line-through text-muted-foreground"
                            )}>
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
        </div>
      )}
    </div>
  );
}

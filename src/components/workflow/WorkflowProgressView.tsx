import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronRight,
  CheckCircle2,
  Circle,
  Eye,
  Filter,
  Target,
  ArrowRight,
  MessageSquareText,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { ChecklistItem, LeadChecklistInstance, DocChecklistItem } from '@/hooks/useChecklists';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { toast } from 'sonner';

interface WorkflowProgressViewProps {
  leadId: string;
  leadName: string;
  boardId: string;
  currentStageId: string;
  board: KanbanBoard;
  onStageChange?: (newStageId: string) => void;
}

interface PhaseData {
  stage: KanbanStage;
  objectives: ObjectiveData[];
  isCurrent: boolean;
  isPast: boolean;
}

interface ObjectiveData {
  instance: LeadChecklistInstance;
  templateName: string;
  isMandatory: boolean;
}

export function WorkflowProgressView({
  leadId,
  leadName,
  boardId,
  currentStageId,
  board,
  onStageChange,
}: WorkflowProgressViewProps) {
  const [instances, setInstances] = useState<LeadChecklistInstance[]>([]);
  const [templateInfo, setTemplateInfo] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});
  const [stageLinks, setStageLinks] = useState<{ checklist_template_id: string; stage_id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'current' | 'full'>('full');
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedObjectives, setExpandedObjectives] = useState<Set<string>>(new Set());
  const [docCheckStates, setDocCheckStates] = useState<Record<string, Record<string, boolean>>>({});
  const { logActivity } = useActivityLogger();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all instances for this lead+board
      const { data: instanceData, error: instError } = await supabase
        .from('lead_checklist_instances')
        .select('*')
        .eq('lead_id', leadId)
        .eq('board_id', boardId)
        .order('created_at');

      if (instError) throw instError;

      const parsed = (instanceData || []).map(i => ({
        ...i,
        items: (i.items as unknown as ChecklistItem[]) || [],
      })) as LeadChecklistInstance[];

      // Fetch stage links for this board
      const { data: linksData } = await supabase
        .from('checklist_stage_links')
        .select('checklist_template_id, stage_id')
        .eq('board_id', boardId);

      setStageLinks(linksData || []);

      // Fetch template info
      const templateIds = [...new Set([
        ...parsed.map(i => i.checklist_template_id),
        ...(linksData || []).map(l => l.checklist_template_id),
      ])];

      if (templateIds.length > 0) {
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('id, name, is_mandatory')
          .in('id', templateIds);

        const info: Record<string, { name: string; is_mandatory: boolean }> = {};
        (templates || []).forEach(t => {
          info[t.id] = { name: t.name, is_mandatory: t.is_mandatory };
        });
        setTemplateInfo(info);
      }

      setInstances(parsed);

      // Auto-expand current phase
      setExpandedPhases(new Set([currentStageId]));
    } catch (error) {
      console.error('Error loading workflow data:', error);
      toast.error('Erro ao carregar fluxo de trabalho');
    } finally {
      setLoading(false);
    }
  }, [leadId, boardId, currentStageId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build phases from board stages
  const phases: PhaseData[] = useMemo(() => {
    const currentIndex = board.stages.findIndex(s => s.id === currentStageId);

    return board.stages.map((stage, index) => {
      const isCurrent = stage.id === currentStageId;
      const isPast = index < currentIndex;

      // Get objectives for this stage from instances
      const stageInstances = instances.filter(i => i.stage_id === stage.id);

      // Also include linked templates that don't have instances yet
      const linkedTemplateIds = stageLinks
        .filter(l => l.stage_id === stage.id)
        .map(l => l.checklist_template_id);

      const objectives: ObjectiveData[] = stageInstances.map(inst => ({
        instance: inst,
        templateName: templateInfo[inst.checklist_template_id]?.name || 'Objetivo',
        isMandatory: templateInfo[inst.checklist_template_id]?.is_mandatory || false,
      }));

      // Add placeholders for linked but not yet instantiated
      linkedTemplateIds.forEach(templateId => {
        if (!stageInstances.some(i => i.checklist_template_id === templateId)) {
          const info = templateInfo[templateId];
          if (info) {
            objectives.push({
              instance: {
                id: `placeholder-${stage.id}-${templateId}`,
                lead_id: leadId,
                checklist_template_id: templateId,
                board_id: boardId,
                stage_id: stage.id,
                items: [],
                is_completed: false,
                is_readonly: true,
                completed_at: null,
                created_at: '',
                updated_at: '',
              },
              templateName: info.name,
              isMandatory: info.is_mandatory,
            });
          }
        }
      });

      return { stage, objectives, isCurrent, isPast };
    });
  }, [board.stages, currentStageId, instances, stageLinks, templateInfo, leadId, boardId]);

  // Overall progress
  const { totalItems, checkedItems, overallPercent } = useMemo(() => {
    const total = instances.reduce((sum, i) => sum + i.items.length, 0);
    const checked = instances.reduce((sum, i) => sum + i.items.filter(it => it.checked).length, 0);
    const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
    return { totalItems: total, checkedItems: checked, overallPercent: percent };
  }, [instances]);

  const togglePhase = (stageId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  const toggleObjective = (instanceId: string) => {
    setExpandedObjectives(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };

  const handleToggleItem = async (instance: LeadChecklistInstance, itemId: string) => {
    if (instance.is_readonly || instance.id.startsWith('placeholder-')) return;

    const targetItem = instance.items.find(i => i.id === itemId);
    const willBeChecked = !targetItem?.checked;

    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    const allChecked = updatedItems.every(i => i.checked);

    // Optimistic update
    setInstances(prev => prev.map(inst =>
      inst.id === instance.id
        ? { ...inst, items: updatedItems, is_completed: allChecked }
        : inst
    ));

    logActivity({
      actionType: willBeChecked ? 'checklist_item_checked' : 'checklist_item_unchecked',
      entityType: 'lead',
      entityId: leadId,
      metadata: { checklistId: instance.id, itemId, itemLabel: targetItem?.label },
    });

    const { error } = await supabase
      .from('lead_checklist_instances')
      .update({
        items: JSON.parse(JSON.stringify(updatedItems)),
        is_completed: allChecked,
        completed_at: allChecked ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar passo');
      loadData();
      return;
    }

    // Conditional branching: if step has nextStageId and was just checked, move lead
    if (willBeChecked && targetItem?.nextStageId && onStageChange) {
      if (targetItem.nextStageId === '__finalize__') {
        // Find the closed/done stage
        const closedStage = board.stages.find(s =>
          ['closed', 'fechado', 'done', 'concluído', 'concluido', 'finalizado'].includes(s.id.toLowerCase()) ||
          ['closed', 'fechado', 'done', 'concluído', 'concluido', 'finalizado'].includes(s.name.toLowerCase())
        );
        if (closedStage) {
          onStageChange(closedStage.id);
          toast.success(`Lead finalizado! Movido para: ${closedStage.name}`);
        } else {
          // Use last stage as fallback
          const lastStage = board.stages[board.stages.length - 1];
          if (lastStage) {
            onStageChange(lastStage.id);
            toast.success(`Lead finalizado! Movido para: ${lastStage.name}`);
          }
        }
      } else {
        const targetStage = board.stages.find(s => s.id === targetItem.nextStageId);
        if (targetStage) {
          onStageChange(targetItem.nextStageId);
          toast.success(`Lead movido para: ${targetStage.name}`);
        }
      }
    }
  };

  const handleMarkAll = async (instance: LeadChecklistInstance, checked: boolean) => {
    if (instance.is_readonly || instance.id.startsWith('placeholder-')) return;

    const updatedItems = instance.items.map(item => ({ ...item, checked }));

    setInstances(prev => prev.map(inst =>
      inst.id === instance.id
        ? { ...inst, items: updatedItems, is_completed: checked }
        : inst
    ));

    await supabase
      .from('lead_checklist_instances')
      .update({
        items: JSON.parse(JSON.stringify(updatedItems)),
        is_completed: checked,
        completed_at: checked ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);
  };

  const visiblePhases = viewMode === 'current'
    ? phases.filter(p => p.isCurrent)
    : phases;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Carregando fluxo de trabalho...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <h2 className="text-xl font-semibold">{leadName || 'Lead sem nome'}</h2>

        {/* Circular progress */}
        <div className="flex justify-center">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="8"
              />
              <circle
                cx="50" cy="50" r="42"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${overallPercent * 2.64} ${264 - overallPercent * 2.64}`}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold">{overallPercent}%</span>
              <span className="text-[10px] text-muted-foreground">Concluído</span>
            </div>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant={viewMode === 'current' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('current')}
          >
            <Filter className="h-3.5 w-3.5 mr-1" />
            Fase Atual
          </Button>
          <Button
            variant={viewMode === 'full' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('full')}
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            Fluxo Completo
          </Button>
        </div>
      </div>

      {/* Phases */}
      <ScrollArea className="max-h-[60vh]">
        <div className="space-y-2 pr-2">
          {visiblePhases.map((phase, phaseIndex) => {
            const isExpanded = expandedPhases.has(phase.stage.id);
            const phaseCompleted = phase.objectives.length > 0 &&
              phase.objectives.every(o => o.instance.is_completed);
            const phaseItemsTotal = phase.objectives.reduce((s, o) => s + o.instance.items.length, 0);
            const phaseItemsChecked = phase.objectives.reduce((s, o) => s + o.instance.items.filter(i => i.checked).length, 0);

            return (
              <div key={phase.stage.id}>
                {/* Phase header */}
                <Collapsible open={isExpanded} onOpenChange={() => togglePhase(phase.stage.id)}>
                  <CollapsibleTrigger className="w-full">
                    <div
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border bg-muted/30 transition-all hover:bg-muted/50 cursor-pointer",
                        phase.isCurrent && "ring-2 ring-primary/40 bg-primary/5",
                      )}
                    >
                      <ChevronRight className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
                        isExpanded && "rotate-90"
                      )} />

                      <div className="flex-1 text-left">
                        <span className="font-semibold text-sm">
                          Fase {phaseIndex + 1}: {phase.stage.name}
                        </span>
                        {phase.stage.name && phase.isCurrent && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Fase atual do fluxo</p>
                        )}
                      </div>

                      {phaseCompleted && phase.objectives.length > 0 && (
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      )}

                      {phaseItemsTotal > 0 && (
                        <Checkbox
                          checked={phaseItemsChecked === phaseItemsTotal && phaseItemsTotal > 0}
                          className="flex-shrink-0"
                          onCheckedChange={(checked) => {
                            phase.objectives.forEach(o => {
                              if (!o.instance.is_readonly && !o.instance.id.startsWith('placeholder-')) {
                                handleMarkAll(o.instance, !!checked);
                              }
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}

                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        Marcar todos
                      </span>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-blue-300/40 pl-3">
                      {phase.objectives.length === 0 ? (
                        <p className="text-xs text-muted-foreground pl-4 py-2">
                          Nenhum objetivo vinculado a esta fase
                        </p>
                      ) : (
                        phase.objectives.map((objective, objIndex) => {
                          const objExpanded = expandedObjectives.has(objective.instance.id);
                          const completedCount = objective.instance.items.filter(i => i.checked).length;
                          const totalCount = objective.instance.items.length;
                          const isPlaceholder = objective.instance.id.startsWith('placeholder-');
                          const allChecked = totalCount > 0 && completedCount === totalCount;
                          const nextUncheckedIndex = objective.instance.items.findIndex(i => !i.checked);

                          return (
                            <Collapsible
                              key={objective.instance.id}
                              open={objExpanded}
                              onOpenChange={() => toggleObjective(objective.instance.id)}
                            >
                              <CollapsibleTrigger className="w-full">
                                <div className={cn(
                                  "flex items-center gap-2 p-2.5 rounded-md transition-all cursor-pointer hover:bg-muted/30",
                                  allChecked && "bg-green-50/60 dark:bg-green-950/20",
                                  isPlaceholder && "opacity-50",
                                )}>
                                  <ChevronRight className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0",
                                    objExpanded && "rotate-90"
                                  )} />

                                  <span className="text-sm font-medium flex-1 text-left">
                                    Objetivo {objIndex + 1}: {objective.templateName}
                                  </span>

                                  {allChecked && (
                                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                  )}

                                  {!isPlaceholder && totalCount > 0 && (
                                    <>
                                      <Checkbox
                                        checked={allChecked}
                                        className="flex-shrink-0"
                                        onCheckedChange={(checked) => {
                                          handleMarkAll(objective.instance, !!checked);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {allChecked ? 'Desmarcar todos' : 'Marcar todos'}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <div className="ml-6 mt-0.5 space-y-0.5 border-l-2 border-green-300/40 pl-3">
                                  {objective.instance.items.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-2 pl-2">
                                      Nenhum passo definido
                                    </p>
                                  ) : (
                                    objective.instance.items.map((item, itemIndex) => {
                                      const isNext = itemIndex === nextUncheckedIndex && !item.checked;
                                      const isReadonly = objective.instance.is_readonly || isPlaceholder;

                                      return (
                                        <div key={item.id}>
                                          <div
                                            className={cn(
                                              "flex items-start gap-2.5 p-2.5 rounded-md transition-all",
                                              isNext && "bg-primary/5 ring-1 ring-primary/20",
                                            )}
                                          >
                                            <Checkbox
                                              checked={item.checked || false}
                                              onCheckedChange={() => handleToggleItem(objective.instance, item.id)}
                                              disabled={isReadonly}
                                              className="mt-0.5"
                                            />

                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn(
                                                  "text-sm font-medium",
                                                  item.checked && "line-through text-muted-foreground"
                                                )}>
                                                  Passo {itemIndex + 1}: {item.label}
                                                </span>
                                                {isNext && (
                                                  <Badge
                                                    variant="outline"
                                                    className="text-[10px] h-4 border-primary text-primary"
                                                  >
                                                    <ArrowRight className="h-2.5 w-2.5 mr-0.5" />
                                                    Próximo
                                                  </Badge>
                                                )}
                                                {item.nextStageId && (() => {
                                                  if (item.nextStageId === '__finalize__') {
                                                    return (
                                                      <Badge variant="secondary" className="text-[10px] h-4 gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                                        ✅ Finalizar
                                                      </Badge>
                                                    );
                                                  }
                                                  const targetStage = board.stages.find(s => s.id === item.nextStageId);
                                                  return targetStage ? (
                                                    <Badge variant="secondary" className="text-[10px] h-4 gap-1">
                                                      <ArrowRight className="h-2.5 w-2.5" />
                                                      {targetStage.name}
                                                    </Badge>
                                                  ) : null;
                                                })()}
                                              </div>

                                              {/* Description inline under step title */}
                                              {item.description && (
                                                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                                  {item.description}
                                                </p>
                                              )}

                                              {/* Script section */}
                                              {item.script && (isNext || expandedObjectives.has(`script-${item.id}`)) && (
                                                <div className="mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/20">
                                                  <div className="flex items-center gap-1.5 mb-1.5">
                                                    <MessageSquareText className="h-3.5 w-3.5 text-primary" />
                                                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Script de Contato</span>
                                                 </div>
                                                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{item.script}</p>
                                                </div>
                                              )}
                                              {item.script && !isNext && (
                                                <button
                                                  className="text-[10px] text-primary hover:underline mt-1"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedObjectives(prev => {
                                                      const next = new Set(prev);
                                                      const key = `script-${item.id}`;
                                                      if (next.has(key)) next.delete(key); else next.add(key);
                                                      return next;
                                                    });
                                                  }}
                                                >
                                                  {expandedObjectives.has(`script-${item.id}`) ? 'Ocultar script' : 'Ver script'}
                                                </button>
                                              )}

                                              {/* Doc Checklist section */}
                                              {item.docChecklist && item.docChecklist.length > 0 && (isNext || expandedObjectives.has(`docs-${item.id}`)) && (
                                                <div className="mt-2 p-2.5 rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                                                  <div className="flex items-center gap-1.5 mb-2">
                                                    <ClipboardList className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                                                    <span className="text-[10px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">Documentação</span>
                                                  </div>
                                                  <div className="space-y-1">
                                                    {item.docChecklist.map(doc => {
                                                      const isDocChecked = docCheckStates[item.id]?.[doc.id] || false;
                                                      return (
                                                        <label
                                                          key={doc.id}
                                                          className={cn(
                                                            "flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-orange-100/50 dark:hover:bg-orange-900/20 transition-colors",
                                                            isDocChecked && "opacity-60"
                                                          )}
                                                        >
                                                          <Checkbox
                                                            checked={isDocChecked}
                                                            onCheckedChange={(checked) => {
                                                              setDocCheckStates(prev => ({
                                                                ...prev,
                                                                [item.id]: {
                                                                  ...prev[item.id],
                                                                  [doc.id]: !!checked,
                                                                },
                                                              }));
                                                            }}
                                                            className="flex-shrink-0"
                                                          />
                                                          <span className={cn(
                                                            "text-xs",
                                                            isDocChecked && "line-through text-muted-foreground"
                                                          )}>
                                                            {doc.label}
                                                          </span>
                                                        </label>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                              )}
                                              {item.docChecklist && item.docChecklist.length > 0 && !isNext && (
                                                <button
                                                  className="text-[10px] text-orange-600 dark:text-orange-400 hover:underline mt-1"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedObjectives(prev => {
                                                      const next = new Set(prev);
                                                      const key = `docs-${item.id}`;
                                                      if (next.has(key)) next.delete(key); else next.add(key);
                                                      return next;
                                                    });
                                                  }}
                                                >
                                                  {expandedObjectives.has(`docs-${item.id}`) ? 'Ocultar documentação' : `Ver documentação (${item.docChecklist.length})`}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

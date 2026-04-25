import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckSquare, Loader2, MessageSquareText, Copy, CircleDot, CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, LeadChecklistInstance } from '@/hooks/useChecklists';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { cn } from '@/lib/utils';

interface WhatsAppLeadStageManagerProps {
  leadId: string;
  boardId: string | null;
  currentStageId: string | null;
  onStageChanged?: () => void;
}

export function WhatsAppLeadStageManager({ leadId, boardId, currentStageId, onStageChanged }: WhatsAppLeadStageManagerProps) {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [stageId, setStageId] = useState<string | null>(currentStageId);
  const [changing, setChanging] = useState(false);
  const { addHistoryEntry } = useLeadStageHistory();

  // Checklist state
  const { fetchLeadInstances, updateInstanceItem, createLeadInstances } = useChecklists();
  const [instances, setInstances] = useState<LeadChecklistInstance[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());
  const [openPhase, setOpenPhase] = useState<string | undefined>(undefined);

  // Fetch board data — keep previous board visible while refetching when boardId changes
  useEffect(() => {
    if (!boardId) { setBoard(null); return; }
    let cancelled = false;
    supabase
      .from('kanban_boards')
      .select('*')
      .eq('id', boardId)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setBoard({
          ...data,
          board_type: (data as any).board_type || 'funnel',
          stages: (data.stages as unknown as KanbanStage[]) || [],
        } as KanbanBoard);
      });
    return () => { cancelled = true; };
  }, [boardId]);

  // Sync stageId only when the lead changes or external stage changes
  useEffect(() => {
    setStageId(currentStageId);
    if (currentStageId) setOpenPhase(currentStageId);
  }, [leadId, currentStageId]);

  // Fetch checklists — stable callback, only reruns when ids actually change
  const loadChecklists = useCallback(async () => {
    if (!leadId) return;
    setLoadingChecklist(true);
    try {
      if (boardId && stageId) {
        await createLeadInstances(leadId, boardId, stageId);
      }
      const data = await fetchLeadInstances(leadId);

      // Reset readonly for instances that match the current stage (batch in a single update)
      if (stageId) {
        const readonlyIds = data.filter(i => i.stage_id === stageId && i.is_readonly).map(i => i.id);
        if (readonlyIds.length > 0) {
          await supabase
            .from('lead_checklist_instances')
            .update({ is_readonly: false })
            .in('id', readonlyIds);
          data.forEach(i => { if (readonlyIds.includes(i.id)) i.is_readonly = false; });
        }
      }

      if (data.length > 0) {
        const templateIds = [...new Set(data.map(d => d.checklist_template_id))];
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('id, name, is_mandatory')
          .in('id', templateIds);
        const names: Record<string, { name: string; is_mandatory: boolean }> = {};
        (templates || []).forEach(t => { names[t.id] = { name: t.name, is_mandatory: t.is_mandatory }; });
        setTemplateNames(names);
      } else {
        setTemplateNames({});
      }
      setInstances(data);
    } finally {
      setLoadingChecklist(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, boardId, stageId]);

  useEffect(() => {
    loadChecklists();
  }, [loadChecklists]);

  const handleStageChange = async (newStageId: string) => {
    if (newStageId === stageId || changing) return;
    setChanging(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: newStageId })
        .eq('id', leadId);
      if (error) throw error;

      await addHistoryEntry(leadId, stageId, newStageId, boardId, boardId);
      
      const oldStageId = stageId;
      setStageId(newStageId);
      
      const oldName = board?.stages.find(s => s.id === oldStageId)?.name || oldStageId;
      const newName = board?.stages.find(s => s.id === newStageId)?.name || newStageId;
      toast.success(`Movido: ${oldName} → ${newName}`);
      
      onStageChanged?.();
      // Reload checklists for new stage
      setTimeout(() => loadChecklists(), 300);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao mudar fase');
    } finally {
      setChanging(false);
    }
  };

  const handleToggleItem = async (instance: LeadChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;
    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    await updateInstanceItem(instance.id, updatedItems);
    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? { ...i, items: updatedItems, is_completed: updatedItems.every(item => item.checked) }
        : i
    ));
  };

  const handleCompleteAll = async (instance: LeadChecklistInstance) => {
    if (instance.is_readonly) return;
    const updatedItems = instance.items.map(item => ({ ...item, checked: true }));
    await updateInstanceItem(instance.id, updatedItems);
    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems, is_completed: true } : i
    ));
    toast.success('Todos os passos marcados como concluídos');
  };


  if (!board || !boardId) return null;

  const toggleScriptExpanded = (itemId: string) => {
    setExpandedScripts(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const copyScript = (script: string) => {
    navigator.clipboard.writeText(script);
    toast.success('Script copiado!');
  };

  // Aggregate progress per phase (across all non-readonly instances of that stage)
  const phaseAggregate = (sid: string) => {
    const inst = instances.filter(i => i.stage_id === sid && !i.is_readonly);
    let done = 0, total = 0;
    inst.forEach(i => {
      total += i.items.length;
      done += i.items.filter(it => it.checked).length;
    });
    return { done, total, instances: inst, allCompleted: total > 0 && done === total };
  };

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Fases do Funil
        </span>
        {changing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <Accordion
        type="single"
        collapsible
        value={openPhase}
        onValueChange={(v) => setOpenPhase(v || undefined)}
        className="space-y-1"
      >
        {board.stages.map((stage) => {
          const isActive = stage.id === stageId;
          const { done, total, instances: stageInstances, allCompleted } = phaseAggregate(stage.id);
          const progress = total > 0 ? (done / total) * 100 : 0;

          return (
            <AccordionItem
              key={stage.id}
              value={stage.id}
              className={cn(
                "border rounded-lg bg-card/50 overflow-hidden",
                isActive && "border-primary/60 bg-primary/5"
              )}
            >
              <AccordionTrigger className="px-2 py-1.5 hover:no-underline hover:bg-accent/30 [&>svg]:h-3 [&>svg]:w-3">
                <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
                  {/* Phase status icon */}
                  {allCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  ) : isActive ? (
                    <CircleDot className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className={cn(
                    "text-xs font-medium truncate text-left",
                    isActive ? "text-primary" : "text-foreground"
                  )}>
                    {stage.name}
                  </span>
                  {isActive && (
                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-primary/40 text-primary shrink-0">
                      atual
                    </Badge>
                  )}
                  <div className="flex-1" />
                  {total > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-12 bg-muted rounded-full h-1">
                        <div
                          className={cn("h-1 rounded-full transition-all", allCompleted ? "bg-green-500" : "bg-primary")}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{done}/{total}</span>
                    </div>
                  )}
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-2 pb-2 pt-0">
                {/* Move-to-phase shortcut if not active */}
                {!isActive && (
                  <div className="mb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => handleStageChange(stage.id)}
                      disabled={changing}
                    >
                      <ArrowRight className="h-3 w-3" />
                      Mover lead para esta fase
                    </Button>
                  </div>
                )}

                {loadingChecklist && stage.id === stageId ? (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando passos...
                  </div>
                ) : stageInstances.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic px-1">
                    Nenhum objetivo configurado para esta fase.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {stageInstances.map(instance => {
                      const info = templateNames[instance.checklist_template_id];
                      const completedCount = instance.items.filter(i => i.checked).length;
                      const totalCount = instance.items.length;

                      return (
                        <div key={instance.id} className="rounded-md border bg-background/40 p-1.5">
                          {/* Objective header */}
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <CheckSquare className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-[11px] font-medium truncate">{info?.name || 'Objetivo'}</span>
                              {info?.is_mandatory && (
                                <Badge variant="destructive" className="text-[8px] h-3 px-1 shrink-0">Obrigatório</Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                              {completedCount}/{totalCount}
                            </span>
                          </div>

                          {/* Steps */}
                          <div className="space-y-0.5">
                            {instance.items.map(item => {
                              const isNextUnchecked = !item.checked && instance.items.findIndex(i => !i.checked) === instance.items.indexOf(item);
                              const showScript = item.script && (isNextUnchecked || expandedScripts.has(item.id));

                              return (
                                <div key={item.id}>
                                  <div className="flex items-center gap-1.5 py-0.5 text-xs hover:bg-accent/50 rounded px-1 -mx-1">
                                    <Checkbox
                                      checked={item.checked || false}
                                      onCheckedChange={() => handleToggleItem(instance, item.id)}
                                      disabled={instance.is_readonly}
                                      className="h-3.5 w-3.5"
                                    />
                                    <span className={cn("flex-1 text-[11px]", item.checked ? 'line-through text-muted-foreground' : '')}>
                                      {item.label}
                                    </span>
                                    {item.script && (
                                      <button
                                        onClick={(e) => { e.preventDefault(); toggleScriptExpanded(item.id); }}
                                        className={cn("p-0.5 rounded", expandedScripts.has(item.id) || isNextUnchecked ? "text-primary" : "text-muted-foreground hover:text-primary")}
                                        title="Ver script"
                                      >
                                        <MessageSquareText className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                  {showScript && item.script && (
                                    <div className="ml-5 mt-1 mb-1.5 p-2 rounded-md bg-primary/5 border border-primary/20">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-[9px] font-semibold text-primary uppercase tracking-wide">Script</span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5"
                                          onClick={() => copyScript(item.script!)}
                                          title="Copiar script"
                                        >
                                          <Copy className="h-2.5 w-2.5" />
                                        </Button>
                                      </div>
                                      <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">{item.script}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

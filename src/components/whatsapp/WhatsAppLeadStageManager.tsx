import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, CheckSquare, ListChecks, Lock, Loader2, MessageSquareText, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, LeadChecklistInstance, ChecklistItem } from '@/hooks/useChecklists';
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

  // Collapse states
  const [phasesCollapsed, setPhasesCollapsed] = useState(false);
  const [stepsCollapsed, setStepsCollapsed] = useState(false);

  // Checklist state
  const { fetchLeadInstances, updateInstanceItem, createLeadInstances } = useChecklists();
  const [instances, setInstances] = useState<LeadChecklistInstance[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());

  // Fetch board data
  useEffect(() => {
    if (!boardId) { setBoard(null); return; }
    supabase
      .from('kanban_boards')
      .select('*')
      .eq('id', boardId)
      .single()
      .then(({ data }) => {
        if (data) {
          setBoard({
            ...data,
            board_type: (data as any).board_type || 'funnel',
            stages: (data.stages as unknown as KanbanStage[]) || [],
          } as KanbanBoard);
        }
      });
  }, [boardId]);

  // Sync stageId with prop
  useEffect(() => {
    setStageId(currentStageId);
  }, [currentStageId]);

  // Fetch checklists
  const loadChecklists = useCallback(async () => {
    setLoadingChecklist(true);
    if (boardId && stageId) {
      await createLeadInstances(leadId, boardId, stageId);
    }
    const data = await fetchLeadInstances(leadId);

    // Reset readonly for instances that match the current stage
    if (stageId) {
      const readonlyCurrentStage = data.filter(i => i.stage_id === stageId && i.is_readonly);
      for (const inst of readonlyCurrentStage) {
        await supabase
          .from('lead_checklist_instances')
          .update({ is_readonly: false })
          .eq('id', inst.id);
        inst.is_readonly = false;
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
    }
    setInstances(data);
    setLoadingChecklist(false);
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


  if (!board || !boardId) return null;

  const currentStage = board.stages.find(s => s.id === stageId);
  const currentInstances = instances.filter(i => i.stage_id === stageId && !i.is_readonly);

  // Find next unchecked step with script across all current instances
  const nextStepWithScript = (() => {
    for (const inst of currentInstances) {
      const nextItem = inst.items.find(i => !i.checked && i.script);
      if (nextItem) return nextItem;
    }
    return null;
  })();

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

  return (
    <div className="px-3 py-2 space-y-1">
      {/* FASE header - collapsible */}
      <button
        onClick={() => setPhasesCollapsed(!phasesCollapsed)}
        className="flex items-center gap-1.5 w-full text-left hover:bg-accent/50 rounded px-1 py-0.5 transition-colors"
      >
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">Fase:</span>
        <span className="text-[10px] font-semibold text-primary truncate flex-1">
          {currentStage?.name || 'Nenhuma'}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", !phasesCollapsed && "rotate-180")} />
        {changing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </button>

      {/* Phase tabs - expandable */}
      {!phasesCollapsed && (
        <div className="flex items-center gap-1 flex-wrap pl-1">
          {board.stages.map((stage) => {
            const isActive = stage.id === stageId;
            return (
              <button
                key={stage.id}
                onClick={() => handleStageChange(stage.id)}
                disabled={changing || isActive}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border transition-all",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-border hover:border-primary/50 hover:bg-accent text-muted-foreground"
                )}
                title={stage.name}
              >
                {stage.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Checklist for current stage - collapsible */}
      {!loadingChecklist && currentInstances.length > 0 && (
        <div className="space-y-1">
          {currentInstances.map(instance => {
            const info = templateNames[instance.checklist_template_id];
            const completedCount = instance.items.filter(i => i.checked).length;
            const totalCount = instance.items.length;
            const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

            return (
              <div key={instance.id} className="rounded-lg border bg-card/50 p-2">
                {/* Objective header - clickable to collapse */}
                <button
                  onClick={() => setStepsCollapsed(!stepsCollapsed)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <CheckSquare className="h-3 w-3 text-primary" />
                    <span className="text-xs font-medium">{info?.name || 'Passos'}</span>
                    {info?.is_mandatory && (
                      <Badge variant="destructive" className="text-[8px] h-3 px-1">Obrigatório</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{completedCount}/{totalCount}</span>
                    <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", !stepsCollapsed && "rotate-180")} />
                  </div>
                </button>

                {/* Progress bar - always visible */}
                <div className="w-full bg-muted rounded-full h-1 my-1.5">
                  <div
                    className={cn("h-1 rounded-full transition-all", instance.is_completed ? "bg-green-500" : "bg-primary")}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Steps - collapsible */}
                {!stepsCollapsed && (
                  <div className="space-y-0.5">
                    {instance.items.map(item => {
                      const isNextUnchecked = !item.checked && instance.items.findIndex(i => !i.checked) === instance.items.indexOf(item);
                      const showScript = item.script && (isNextUnchecked || expandedScripts.has(item.id));

                      return (
                        <div key={item.id}>
                          <div className="flex items-center gap-1.5 py-0.5 text-xs cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1">
                            <Checkbox
                              checked={item.checked || false}
                              onCheckedChange={() => handleToggleItem(instance, item.id)}
                              className="h-3.5 w-3.5"
                            />
                            <span className={cn("flex-1", item.checked ? 'line-through text-muted-foreground' : '')}>
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

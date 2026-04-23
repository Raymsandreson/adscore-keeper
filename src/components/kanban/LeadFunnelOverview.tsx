import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { useChecklists, LeadChecklistInstance, ChecklistItem, CHECKLIST_TYPES } from '@/hooks/useChecklists';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, Circle, ChevronDown, ChevronRight, MessageSquareText, ClipboardList, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeadFunnelOverviewProps {
  leadId: string;
  boardId: string | null;
  currentStageId: string | null;
  boards?: KanbanBoard[];
  isClosed?: boolean; // true = "Fluxo de Trabalho", false = "Funil de Vendas"
}

// Module-level cache: instant render on re-open
const funnelCache = new Map<string, { instances: LeadChecklistInstance[]; templateNames: Record<string, { name: string; is_mandatory: boolean }> }>();
const funnelRequests = new Map<string, Promise<{ instances: LeadChecklistInstance[]; templateNames: Record<string, { name: string; is_mandatory: boolean }> }>>();

const loadLeadFunnelOverview = async (
  leadId: string,
  boardId: string | null,
  currentStageId: string | null,
  fetchLeadInstances: (leadId: string) => Promise<LeadChecklistInstance[]>,
  createLeadInstances: (leadId: string, boardId: string, stageId: string) => Promise<void>,
  force = false,
) => {
  const cacheKey = `${leadId}:${boardId || ''}:${currentStageId || ''}`;

  if (!force && funnelCache.has(cacheKey)) {
    return funnelCache.get(cacheKey) || { instances: [], templateNames: {} };
  }

  const inFlight = funnelRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      if (boardId && currentStageId) {
        await createLeadInstances(leadId, boardId, currentStageId);
      }

      const data = await fetchLeadInstances(leadId);

      if (currentStageId) {
        const readonlyCurrentIds = data.filter(i => i.stage_id === currentStageId && i.is_readonly).map(i => i.id);
        if (readonlyCurrentIds.length > 0) {
          await supabase
            .from('lead_checklist_instances')
            .update({ is_readonly: false })
            .in('id', readonlyCurrentIds);
          data.forEach(i => { if (readonlyCurrentIds.includes(i.id)) i.is_readonly = false; });
        }
      }

      let names: Record<string, { name: string; is_mandatory: boolean }> = {};
      if (data.length > 0) {
        const templateIds = [...new Set(data.map(d => d.checklist_template_id))];
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('id, name, is_mandatory')
          .in('id', templateIds);
        (templates || []).forEach(t => { names[t.id] = { name: t.name, is_mandatory: t.is_mandatory }; });
      }

      const payload = { instances: data, templateNames: names };
      funnelCache.set(cacheKey, payload);
      return payload;
    } finally {
      funnelRequests.delete(cacheKey);
    }
  })();

  funnelRequests.set(cacheKey, request);
  return request;
};

export const prefetchLeadFunnelOverview = async (
  leadId: string,
  boardId: string | null,
  currentStageId: string | null,
  fetchLeadInstances: (leadId: string) => Promise<LeadChecklistInstance[]>,
  createLeadInstances: (leadId: string, boardId: string, stageId: string) => Promise<void>,
) => {
  await loadLeadFunnelOverview(leadId, boardId, currentStageId, fetchLeadInstances, createLeadInstances, true);
};

export const invalidateLeadFunnelOverviewCache = (leadId: string, boardId: string | null, currentStageId: string | null) => {
  const cacheKey = `${leadId}:${boardId || ''}:${currentStageId || ''}`;
  funnelCache.delete(cacheKey);
  funnelRequests.delete(cacheKey);
};

export function LeadFunnelOverview({ leadId, boardId, currentStageId, boards = [], isClosed }: LeadFunnelOverviewProps) {
  const { fetchLeadInstances, updateInstanceItem, createLeadInstances } = useChecklists();
  const cacheKey = `${leadId}:${boardId || ''}:${currentStageId || ''}`;
  const cached = funnelCache.get(cacheKey);
  const [instances, setInstances] = useState<LeadChecklistInstance[]>(() => cached?.instances || []);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>(() => cached?.templateNames || {});
  const [loading, setLoading] = useState(() => !cached);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  const board = boards.find(b => b.id === boardId);

  useEffect(() => {
    loadData();
  }, [leadId, boardId, currentStageId]);

  // Auto-expand current stage
  useEffect(() => {
    if (currentStageId) {
      setExpandedStages(prev => new Set([...prev, currentStageId]));
    }
  }, [currentStageId]);

  const loadData = async (force = false) => {
    if (!funnelCache.has(cacheKey)) setLoading(true);
    try {
      const payload = await loadLeadFunnelOverview(leadId, boardId, currentStageId, fetchLeadInstances, createLeadInstances, force);
      setInstances(payload.instances);
      setTemplateNames(payload.templateNames);
    } finally {
      setLoading(false);
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

  const toggleStage = (stageId: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Lead não está vinculado a nenhum funil.
      </div>
    );
  }

  const stages = board.stages;
  const currentIndex = stages.findIndex(s => s.id === currentStageId);

  // Get instances per stage
  const getStageInstances = (stageId: string) => instances.filter(i => i.stage_id === stageId);

  // Determine stage status
  const getStageStatus = (stage: KanbanStage, index: number): 'completed' | 'current' | 'pending' => {
    if (stage.id === currentStageId) return 'current';
    if (index < currentIndex) return 'completed';
    return 'pending';
  };

  // Calculate progress for a stage
  const getStageProgress = (stageId: string) => {
    const stageInsts = getStageInstances(stageId);
    if (stageInsts.length === 0) return null;
    const totalItems = stageInsts.reduce((sum, i) => sum + i.items.length, 0);
    const checkedItems = stageInsts.reduce((sum, i) => sum + i.items.filter(it => it.checked).length, 0);
    return { total: totalItems, checked: checkedItems, percent: totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0 };
  };

  // Overall progress
  const totalStages = stages.length;
  const completedStages = stages.filter((_, i) => i < currentIndex).length;
  const overallPercent = totalStages > 0 ? Math.round(((completedStages + (currentIndex >= 0 ? 0.5 : 0)) / totalStages) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Header with overall progress */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-medium" style={{ borderColor: board.color, color: board.color }}>
            {board.name}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Fase {currentIndex + 1} de {totalStages}
          </span>
        </div>
        <span className="text-xs font-medium text-muted-foreground">{overallPercent}%</span>
      </div>

      {/* Overall progress bar */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="h-2 rounded-full bg-primary transition-all"
          style={{ width: `${overallPercent}%` }}
        />
      </div>

      {/* Stages list */}
      <div className="space-y-1">
        {stages.map((stage, index) => {
          const status = getStageStatus(stage, index);
          const progress = getStageProgress(stage.id);
          const stageInsts = getStageInstances(stage.id);
          const isExpanded = expandedStages.has(stage.id);
          const hasContent = stageInsts.length > 0;

          return (
            <div key={stage.id} className="rounded-lg overflow-hidden">
              {/* Stage header */}
              <button
                onClick={() => toggleStage(stage.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  status === 'current' && "bg-primary/10 border border-primary/30",
                  status === 'completed' && "bg-muted/50",
                  status === 'pending' && "bg-muted/20 opacity-60",
                  "rounded-lg hover:bg-accent/40"
                )}
              >
                {/* Status indicator */}
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                  status === 'completed' && "bg-green-500 text-white",
                  status === 'current' && "bg-primary text-primary-foreground",
                  status === 'pending' && "bg-muted-foreground/20 text-muted-foreground",
                )}>
                  {status === 'completed' ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </div>

                {/* Stage name */}
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-sm font-medium truncate",
                    status === 'completed' && "text-muted-foreground line-through",
                    status === 'current' && "text-primary",
                    status === 'pending' && "text-muted-foreground"
                  )}>
                    {stage.name}
                  </div>
                  {progress && (
                    <div className="text-[10px] text-muted-foreground">
                      {progress.checked}/{progress.total} itens • {progress.percent}%
                    </div>
                  )}
                </div>

                {/* Stage color dot */}
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />

                {/* Expand indicator */}
                {hasContent && (
                  isExpanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* Expanded content: checklists */}
              {isExpanded && hasContent && (
                <div className="pl-9 pr-3 pb-2 pt-1 space-y-2">
                  {stageInsts.map(instance => {
                    const tplInfo = templateNames[instance.checklist_template_id];
                    const completedCount = instance.items.filter(i => i.checked).length;
                    const totalCount = instance.items.length;

                    return (
                      <div key={instance.id} className={cn("rounded-md border p-2 space-y-1.5", instance.is_readonly && "opacity-60")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium">{tplInfo?.name || 'Checklist'}</span>
                            {tplInfo?.is_mandatory && (
                              <Badge variant="destructive" className="text-[9px] h-3.5 px-1">Obrig.</Badge>
                            )}
                            {instance.is_readonly && <Lock className="h-3 w-3 text-muted-foreground" />}
                          </div>
                          <span className="text-[10px] text-muted-foreground">{completedCount}/{totalCount}</span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-muted rounded-full h-1">
                          <div
                            className={cn("h-1 rounded-full transition-all", instance.is_completed ? "bg-green-500" : "bg-primary")}
                            style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                          />
                        </div>

                        {/* Items */}
                        <div className="space-y-0.5">
                          {instance.items.map(item => (
                            <div key={item.id} className="space-y-0.5">
                              <label className={cn(
                                "flex items-center gap-2 py-0.5 text-xs",
                                instance.is_readonly ? "cursor-default" : "cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1"
                              )}>
                                <Checkbox
                                  checked={item.checked || false}
                                  onCheckedChange={() => handleToggleItem(instance, item.id)}
                                  disabled={instance.is_readonly}
                                  className="h-3.5 w-3.5"
                                />
                                <span className={cn("flex-1", item.checked && "line-through text-muted-foreground")}>
                                  {item.label}
                                </span>
                                {item.script && <MessageSquareText className="h-3 w-3 text-primary shrink-0" />}
                                {item.docChecklist && item.docChecklist.length > 0 && <ClipboardList className="h-3 w-3 text-orange-500 shrink-0" />}
                              </label>

                              {/* Script */}
                              {item.script && !instance.is_readonly && (
                                <div className="ml-5 p-1.5 rounded bg-primary/5 border border-primary/20">
                                  <div className="flex items-center gap-1 mb-0.5">
                                    <MessageSquareText className="h-2.5 w-2.5 text-primary" />
                                    <span className="text-[9px] font-semibold text-primary uppercase">Script</span>
                                  </div>
                                  <p className="text-[11px] text-foreground whitespace-pre-wrap">{item.script}</p>
                                </div>
                              )}

                              {/* DocChecklist */}
                              {item.docChecklist && item.docChecklist.length > 0 && !instance.is_readonly && (() => {
                                const checklistType = item.docChecklist[0]?.type || 'documentos';
                                const typeInfo = CHECKLIST_TYPES.find(t => t.value === checklistType) || CHECKLIST_TYPES[0];
                                return (
                                  <div className="ml-5 p-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <ClipboardList className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
                                      <span className="text-[9px] font-semibold text-orange-700 dark:text-orange-400 uppercase">
                                        {typeInfo.icon} {typeInfo.label}
                                      </span>
                                    </div>
                                    <div className="space-y-0.5">
                                      {item.docChecklist.map(doc => (
                                        <div key={doc.id} className="flex items-center gap-1.5 text-[10px] py-0.5">
                                          <span className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />
                                          {doc.label}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

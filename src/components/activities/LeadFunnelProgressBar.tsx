import { useState, useEffect, useCallback, useMemo } from 'react';

import { externalSupabase } from '@/integrations/supabase/external-client';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, X, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useChecklists, CHECKLIST_TYPES } from '@/hooks/useChecklists';
import { useAuthContext } from '@/contexts/AuthContext';
import { askStepTiming } from '@/components/checklists/askStepTiming';
import { calculateHierarchicalProgress } from './progress/calculateHierarchicalProgress';

interface Stage {
  id: string;
  name: string;
  color: string;
}

interface DocChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
  type?: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  docChecklist?: DocChecklistItem[];
}

interface ChecklistInstance {
  id: string;
  stage_id: string;
  checklist_template_id: string;
  items: ChecklistItem[];
  is_completed: boolean;
  is_readonly: boolean;
  template_name?: string;
}

interface LeadFunnelProgressBarProps {
  leadId: string;
  boardId: string | null;
}

export function LeadFunnelProgressBar({ leadId, boardId }: LeadFunnelProgressBarProps) {
  const { user } = useAuthContext();
  const [stages, setStages] = useState<Stage[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  // Ordem projetada dos objetivos por fase: `${stage_id}::${template_id}` → display_order.
  // Sem isso a lista sai por created_at (objetivo novo pula pro topo e o funil
  // parece "começar" no último objetivo adicionado).
  const [linkOrder, setLinkOrder] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  const [_loading, setLoading] = useState(true);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  const [isLeadClosed, setIsLeadClosed] = useState(false);
  const [boardName, setBoardName] = useState<string>('');
  const [boardType, setBoardType] = useState<string>('');
  const { createLeadInstances, fetchLeadInstances } = useChecklists();

  const fetchData = useCallback(async () => {
    if (!leadId || !boardId) {
      setLoading(false);
      return;
    }

    try {
      const [boardRes, historyRes, leadRes, linksRes] = await Promise.all([
        externalSupabase.from('kanban_boards').select('stages, board_type, name').eq('id', boardId).maybeSingle(),
        externalSupabase.from('lead_stage_history').select('to_stage').eq('lead_id', leadId).order('changed_at', { ascending: false }).limit(1),
        externalSupabase.from('leads').select('status, lead_status, became_client_date, board_id').eq('id', leadId).maybeSingle(),
        externalSupabase.from('checklist_stage_links').select('stage_id, checklist_template_id, display_order').eq('board_id', boardId),
      ]);
      setBoardName((boardRes.data as any)?.name || '');
      setBoardType((boardRes.data as any)?.board_type || '');

      // Mapa da ordem projetada de cada objetivo dentro da fase.
      const orderMap: Record<string, number> = {};
      ((linksRes.data as any[]) || []).forEach(l => {
        orderMap[`${l.stage_id}::${l.checklist_template_id}`] = l.display_order ?? 0;
      });
      setLinkOrder(orderMap);

      // Lead is "closed" only when we're showing its sales funnel (not a process workflow)
      const leadData = leadRes.data as any;
      const boardData = boardRes.data as any;
      const isShowingSalesFunnel = boardData?.board_type !== 'workflow' && leadData?.board_id === boardId;
      const isClosed = isShowingSalesFunnel && (leadData?.lead_status === 'closed' || !!leadData?.became_client_date);
      setIsLeadClosed(isClosed);

      let stageId: string | null = null;
      let parsedStages: Stage[] = [];
      if (boardRes.data?.stages) {
        parsedStages = boardRes.data.stages as unknown as Stage[];
        setStages(parsedStages);
      }

      // Try history first, then fall back to lead.status
      if (historyRes.data && historyRes.data.length > 0) {
        stageId = historyRes.data[0].to_stage;
      }
      
      // If no history or stageId doesn't match any board stage, use lead.status
      if (!stageId || !parsedStages.some(s => s.id === stageId)) {
        const leadStatus = leadRes.data?.status;
        if (leadStatus && parsedStages.some(s => s.id === leadStatus)) {
          stageId = leadStatus;
        }
      }

      // For process workflows (board different from lead's funnel), the lead.status
      // belongs to another board and won't match. Default to first stage so the user
      // sees the workflow steps.
      const isWorkflowBoard = (boardData?.board_type === 'workflow') || (leadData?.board_id !== boardId);
      if ((!stageId || !parsedStages.some(s => s.id === stageId)) && isWorkflowBoard && parsedStages.length > 0) {
        stageId = parsedStages[0].id;
      }
      
      if (stageId) {
        setCurrentStageId(stageId);
      }

      // Create instances. For workflow boards, create for ALL stages so every
      // objective/step is visible when navigating between phases.
      if (isWorkflowBoard) {
        for (const s of parsedStages) {
          await createLeadInstances(leadId, boardId, s.id);
        }
      } else if (stageId) {
        await createLeadInstances(leadId, boardId, stageId);
      }

      // Fetch all instances and filter by current board (process workflow vs sales funnel)
      const allInstancesRaw = await fetchLeadInstances(leadId);
      const allInstances = allInstancesRaw.filter(i => i.board_id === boardId);

      if (allInstances.length > 0) {
        const templateIds = [...new Set(allInstances.map(i => i.checklist_template_id))];
        let templateNames: Record<string, string> = {};
        if (templateIds.length > 0) {
          const { data: templates } = await externalSupabase
            .from('checklist_templates')
            .select('id, name')
            .in('id', templateIds);
          (templates || []).forEach(t => { templateNames[t.id] = t.name; });
        }

        setInstances(allInstances.map(i => ({
          ...i,
          items: (i.items as unknown as ChecklistItem[]) || [],
          template_name: templateNames[i.checklist_template_id] || 'Passos',
        })));
      }
    } catch (err) {
      console.error('Error loading funnel progress:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId, boardId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({
        items: updatedItems as any,
        is_completed: updatedItems.every(item => item.checked),
        completed_at: updatedItems.every(item => item.checked) ? new Date().toISOString() : null,
      })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar passo');
      return;
    }

    // #8: loga o passo recém-MARCADO por pessoa (user_activity_log via RPC).
    // Fire-and-forget; só quando marca (não no desmarcar). Antes do log,
    // pergunta se o passo é de agora ou retroativo (não conta no ranking).
    const toggled = updatedItems.find(it => it.id === itemId);
    if (toggled?.checked && user?.id) {
      const userId = user.id;
      askStepTiming().then(retroactive => {
        (externalSupabase as any).rpc('log_checklist_step', {
          p_user_id: userId,
          p_instance_id: instance.id,
          p_item_label: toggled.label,
          p_retroactive: retroactive,
        }).then((res: { error?: { message?: string } | null }) => {
          if (res?.error) console.warn('[LeadFunnelProgressBar] log de passo falhou:', res.error.message);
        });
      });
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? { ...i, items: updatedItems, is_completed: updatedItems.every(item => item.checked) }
        : i
    ));
  };

  // Marca/desmarca um item do checklist ASSOCIADO ao passo (docChecklist).
  // É sub-item: persiste só o doc.checked no JSON de items; NÃO altera a
  // conclusão do passo (is_completed) nem entra no ranking (log_checklist_step).
  const handleToggleDocItem = async (instance: ChecklistInstance, itemId: string, docId: string) => {
    if (instance.is_readonly) return;

    const updatedItems = instance.items.map(item => {
      if (item.id !== itemId) return item;
      const docs = (item.docChecklist || []).map(d =>
        d.id === docId ? { ...d, checked: !d.checked } : d
      );
      return { ...item, docChecklist: docs };
    });

    const { error } = await externalSupabase
      .from('lead_checklist_instances')
      .update({ items: JSON.parse(JSON.stringify(updatedItems)) })
      .eq('id', instance.id);

    if (error) {
      toast.error('Erro ao atualizar checklist do passo');
      return;
    }

    setInstances(prev => prev.map(i =>
      i.id === instance.id ? { ...i, items: updatedItems } : i
    ));
  };

  // Hierarchical progress calculation — if lead is closed, always 100%
  const hierarchicalProgress = useMemo(() => {
    if (isLeadClosed) {
      // Return 100% for all stages when lead is closed
      const stageIds = stages.map(s => s.id);
      const phaseWeight = stageIds.length > 0 ? 100 / stageIds.length : 0;
      return {
        globalPercent: 100,
        stageDetails: stageIds.map(stageId => {
          const stageInstances = instances.filter(i => i.stage_id === stageId);
          return {
            stageId,
            stagePercent: phaseWeight,
            completedPercent: phaseWeight,
            objectives: stageInstances.map(inst => ({
              instanceId: inst.id,
              objectiveWeight: stageInstances.length > 0 ? phaseWeight / stageInstances.length : 0,
              totalSteps: inst.items.length,
              completedSteps: inst.items.length,
              completedPercent: stageInstances.length > 0 ? phaseWeight / stageInstances.length : 0,
            })),
          };
        }),
      };
    }
    const stageIds = stages.map(s => s.id);
    return calculateHierarchicalProgress(stageIds, instances);
  }, [stages, instances, isLeadClosed]);

  const globalPercent = hierarchicalProgress.globalPercent;

  // Determine current stage index
  const currentIdx = stages.findIndex(s => s.id === currentStageId);

  const activeViewStageId = viewingStageId || currentStageId;

  // Get instances for the viewed stage, na ordem projetada do fluxo (display_order),
  // não na ordem de criação. Órfãos (template sem link na fase) vão pro fim.
  const currentStageInstances = useMemo(() => {
    const orderOf = (i: ChecklistInstance) =>
      linkOrder[`${i.stage_id}::${i.checklist_template_id}`] ?? Number.MAX_SAFE_INTEGER;
    return instances
      .filter(i => i.stage_id === activeViewStageId)
      .slice()
      .sort((a, b) => {
        const diff = orderOf(a) - orderOf(b);
        if (diff !== 0) return diff;
        return ((a as any).created_at || '').localeCompare((b as any).created_at || '');
      });
  }, [instances, activeViewStageId, linkOrder]);

  if (!boardId || stages.length === 0) return null;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      {/* Stepper bar — always visible, segments clickable to switch stage view, click toggles expand */}
      <div className="w-full mt-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
          >
            {stages.map((stage, idx) => {
              const stageDetail = hierarchicalProgress.stageDetails.find(d => d.stageId === stage.id);
              const stageWeight = stageDetail?.stagePercent || 0;
              const stageCompleted = stageDetail?.completedPercent || 0;
              const fillPercent = stageWeight > 0 ? (stageCompleted / stageWeight) * 100 : 0;
              const isStageComplete = fillPercent >= 100;
              const hasPartialProgress = fillPercent > 0 && !isStageComplete;
              const isCurrent = idx === currentIdx;
              const isViewing = stage.id === activeViewStageId;

              const stageObjectives = instances
                .filter(i => i.stage_id === stage.id)
                .map(i => i.template_name)
                .filter(Boolean) as string[];
              const prefix = boardName
                ? `${boardType === 'workflow' ? 'POP' : 'Funil'}: ${boardName}\n`
                : '';
              const objLine = stageObjectives.length > 0
                ? `\n• ${stageObjectives.join('\n• ')}`
                : '';
              const tooltip = `${prefix}${stage.name} — ${Math.round(fillPercent)}%${objLine}`;

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!expanded) setExpanded(true);
                    setViewingStageId(stage.id === currentStageId ? null : stage.id);
                  }}
                  className="flex items-center flex-1 relative group/seg"
                  title={tooltip}
                >
                  <div
                    className={cn(
                      "h-2 w-full rounded-full transition-all overflow-hidden",
                      isStageComplete ? "bg-emerald-500" : "bg-muted-foreground/20",
                      "group-hover/seg:opacity-80"
                    )}
                  >
                    {hasPartialProgress && (
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${fillPercent}%` }}
                      />
                    )}
                  </div>
                  {(isCurrent || isViewing) && !isStageComplete && (
                    <div className={cn(
                      "absolute inset-0 rounded-full pointer-events-none",
                      isViewing ? "ring-2 ring-primary" : "ring-2 ring-primary/40"
                    )} />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs shrink-0 hover:opacity-80 transition-opacity"
          >
            <span className={cn(
              "font-bold tabular-nums min-w-[34px] text-right",
              globalPercent >= 100 ? "text-emerald-600" : "text-foreground"
            )}>
              {Math.round(globalPercent)}%
            </span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Single label line — current stage only when collapsed */}
        {!expanded && currentStageId && (
          <div className="mt-1.5 text-[11px] text-muted-foreground truncate">
            <span className="font-medium text-foreground">
              {stages.find(s => s.id === currentStageId)?.name}
            </span>
            <span className="ml-1.5">· fase {currentIdx + 1} de {stages.length}</span>
          </div>
        )}
      </div>

      <CollapsibleContent>
        <div className="mt-3 space-y-2 max-h-[320px] overflow-y-auto">
          {/* Stage navigator: prev | current name + position | next */}
          {(() => {
            const viewIdx = stages.findIndex(s => s.id === activeViewStageId);
            const viewStage = stages[viewIdx];
            const goPrev = () => viewIdx > 0 && setViewingStageId(stages[viewIdx - 1].id === currentStageId ? null : stages[viewIdx - 1].id);
            const goNext = () => viewIdx < stages.length - 1 && setViewingStageId(stages[viewIdx + 1].id === currentStageId ? null : stages[viewIdx + 1].id);
            const isViewingCurrent = activeViewStageId === currentStageId;
            return (
              <div className="flex items-center justify-between gap-2 px-1 py-1.5 rounded-md bg-muted/40">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={viewIdx <= 0}
                  className="p-1 rounded hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Fase anterior"
                >
                  <ChevronUp className="h-4 w-4 -rotate-90" />
                </button>
                <div className="flex-1 min-w-0 text-center">
                  <div className="text-xs font-semibold truncate">{viewStage?.name || '—'}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Fase {viewIdx + 1} de {stages.length}
                    {!isViewingCurrent && <span className="ml-1.5 text-primary">· visualizando</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={viewIdx >= stages.length - 1}
                  className="p-1 rounded hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Próxima fase"
                >
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Minimizar detalhes do fluxo"
                  title="Minimizar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })()}

          {/* Current stage checklists with objective percentages */}
          {currentStageInstances.length > 0 ? (
            currentStageInstances.map(instance => {
              const objDetail = hierarchicalProgress.stageDetails
                .find(d => d.stageId === activeViewStageId)
                ?.objectives.find(o => o.instanceId === instance.id);
              const objPercent = objDetail && objDetail.objectiveWeight > 0
                ? Math.round((objDetail.completedPercent / objDetail.objectiveWeight) * 100)
                : 0;

              return (
                <div key={instance.id} className="bg-muted/30 rounded-lg p-2 border border-border/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium">{instance.template_name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {instance.items.filter(i => i.checked).length}/{instance.items.length}
                      </span>
                      <span className={cn(
                        "text-[10px] font-semibold",
                        objPercent >= 100 ? "text-emerald-600" : "text-primary"
                      )}>
                        {objPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {instance.items.map(item => {
                      // Calculate individual step weight
                      const stepWeight = objDetail && objDetail.totalSteps > 0
                        ? (objDetail.objectiveWeight / objDetail.totalSteps)
                        : 0;

                      return (
                        <div key={item.id} className="space-y-0.5">
                          <label
                            className={cn(
                              "flex items-start gap-2 py-0.5 text-xs rounded px-1 -mx-1",
                              instance.is_readonly ? "cursor-default" : "cursor-pointer hover:bg-accent/50",
                            )}
                          >
                            <Checkbox
                              checked={item.checked || false}
                              onCheckedChange={() => handleToggleItem(instance, item.id)}
                              disabled={instance.is_readonly}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <span className={cn(item.checked && "line-through text-muted-foreground")}>
                                {item.label}
                              </span>
                              {item.description && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>
                              )}
                            </div>
                            {stepWeight > 0 && (
                              <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5">
                                {stepWeight.toFixed(1)}%
                              </span>
                            )}
                          </label>

                          {/* Checklist associado ao passo (documentos/requisitos/etc.):
                              antes nem aparecia aqui — agora é visível e marcável. */}
                          {item.docChecklist && item.docChecklist.length > 0 && (() => {
                            const checklistType = item.docChecklist[0]?.type || 'documentos';
                            const typeInfo = CHECKLIST_TYPES.find(t => t.value === checklistType) || CHECKLIST_TYPES[0];
                            const docDone = item.docChecklist.filter(d => d.checked).length;
                            return (
                              <div className="ml-6 p-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                                <div className="flex items-center gap-1 mb-0.5">
                                  <ClipboardList className="h-2.5 w-2.5 text-orange-600 dark:text-orange-400" />
                                  <span className="text-[9px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">
                                    {typeInfo.icon} {typeInfo.label} · {docDone}/{item.docChecklist.length}
                                  </span>
                                </div>
                                <div className="space-y-0.5">
                                  {item.docChecklist.map(doc => (
                                    <label
                                      key={doc.id}
                                      className={cn(
                                        "flex items-center gap-1.5 text-[11px] py-0.5",
                                        instance.is_readonly ? "cursor-default" : "cursor-pointer",
                                      )}
                                    >
                                      <Checkbox
                                        checked={doc.checked || false}
                                        onCheckedChange={() => handleToggleDocItem(instance, item.id, doc.id)}
                                        disabled={instance.is_readonly}
                                        className="h-3 w-3"
                                      />
                                      <span className={cn(doc.checked && "line-through text-muted-foreground")}>
                                        {doc.label}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">
              Nenhum passo configurado para esta fase
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

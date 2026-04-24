import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ListChecks, MessageSquareText, ClipboardList, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActivityLogger } from '@/hooks/useActivityLogger';

interface ChecklistItem {
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
  items: ChecklistItem[];
  is_completed: boolean;
  is_readonly: boolean;
  template_name?: string;
  stage_name?: string;
}

interface LeadCardChecklistsProps {
  leadId: string;
  boardId: string;
  stageId: string;
}

function LeadCardChecklistsImpl({ leadId, boardId, stageId }: LeadCardChecklistsProps) {
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const { logActivity } = useActivityLogger();

  // DEV-only render counter (remove after perf validation)
  const renderCountRef = useRef(0);
  if (import.meta.env.DEV) {
    renderCountRef.current += 1;
    // Only log every 3rd render to reduce noise; flag suspicious >2
    if (renderCountRef.current === 1 || renderCountRef.current % 3 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[LeadCardChecklists ${leadId.slice(0, 8)}] render #${renderCountRef.current}`);
    }
  }

  const loadAndAutoCreate = useCallback(async () => {
    try {
      // 1. Fetch stage links for this board (which templates belong to which stages)
      const { data: stageLinks } = await supabase
        .from('checklist_stage_links')
        .select('checklist_template_id, stage_id')
        .eq('board_id', boardId);

      if (!stageLinks || stageLinks.length === 0) {
        setInstances([]);
        setLoaded(true);
        return;
      }

      // 2. Fetch existing instances for this lead+board
      const { data: existingInstances } = await supabase
        .from('lead_checklist_instances')
        .select('id, checklist_template_id, stage_id, items, is_completed, is_readonly')
        .eq('lead_id', leadId)
        .eq('board_id', boardId);

      // 3. Find missing instances (linked but not yet created)
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

        const templateItemsMap: Record<string, ChecklistItem[]> = {};
        (templates || []).forEach(t => {
          templateItemsMap[t.id] = ((t.items as unknown as ChecklistItem[]) || []).map(item => ({
            ...item,
            checked: false,
          }));
        });

        const newInstances = missingLinks
          .filter(l => templateItemsMap[l.checklist_template_id] && templateItemsMap[l.checklist_template_id].length > 0)
          .map(l => ({
            lead_id: leadId,
            board_id: boardId,
            stage_id: l.stage_id,
            checklist_template_id: l.checklist_template_id,
            items: JSON.parse(JSON.stringify(templateItemsMap[l.checklist_template_id])),
            is_completed: false,
            is_readonly: false,
          }));

        if (newInstances.length > 0) {
          // upsert evita duplicatas em race conditions (constraint única no banco)
          await supabase
            .from('lead_checklist_instances')
            .upsert(newInstances, {
              onConflict: 'lead_id,board_id,stage_id,checklist_template_id',
              ignoreDuplicates: true,
            });
        }
      }

      // 5. Re-fetch all instances after auto-creation
      const { data: allInstancesRaw } = await supabase
        .from('lead_checklist_instances')
        .select('id, checklist_template_id, stage_id, items, is_completed, is_readonly')
        .eq('lead_id', leadId)
        .eq('board_id', boardId)
        .order('created_at');

      // Defesa: deduplicar por (stage_id, checklist_template_id) caso ainda exista lixo
      // E descartar instâncias sem itens (template vazio) — não devem mostrar barra de progresso
      const seen = new Set<string>();
      const allInstances = (allInstancesRaw || []).filter(i => {
        const key = `${i.stage_id}_${i.checklist_template_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const items = (i.items as unknown as ChecklistItem[]) || [];
        if (items.length === 0) return false;
        return true;
      });

      if (allInstances.length === 0) {
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

      // 7. Fetch board stages for stage names
      const { data: boardData } = await supabase
        .from('kanban_boards')
        .select('stages')
        .eq('id', boardId)
        .single();

      const stageNameMap: Record<string, string> = {};
      if (boardData?.stages) {
        const stages = boardData.stages as unknown as { id: string; name: string }[];
        stages.forEach(s => { stageNameMap[s.id] = s.name; });
      }

      setInstances(allInstances.map(d => ({
        ...d,
        items: (d.items as unknown as ChecklistItem[]) || [],
        template_name: nameMap[d.checklist_template_id] || 'Objetivo',
        stage_name: stageNameMap[d.stage_id] || d.stage_id,
      })));

      // Keep collapsed by default - user expands to tick items
      setExpandedPhase(null);
    } catch (error) {
      console.error('Error loading checklists:', error);
    } finally {
      setLoaded(true);
    }
  }, [leadId, boardId, stageId]);

  useEffect(() => {
    loadAndAutoCreate();
  }, [loadAndAutoCreate]);

  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    const targetItem = instance.items.find(i => i.id === itemId);
    const willBeChecked = !targetItem?.checked;

    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    const allChecked = updatedItems.every(i => i.checked);

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

  // Calculate overall progress
  const totalItems = instances.reduce((sum, i) => sum + i.items.length, 0);
  const checkedItems = instances.reduce((sum, i) => sum + i.items.filter(it => it.checked).length, 0);
  const overallPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  // Group instances by stage_id
  const instancesByStage: Record<string, ChecklistInstance[]> = {};
  instances.forEach(inst => {
    if (!instancesByStage[inst.stage_id]) {
      instancesByStage[inst.stage_id] = [];
    }
    instancesByStage[inst.stage_id].push(inst);
  });

  // Get current stage instances for the collapsible preview
  const currentStageInstances = instancesByStage[stageId] || [];
  const currentStageName = currentStageInstances[0]?.stage_name || '';
  const currentStageTotal = currentStageInstances.reduce((s, i) => s + i.items.length, 0);
  const currentStageChecked = currentStageInstances.reduce((s, i) => s + i.items.filter(it => it.checked).length, 0);

  return (
    <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} draggable={false}>
      {/* Overall progress bar (clickable to expand/collapse items) */}
      <button
        type="button"
        onClick={() => setItemsExpanded(v => !v)}
        className="flex items-center gap-1.5 w-full hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
        title={itemsExpanded ? 'Recolher tarefas' : 'Exibir tarefas'}
      >
        <ListChecks className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <Progress value={overallPercent} className="h-1.5 flex-1" />
        <span className={cn(
          "text-[10px] font-medium min-w-[32px] text-right",
          overallPercent === 100 ? "text-green-600" : "text-muted-foreground"
        )}>
          {overallPercent}%
        </span>
        {itemsExpanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
      </button>

      {/* Current phase items - only when expanded */}
      {itemsExpanded && currentStageInstances.length > 0 && (
        <div className="space-y-0.5">
          {currentStageInstances.map(instance => (
            <div key={instance.id} className="space-y-0.5">
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
                        <p className="text-[10px] font-semibold mb-1">Script de Contato</p>
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
                        <p className="text-[10px]">{item.docChecklist.length} itens de checklist</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Memoized export — re-renders only when leadId/boardId/stageId actually change.
// This is the main lever to stop the 500+ card cascade re-render on Realtime UPDATEs.
export const LeadCardChecklists = memo(LeadCardChecklistsImpl, (prev, next) =>
  prev.leadId === next.leadId &&
  prev.boardId === next.boardId &&
  prev.stageId === next.stageId
);

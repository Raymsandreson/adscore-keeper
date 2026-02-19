import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ListChecks, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityLogger } from '@/hooks/useActivityLogger';

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
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

export function LeadCardChecklists({ leadId, boardId, stageId }: LeadCardChecklistsProps) {
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const { logActivity } = useActivityLogger();

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
          .filter(l => templateItemsMap[l.checklist_template_id])
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
          await supabase.from('lead_checklist_instances').insert(newInstances);
        }
      }

      // 5. Re-fetch all instances after auto-creation
      const { data: allInstances } = await supabase
        .from('lead_checklist_instances')
        .select('id, checklist_template_id, stage_id, items, is_completed, is_readonly')
        .eq('lead_id', leadId)
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
      {/* Overall progress bar */}
      <div className="flex items-center gap-1.5">
        <ListChecks className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <Progress value={overallPercent} className="h-1.5 flex-1" />
        <span className={cn(
          "text-[10px] font-medium min-w-[32px] text-right",
          overallPercent === 100 ? "text-green-600" : "text-muted-foreground"
        )}>
          {overallPercent}%
        </span>
      </div>

      {/* Current phase collapsible with objectives and steps */}
      {currentStageInstances.length > 0 && (
        <Collapsible
          open={expandedPhase === stageId}
          onOpenChange={(open) => setExpandedPhase(open ? stageId : null)}
        >
          <CollapsibleTrigger className="flex items-center gap-1 w-full text-left group hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
            <ChevronDown className={cn(
              "h-3 w-3 text-muted-foreground transition-transform",
              expandedPhase === stageId && "rotate-180"
            )} />
            <span className="text-[10px] font-medium truncate flex-1">
              {currentStageName}
            </span>
            <Badge
              variant={currentStageChecked === currentStageTotal && currentStageTotal > 0 ? "default" : "outline"}
              className={cn(
                "text-[9px] h-4 px-1",
                currentStageChecked === currentStageTotal && currentStageTotal > 0 && "bg-green-600 hover:bg-green-700"
              )}
            >
              {currentStageChecked}/{currentStageTotal}
            </Badge>
          </CollapsibleTrigger>

          <CollapsibleContent className="pl-2 space-y-0.5 mt-0.5">
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
                      "text-[10px] leading-tight",
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
      )}
    </div>
  );
}

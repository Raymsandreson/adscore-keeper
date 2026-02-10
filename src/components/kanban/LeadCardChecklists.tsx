import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ListChecks, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
}

interface ChecklistInstance {
  id: string;
  checklist_template_id: string;
  items: ChecklistItem[];
  is_completed: boolean;
  is_readonly: boolean;
  template_name?: string;
}

interface LeadCardChecklistsProps {
  leadId: string;
  boardId: string;
  stageId: string;
}

export function LeadCardChecklists({ leadId, boardId, stageId }: LeadCardChecklistsProps) {
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadInstances = useCallback(async () => {
    const { data, error } = await supabase
      .from('lead_checklist_instances')
      .select('id, checklist_template_id, items, is_completed, is_readonly')
      .eq('lead_id', leadId)
      .eq('board_id', boardId)
      .eq('stage_id', stageId)
      .eq('is_readonly', false);

    if (error || !data || data.length === 0) {
      setInstances([]);
      setLoaded(true);
      return;
    }

    // Fetch template names
    const templateIds = [...new Set(data.map(d => d.checklist_template_id))];
    const { data: templates } = await supabase
      .from('checklist_templates')
      .select('id, name')
      .in('id', templateIds);

    const nameMap: Record<string, string> = {};
    (templates || []).forEach(t => { nameMap[t.id] = t.name; });

    setInstances(data.map(d => ({
      ...d,
      items: (d.items as unknown as ChecklistItem[]) || [],
      template_name: nameMap[d.checklist_template_id] || 'Checklist',
    })));
    setLoaded(true);
  }, [leadId, boardId, stageId]);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  const handleToggleItem = async (instance: ChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

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

  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
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

      {/* Individual checklists */}
      {instances.map(instance => {
        const completed = instance.items.filter(i => i.checked).length;
        const total = instance.items.length;
        const isExpanded = expandedId === instance.id;

        return (
          <Collapsible
            key={instance.id}
            open={isExpanded}
            onOpenChange={(open) => setExpandedId(open ? instance.id : null)}
          >
            <CollapsibleTrigger className="flex items-center gap-1 w-full text-left group hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
              <ChevronDown className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                isExpanded && "rotate-180"
              )} />
              <span className="text-[10px] font-medium truncate flex-1">
                {instance.template_name}
              </span>
              <Badge
                variant={instance.is_completed ? "default" : "outline"}
                className={cn(
                  "text-[9px] h-4 px-1",
                  instance.is_completed && "bg-green-600 hover:bg-green-700"
                )}
              >
                {completed}/{total}
              </Badge>
            </CollapsibleTrigger>

            <CollapsibleContent className="pl-4 space-y-0.5 mt-0.5">
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
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useChecklists } from '@/hooks/useChecklists';
import { calculateHierarchicalProgress } from './progress/calculateHierarchicalProgress';

interface Stage {
  id: string;
  name: string;
  color: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
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
  const [stages, setStages] = useState<Stage[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  const { createLeadInstances, fetchLeadInstances } = useChecklists();

  const fetchData = useCallback(async () => {
    if (!leadId || !boardId) {
      setLoading(false);
      return;
    }

    try {
      const [boardRes, historyRes, leadRes] = await Promise.all([
        supabase.from('kanban_boards').select('stages').eq('id', boardId).maybeSingle(),
        supabase.from('lead_stage_history').select('to_stage').eq('lead_id', leadId).order('changed_at', { ascending: false }).limit(1),
        supabase.from('leads').select('status').eq('id', leadId).maybeSingle(),
      ]);

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
      
      if (stageId) {
        setCurrentStageId(stageId);
      }

      // Create instances if needed (same as WhatsAppLeadStageManager)
      if (stageId) {
        await createLeadInstances(leadId, boardId, stageId);
      }

      // Fetch all instances
      const allInstances = await fetchLeadInstances(leadId);

      if (allInstances.length > 0) {
        const templateIds = [...new Set(allInstances.map(i => i.checklist_template_id))];
        let templateNames: Record<string, string> = {};
        if (templateIds.length > 0) {
          const { data: templates } = await supabase
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

    const { error } = await supabase
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

    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? { ...i, items: updatedItems, is_completed: updatedItems.every(item => item.checked) }
        : i
    ));
  };

  // Hierarchical progress calculation
  const hierarchicalProgress = useMemo(() => {
    const stageIds = stages.map(s => s.id);
    return calculateHierarchicalProgress(stageIds, instances);
  }, [stages, instances]);

  const globalPercent = hierarchicalProgress.globalPercent;

  // Determine current stage index
  const currentIdx = stages.findIndex(s => s.id === currentStageId);

  const activeViewStageId = viewingStageId || currentStageId;

  // Get instances for the viewed stage
  const currentStageInstances = instances.filter(i => i.stage_id === activeViewStageId);
  const totalItems = currentStageInstances.reduce((sum, i) => sum + i.items.length, 0);
  const completedItems = currentStageInstances.reduce((sum, i) => sum + i.items.filter(item => item.checked).length, 0);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <button className="w-full mt-2 group cursor-pointer">
          {/* Compact progress bar */}
          <div className="flex items-center gap-2">
            {/* Stage dots */}
            <div className="flex items-center gap-1 flex-1">
              {stages.map((stage, idx) => {
                const isPast = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                // Check if this stage's checklist is fully completed
                const stageInstances = instances.filter(i => i.stage_id === stage.id);
                const stageTotal = stageInstances.reduce((s, i) => s + i.items.length, 0);
                const stageCompleted = stageInstances.reduce((s, i) => s + i.items.filter(it => it.checked).length, 0);
                const isStageComplete = stageTotal > 0 && stageCompleted === stageTotal;
                const hasPartialProgress = stageTotal > 0 && stageCompleted > 0 && !isStageComplete;
                const partialPercent = stageTotal > 0 ? (stageCompleted / stageTotal) * 100 : 0;

                return (
                  <div key={stage.id} className="flex items-center flex-1 relative">
                    {/* Background bar */}
                    <div
                      className={cn(
                        "h-2.5 w-full rounded-full transition-colors shadow-sm overflow-hidden",
                        isStageComplete ? "bg-green-500" :
                        isPast ? "bg-primary" :
                        "bg-muted-foreground/20"
                      )}
                      title={`${stage.name}${stageTotal > 0 ? ` (${stageCompleted}/${stageTotal})` : ''}`}
                    >
                      {/* Partial progress fill for current stage */}
                      {hasPartialProgress && isCurrent && (
                        <div
                          className="h-full bg-green-500/70 rounded-full transition-all duration-300"
                          style={{ width: `${partialPercent}%` }}
                        />
                      )}
                    </div>
                    {isCurrent && !isStageComplete && (
                      <div className="absolute inset-0 rounded-full ring-2 ring-primary/40 pointer-events-none" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 text-xs shrink-0">
              {currentStageId && (
                <Badge variant="default" className="text-[10px] px-2 py-0.5 h-5 font-semibold">
                  {stages.find(s => s.id === currentStageId)?.name || currentStageId}
                </Badge>
              )}
              {totalItems > 0 && (
                <span className="text-xs font-medium text-foreground">{completedItems}/{totalItems}</span>
              )}
              {expanded ? <ChevronUp className="h-3.5 w-3.5 text-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-foreground" />}
            </div>
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto">
          {/* Stage flow visualization */}
          <div className="flex flex-wrap gap-1 mb-2">
            {stages.map((stage, idx) => {
              const isPast = idx < currentIdx;
              const isCurrent = idx === currentIdx;
              const isViewing = stage.id === activeViewStageId;
              return (
                <button
                  key={stage.id}
                  onClick={(e) => { e.stopPropagation(); setViewingStageId(stage.id === currentStageId ? null : stage.id); }}
                  className={cn(
                    "inline-flex items-center text-[10px] px-1.5 py-0 h-5 rounded-full border transition-all font-medium",
                    isViewing && "ring-2 ring-primary/50",
                    isPast && "bg-primary/15 text-primary border-primary/30 hover:bg-primary/25 cursor-pointer",
                    isCurrent && "bg-primary text-primary-foreground border-primary cursor-pointer",
                    !isPast && !isCurrent && "opacity-70 text-muted-foreground border-border hover:opacity-100 cursor-pointer"
                  )}
                >
                  {isPast && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />}
                  {isCurrent && <Circle className="h-2.5 w-2.5 mr-0.5 fill-current" />}
                  {stage.name}
                </button>
              );
            })}
          </div>

          {/* Current stage checklists */}
          {currentStageInstances.length > 0 ? (
            currentStageInstances.map(instance => (
              <div key={instance.id} className="bg-muted/30 rounded-lg p-2 border border-border/50">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium">{instance.template_name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {instance.items.filter(i => i.checked).length}/{instance.items.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {instance.items.map(item => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2 py-0.5 text-xs cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1"
                    >
                      <Checkbox
                        checked={item.checked || false}
                        onCheckedChange={() => handleToggleItem(instance, item.id)}
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
                    </label>
                  ))}
                </div>
              </div>
            ))
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

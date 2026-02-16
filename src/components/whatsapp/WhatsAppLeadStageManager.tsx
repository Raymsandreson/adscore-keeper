import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, CheckSquare, ListChecks, Lock, Loader2 } from 'lucide-react';
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

  // Checklist state
  const { fetchLeadInstances, updateInstanceItem, createLeadInstances } = useChecklists();
  const [instances, setInstances] = useState<LeadChecklistInstance[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});
  const [loadingChecklist, setLoadingChecklist] = useState(true);

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
            stages: (data.stages as unknown as KanbanStage[]) || [],
          });
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

  return (
    <div className="px-3 py-2 space-y-2">
      {/* Stage selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">Fase:</span>
        <div className="flex items-center gap-1 flex-wrap flex-1">
          {board.stages.map((stage, idx) => {
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
          {changing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Checklist for current stage */}
      {!loadingChecklist && currentInstances.length > 0 && (
        <div className="space-y-1.5">
          {currentInstances.map(instance => {
            const info = templateNames[instance.checklist_template_id];
            const completedCount = instance.items.filter(i => i.checked).length;
            const totalCount = instance.items.length;
            const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

            return (
              <div key={instance.id} className="rounded-lg border bg-card/50 p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <CheckSquare className="h-3 w-3 text-primary" />
                    <span className="text-xs font-medium">{info?.name || 'Passos'}</span>
                    {info?.is_mandatory && (
                      <Badge variant="destructive" className="text-[8px] h-3 px-1">Obrigatório</Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{completedCount}/{totalCount}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1 mb-1.5">
                  <div
                    className={cn("h-1 rounded-full transition-all", instance.is_completed ? "bg-green-500" : "bg-primary")}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="space-y-0.5">
                  {instance.items.map(item => (
                    <label
                      key={item.id}
                      className="flex items-center gap-1.5 py-0.5 text-xs cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1"
                    >
                      <Checkbox
                        checked={item.checked || false}
                        onCheckedChange={() => handleToggleItem(instance, item.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span className={cn(item.checked ? 'line-through text-muted-foreground' : '')}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

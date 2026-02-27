import { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckSquare, Lock, ListChecks, RefreshCw, MessageSquareText, ClipboardList } from 'lucide-react';
import { useChecklists, LeadChecklistInstance, ChecklistItem, CHECKLIST_TYPES } from '@/hooks/useChecklists';
import { supabase } from '@/integrations/supabase/client';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { toast } from 'sonner';

interface LeadChecklistPanelProps {
  leadId: string;
  boardId: string | null;
  currentStageId: string | null;
  boards?: KanbanBoard[];
}

export function LeadChecklistPanel({ leadId, boardId, currentStageId, boards = [] }: LeadChecklistPanelProps) {
  const { fetchLeadInstances, updateInstanceItem, createLeadInstances } = useChecklists();
  const [instances, setInstances] = useState<LeadChecklistInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});

  useEffect(() => {
    loadAndEnsureInstances();
  }, [leadId, boardId, currentStageId]);

  const loadAndEnsureInstances = async () => {
    setLoading(true);
    
    // Auto-create instances for current stage if needed
    if (boardId && currentStageId) {
      await createLeadInstances(leadId, boardId, currentStageId);
    }

    const data = await fetchLeadInstances(leadId);

    // Reset readonly for instances that match the current stage
    if (currentStageId) {
      const readonlyCurrentStage = data.filter(i => i.stage_id === currentStageId && i.is_readonly);
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
      (templates || []).forEach(t => {
        names[t.id] = { name: t.name, is_mandatory: t.is_mandatory };
      });
      setTemplateNames(names);
    }

    setInstances(data);
    setLoading(false);
  };

  const handleToggleItem = async (instance: LeadChecklistInstance, itemId: string) => {
    if (instance.is_readonly) return;

    const updatedItems = instance.items.map(item =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    await updateInstanceItem(instance.id, updatedItems);

    // Update local state
    setInstances(prev => prev.map(i =>
      i.id === instance.id
        ? {
            ...i,
            items: updatedItems,
            is_completed: updatedItems.every(item => item.checked),
          }
        : i
    ));
  };

  const getStageName = (stageId: string) => {
    for (const board of boards) {
      const stage = board.stages.find(s => s.id === stageId);
      if (stage) return stage.name;
    }
    return stageId;
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground text-center py-4">Carregando checklists...</p>;
  }

  if (instances.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground space-y-3">
        <ListChecks className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhum checklist vinculado a esta fase</p>
      </div>
    );
  }

  // Group by stage
  const currentInstances = instances.filter(i => i.stage_id === currentStageId && !i.is_readonly);
  const historyInstances = instances.filter(i => i.is_readonly || i.stage_id !== currentStageId);

  return (
    <div className="space-y-4">
      {currentInstances.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Fase Atual
          </h4>
          {currentInstances.map(instance => (
            <ChecklistInstanceCard
              key={instance.id}
              instance={instance}
              templateInfo={templateNames[instance.checklist_template_id]}
              onToggleItem={(itemId) => handleToggleItem(instance, itemId)}
            />
          ))}
        </div>
      )}

      {historyInstances.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            Histórico
          </h4>
          {historyInstances.map(instance => (
            <ChecklistInstanceCard
              key={instance.id}
              instance={instance}
              templateInfo={templateNames[instance.checklist_template_id]}
              stageName={getStageName(instance.stage_id)}
              onToggleItem={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistInstanceCard({
  instance,
  templateInfo,
  stageName,
  onToggleItem,
}: {
  instance: LeadChecklistInstance;
  templateInfo?: { name: string; is_mandatory: boolean };
  stageName?: string;
  onToggleItem: (itemId: string) => void;
}) {
  const completedCount = instance.items.filter(i => i.checked).length;
  const totalCount = instance.items.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Card className={`mb-2 ${instance.is_readonly ? 'opacity-70' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{templateInfo?.name || 'Checklist'}</span>
            {templateInfo?.is_mandatory && (
              <Badge variant="destructive" className="text-[10px] h-4">Obrigatório</Badge>
            )}
            {instance.is_readonly && (
              <Badge variant="secondary" className="text-[10px] h-4">
                <Lock className="h-2 w-2 mr-0.5" />
                {stageName}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{completedCount}/{totalCount}</span>
        </div>

        <div className="w-full bg-muted rounded-full h-1.5 mb-2">
          <div
            className={`h-1.5 rounded-full transition-all ${instance.is_completed ? 'bg-green-500' : 'bg-primary'}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="space-y-1">
          {instance.items.map(item => (
            <div key={item.id} className="space-y-1">
              <label
                className={`flex items-center gap-2 py-0.5 text-sm ${instance.is_readonly ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1'}`}
              >
                <Checkbox
                  checked={item.checked || false}
                  onCheckedChange={() => onToggleItem(item.id)}
                  disabled={instance.is_readonly}
                />
                <span className={item.checked ? 'line-through text-muted-foreground' : ''}>
                  {item.label}
                </span>
                {item.script && (
                  <MessageSquareText className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                )}
                {item.docChecklist && item.docChecklist.length > 0 && (
                  <ClipboardList className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                )}
              </label>

              {/* Script display */}
              {item.script && !instance.is_readonly && (
                <div className="ml-6 p-2 rounded-md bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-1.5 mb-1">
                    <MessageSquareText className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Script de Contato</span>
                  </div>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{item.script}</p>
                </div>
              )}

              {/* DocChecklist display */}
              {item.docChecklist && item.docChecklist.length > 0 && !instance.is_readonly && (() => {
                const checklistType = item.docChecklist[0]?.type || 'documentos';
                const typeInfo = CHECKLIST_TYPES.find(t => t.value === checklistType) || CHECKLIST_TYPES[0];
                return (
                  <div className="ml-6 p-2 rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40">
                    <div className="flex items-center gap-1.5 mb-1">
                      <ClipboardList className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                      <span className="text-[10px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {item.docChecklist.map(doc => (
                        <div key={doc.id} className="flex items-center gap-2 text-xs py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
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
      </CardContent>
    </Card>
  );
}

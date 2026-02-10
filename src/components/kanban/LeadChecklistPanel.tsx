import { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckSquare, Lock, ListChecks, RefreshCw } from 'lucide-react';
import { useChecklists, LeadChecklistInstance, ChecklistItem } from '@/hooks/useChecklists';
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
  const [generating, setGenerating] = useState(false);
  const [templateNames, setTemplateNames] = useState<Record<string, { name: string; is_mandatory: boolean }>>({});

  useEffect(() => {
    loadInstances();
  }, [leadId]);

  const loadInstances = async () => {
    setLoading(true);
    const data = await fetchLeadInstances(leadId);

    // Fetch template names
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

  const handleGenerateChecklists = async () => {
    if (!boardId || !currentStageId) return;
    setGenerating(true);
    try {
      await createLeadInstances(leadId, boardId, currentStageId);
      await loadInstances();
      toast.success('Checklists gerados para esta etapa!');
    } catch (e) {
      toast.error('Erro ao gerar checklists');
    } finally {
      setGenerating(false);
    }
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
        <p className="text-sm">Nenhum checklist vinculado a esta etapa</p>
        {boardId && currentStageId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateChecklists}
            disabled={generating}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Gerando...' : 'Gerar checklists desta etapa'}
          </Button>
        )}
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
            Etapa Atual
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
            <label
              key={item.id}
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
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

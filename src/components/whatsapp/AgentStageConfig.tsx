import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Loader2, Layers } from 'lucide-react';
import { useAgentStageAssignments } from '@/hooks/useAgentStageAssignments';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';

interface Props {
  agentId: string;
}

export function AgentStageConfig({ agentId }: Props) {
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [loadingBoards, setLoadingBoards] = useState(true);
  const { assignments, loading, setAgentStages, getStagesForAgent } = useAgentStageAssignments(agentId);

  useEffect(() => {
    const fetchBoards = async () => {
      const { data } = await supabase.from('kanban_boards').select('*').order('display_order');
      const parsed = (data || []).map(b => ({
        ...b,
        stages: (b.stages as unknown as KanbanStage[]) || [],
      })) as KanbanBoard[];
      setBoards(parsed);
      if (parsed.length > 0 && !selectedBoardId) {
        setSelectedBoardId(parsed[0].id);
      }
      setLoadingBoards(false);
    };
    fetchBoards();
  }, []);

  const selectedBoard = boards.find(b => b.id === selectedBoardId);
  const selectedStages = selectedBoard ? getStagesForAgent(agentId, selectedBoardId) : [];

  const handleToggleStage = async (stageId: string, checked: boolean) => {
    if (!selectedBoardId) return;
    const newStages = checked
      ? [...selectedStages, stageId]
      : selectedStages.filter(id => id !== stageId);
    await setAgentStages(agentId, selectedBoardId, newStages);
  };

  if (loadingBoards) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Nenhum funil encontrado</p>;
  }

  // Show all boards and which stages this agent covers
  const allAssignedBoards = boards.filter(b => 
    assignments.some(a => a.board_id === b.id)
  );

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium flex items-center gap-1.5 mb-2">
          <Layers className="h-4 w-4" />
          Configurar etapas do agente
        </Label>
        <p className="text-xs text-muted-foreground mb-3">
          Selecione em quais etapas de cada funil este agente deve atuar. Quando um lead mudar de etapa, o agente será trocado automaticamente.
        </p>
      </div>

      <div>
        <Label className="text-xs">Funil</Label>
        <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Selecione um funil" />
          </SelectTrigger>
          <SelectContent>
            {boards.map(b => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedBoard && (
        <Card className="p-3">
          <Label className="text-xs mb-2 block">Etapas de "{selectedBoard.name}"</Label>
          <div className="space-y-1.5">
            {selectedBoard.stages.map(stage => (
              <label key={stage.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 rounded px-2 py-1.5 transition-colors">
                <Checkbox
                  checked={selectedStages.includes(stage.id)}
                  onCheckedChange={(checked) => handleToggleStage(stage.id, !!checked)}
                  disabled={loading}
                />
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                <span className="flex-1">{stage.name}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      {/* Summary of all assignments */}
      {allAssignedBoards.length > 0 && (
        <div className="border-t pt-3">
          <Label className="text-xs text-muted-foreground mb-2 block">Resumo das atribuições</Label>
          <div className="space-y-2">
            {allAssignedBoards.map(board => {
              const stageIds = getStagesForAgent(agentId, board.id);
              const stages = board.stages.filter(s => stageIds.includes(s.id));
              return (
                <div key={board.id} className="flex items-start gap-2">
                  <span className="text-xs font-medium shrink-0">{board.name}:</span>
                  <div className="flex flex-wrap gap-1">
                    {stages.map(s => (
                      <Badge key={s.id} variant="secondary" className="text-[10px] gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

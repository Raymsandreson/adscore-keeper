import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Bot } from 'lucide-react';
import { useAgentStageAssignments } from '@/hooks/useAgentStageAssignments';
import { KanbanStage } from '@/hooks/useKanbanBoards';

interface Agent {
  id: string;
  name: string;
  is_active: boolean;
}

interface Props {
  boardId: string;
  stages: KanbanStage[];
}

export function StageAgentSelector({ boardId, stages }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const { assignments, loading, setStageAgent, getAgentForStage, fetchAssignments } = useAgentStageAssignments(undefined, boardId);

  useEffect(() => {
    const fetchAgents = async () => {
      const { data } = await supabase
        .from('whatsapp_ai_agents')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');
      setAgents((data || []) as Agent[]);
    };
    fetchAgents();
  }, []);

  const handleSetAgent = async (stageId: string, agentId: string) => {
    await setStageAgent(boardId, stageId, agentId === 'none' ? null : agentId);
  };

  if (agents.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-3">
        Nenhum agente IA ativo disponível
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium flex items-center gap-1.5">
        <Bot className="h-4 w-4" />
        Agente IA por Etapa
      </Label>
      <p className="text-xs text-muted-foreground">
        Defina qual agente IA deve atender em cada etapa. Ao mover o lead, o agente será trocado automaticamente.
      </p>
      <div className="space-y-1.5 mt-2">
        {stages.map(stage => {
          const currentAgent = getAgentForStage(boardId, stage.id);
          const agent = agents.find(a => a.id === currentAgent);
          return (
            <div key={stage.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-xs font-medium min-w-[80px] truncate">{stage.name}</span>
              <Select
                value={currentAgent || 'none'}
                onValueChange={(v) => handleSetAgent(stage.id, v)}
                disabled={loading}
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue placeholder="Sem agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Sem agente</SelectItem>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

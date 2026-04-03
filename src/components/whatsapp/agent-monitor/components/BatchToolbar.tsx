import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Square, CheckSquare, StopCircle, ArrowRightLeft, UserPlus, FastForward, RotateCcw } from 'lucide-react';
import type { ConversationDetail, AgentData } from '../types';

interface BatchToolbarProps {
  list: ConversationDetail[];
  selectedCount: number;
  agents: AgentData[];
  batchAgentId: string;
  setBatchAgentId: (id: string) => void;
  batchProcessing: boolean;
  onSelectAll: (list: ConversationDetail[]) => void;
  onClearSelection: () => void;
  onPause: () => void;
  onAssign: (agentId: string) => void;
  onSwap: (agentId: string) => void;
  onAnticipate: () => void;
  onResume: () => void;
}

export function BatchToolbar({
  list, selectedCount, agents, batchAgentId, setBatchAgentId, batchProcessing,
  onSelectAll, onClearSelection, onPause, onAssign, onSwap, onAnticipate, onResume,
}: BatchToolbarProps) {
  if (selectedCount === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onSelectAll(list)}>
          <CheckSquare className="h-3 w-3" /> Selecionar tudo ({list.length})
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg">
      <span className="text-xs font-medium">{selectedCount} selecionada(s)</span>
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={onClearSelection}>
        <Square className="h-3 w-3" /> Limpar
      </Button>
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => onSelectAll(list)}>
        <CheckSquare className="h-3 w-3" /> Todas
      </Button>
      <div className="border-l border-border h-4 mx-1" />
      <Button variant="destructive" size="sm" className="h-6 text-[10px] gap-1" disabled={batchProcessing} onClick={onPause}>
        <StopCircle className="h-3 w-3" /> Pausar agente
      </Button>
      <div className="flex items-center gap-1">
        <Select value={batchAgentId} onValueChange={setBatchAgentId}>
          <SelectTrigger className="h-6 text-[10px] w-[130px]">
            <SelectValue placeholder="Agente..." />
          </SelectTrigger>
          <SelectContent>
            {agents.map(a => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.shortcut_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" className="h-6 text-[10px] gap-1" disabled={!batchAgentId || batchProcessing}
          onClick={() => onAssign(batchAgentId)}>
          <UserPlus className="h-3 w-3" /> Atribuir
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" disabled={!batchAgentId || batchProcessing}
          onClick={() => onSwap(batchAgentId)}>
          <ArrowRightLeft className="h-3 w-3" /> Trocar
        </Button>
      </div>
      <div className="border-l border-border h-4 mx-1" />
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" disabled={batchProcessing} onClick={onAnticipate}>
        <FastForward className="h-3 w-3" /> Antecipar Follow-up
      </Button>
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 text-green-600" disabled={batchProcessing} onClick={onResume}>
        <RotateCcw className="h-3 w-3" /> Retomar Follow-up
      </Button>
    </div>
  );
}

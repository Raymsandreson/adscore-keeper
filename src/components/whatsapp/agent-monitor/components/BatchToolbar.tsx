import { Button } from '@/components/ui/button';
import { Square, CheckSquare, StopCircle, FastForward, RotateCcw } from 'lucide-react';
import type { ConversationDetail } from '../types';

interface BatchToolbarProps {
  list: ConversationDetail[];
  selectedCount: number;
  batchProcessing: boolean;
  onSelectAll: (list: ConversationDetail[]) => void;
  onClearSelection: () => void;
  onDeactivate: () => void;
  onAnticipate: () => void;
  onResume: () => void;
}

export function BatchToolbar({
  list,
  selectedCount,
  batchProcessing,
  onSelectAll,
  onClearSelection,
  onDeactivate,
  onAnticipate,
  onResume,
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
      <Button variant="destructive" size="sm" className="h-6 text-[10px] gap-1" disabled={batchProcessing} onClick={onDeactivate}>
        <StopCircle className="h-3 w-3" /> Desativar
      </Button>
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
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, Clock, LayoutGrid, Loader2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { KanbanBoard } from '@/hooks/useKanbanBoards';

interface LeadStageHistoryPanelProps {
  leadId: string;
  boards?: KanbanBoard[];
}

export function LeadStageHistoryPanel({ leadId, boards = [] }: LeadStageHistoryPanelProps) {
  const { history, loading, fetchHistory } = useLeadStageHistory();

  useEffect(() => {
    if (leadId) {
      fetchHistory(leadId);
    }
  }, [leadId, fetchHistory]);

  const getStageName = (stageId: string | null, boardId: string | null) => {
    if (!stageId) return 'Novo';
    
    // Try to find the stage name from boards
    if (boardId) {
      const board = boards.find(b => b.id === boardId);
      if (board) {
        const stage = board.stages.find(s => s.id === stageId);
        if (stage) return stage.name;
      }
    }
    
    // Fallback: Try all boards
    for (const board of boards) {
      const stage = board.stages.find(s => s.id === stageId);
      if (stage) return stage.name;
    }
    
    // Final fallback: Return the raw stage ID with some formatting
    return stageId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getStageColor = (stageId: string | null, boardId: string | null): string => {
    if (!stageId) return '#9ca3af';
    
    if (boardId) {
      const board = boards.find(b => b.id === boardId);
      if (board) {
        const stage = board.stages.find(s => s.id === stageId);
        if (stage) return stage.color;
      }
    }
    
    for (const board of boards) {
      const stage = board.stages.find(s => s.id === stageId);
      if (stage) return stage.color;
    }
    
    return '#6b7280';
  };

  const getBoardName = (boardId: string | null) => {
    if (!boardId) return null;
    const board = boards.find(b => b.id === boardId);
    return board?.name || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhuma movimentação registrada</p>
        <p className="text-xs mt-1">O histórico aparecerá quando o lead for movido entre estágios</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[280px] pr-4">
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
        
        <div className="space-y-4">
          {history.map((entry, index) => {
            const fromName = getStageName(entry.from_stage, entry.from_board_id);
            const toName = getStageName(entry.to_stage, entry.to_board_id);
            const fromColor = getStageColor(entry.from_stage, entry.from_board_id);
            const toColor = getStageColor(entry.to_stage, entry.to_board_id);
            const fromBoard = getBoardName(entry.from_board_id);
            const toBoard = getBoardName(entry.to_board_id);
            const changedBoardToo = fromBoard && toBoard && entry.from_board_id !== entry.to_board_id;

            return (
              <div key={entry.id} className="relative pl-8">
                {/* Timeline dot */}
                <div 
                  className="absolute left-1 top-2 w-4 h-4 rounded-full border-2 bg-background"
                  style={{ borderColor: toColor }}
                />
                
                <div className="bg-muted/30 rounded-lg p-3">
                  {/* Stage change */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge 
                      variant="outline" 
                      style={{ 
                        borderColor: fromColor,
                        color: fromColor,
                      }}
                      className="text-xs"
                    >
                      {fromName}
                    </Badge>
                    
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    
                    <Badge 
                      variant="outline"
                      style={{ 
                        borderColor: toColor,
                        color: toColor,
                        backgroundColor: `${toColor}15`,
                      }}
                      className="text-xs font-medium"
                    >
                      {toName}
                    </Badge>
                  </div>

                  {/* Board change indicator */}
                  {changedBoardToo && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <LayoutGrid className="h-3 w-3" />
                      <span>{fromBoard}</span>
                      <ArrowRight className="h-2 w-2" />
                      <span className="font-medium">{toBoard}</span>
                    </div>
                  )}

                  {/* Notes */}
                  {entry.notes && (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      {entry.notes}
                    </p>
                  )}

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span title={format(new Date(entry.changed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}>
                      {formatDistanceToNow(new Date(entry.changed_at), { 
                        addSuffix: true, 
                        locale: ptBR 
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

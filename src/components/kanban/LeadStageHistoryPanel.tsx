import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowRight, Clock, LayoutGrid, Loader2, Sparkles, User } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLeadStageHistory } from '@/hooks/useLeadStageHistory';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { supabase } from '@/integrations/supabase/client';

interface LeadStageHistoryPanelProps {
  leadId: string;
  boards?: KanbanBoard[];
}

interface StatusHistoryEntry {
  id: string;
  from_status: string;
  to_status: string;
  reason: string | null;
  changed_by: string | null;
  changed_by_type: string;
  changed_at: string;
}

const statusLabels: Record<string, string> = {
  active: 'Ativo',
  in_progress: 'Em Andamento',
  closed: 'Fechado',
  refused: 'Recusado',
  inviavel: 'Inviável',
  unviable: 'Inviável',
};

const statusColors: Record<string, string> = {
  active: '#3b82f6',
  in_progress: '#8b5cf6',
  closed: '#22c55e',
  refused: '#ef4444',
  inviavel: '#f59e0b',
  unviable: '#f59e0b',
};

export function LeadStageHistoryPanel({ leadId, boards = [] }: LeadStageHistoryPanelProps) {
  const { history, loading, fetchHistory } = useLeadStageHistory();
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (leadId) {
      fetchHistory(leadId);
      fetchStatusHistory(leadId);
    }
  }, [leadId, fetchHistory]);

  const fetchStatusHistory = async (id: string) => {
    const { data } = await supabase
      .from('lead_status_history' as any)
      .select('*')
      .eq('lead_id', id)
      .order('changed_at', { ascending: false });
    
    const entries = (data || []) as unknown as StatusHistoryEntry[];
    setStatusHistory(entries);

    // Resolve profile names
    const userIds = [
      ...entries.filter(e => e.changed_by).map(e => e.changed_by!),
      ...history.filter(e => e.changed_by).map(e => e.changed_by!),
    ].filter((v, i, a) => a.indexOf(v) === i);

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);
      
      const names: Record<string, string> = {};
      profiles?.forEach(p => { if (p.full_name) names[p.user_id] = p.full_name; });
      setProfileNames(names);
    }
  };

  // Also resolve names from stage history
  useEffect(() => {
    const userIds = history.filter(e => e.changed_by).map(e => e.changed_by!).filter((v, i, a) => a.indexOf(v) === i);
    if (userIds.length > 0) {
      supabase.from('profiles').select('user_id, full_name').in('user_id', userIds).then(({ data }) => {
        const names: Record<string, string> = { ...profileNames };
        data?.forEach(p => { if (p.full_name) names[p.user_id] = p.full_name; });
        setProfileNames(names);
      });
    }
  }, [history]);

  const getStageName = (stageId: string | null, boardId: string | null) => {
    if (!stageId) return 'Novo';
    if (boardId) {
      const board = boards.find(b => b.id === boardId);
      if (board) {
        const stage = board.stages.find(s => s.id === stageId);
        if (stage) return stage.name;
      }
    }
    for (const board of boards) {
      const stage = board.stages.find(s => s.id === stageId);
      if (stage) return stage.name;
    }
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
    return boards.find(b => b.id === boardId)?.name || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0 && statusHistory.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhuma movimentação registrada</p>
        <p className="text-xs mt-1">O histórico aparecerá quando o lead for movido entre fases</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[320px] pr-4">
      <div className="space-y-6">
        {/* Status History */}
        {statusHistory.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Histórico de Status</h4>
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
              <div className="space-y-3">
                {statusHistory.map((entry) => {
                  const isAI = entry.changed_by_type === 'ai';
                  const fromColor = statusColors[entry.from_status] || '#6b7280';
                  const toColor = statusColors[entry.to_status] || '#6b7280';
                  const changerName = entry.changed_by ? profileNames[entry.changed_by] : null;

                  return (
                    <div key={entry.id} className="relative pl-8">
                      <div 
                        className="absolute left-1 top-2 w-4 h-4 rounded-full border-2 bg-background flex items-center justify-center"
                        style={{ borderColor: toColor }}
                      >
                        {isAI && <Sparkles className="h-2 w-2" style={{ color: toColor }} />}
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" style={{ borderColor: fromColor, color: fromColor }} className="text-xs">
                            {statusLabels[entry.from_status] || entry.from_status}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <Badge variant="outline" style={{ borderColor: toColor, color: toColor, backgroundColor: `${toColor}15` }} className="text-xs font-medium">
                            {statusLabels[entry.to_status] || entry.to_status}
                          </Badge>
                          <Badge variant={isAI ? 'secondary' : 'outline'} className="text-[10px] h-5 gap-1">
                            {isAI ? <Sparkles className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                            {isAI ? 'IA' : (changerName || 'Manual')}
                          </Badge>
                        </div>
                        {entry.reason && (
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            {entry.reason}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span title={format(new Date(entry.changed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}>
                            {formatDistanceToNow(new Date(entry.changed_at), { addSuffix: true, locale: ptBR })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Stage History */}
        {history.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Histórico de Etapas</h4>
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
              <div className="space-y-3">
                {history.map((entry) => {
                  const fromName = getStageName(entry.from_stage, entry.from_board_id);
                  const toName = getStageName(entry.to_stage, entry.to_board_id);
                  const fromColor = getStageColor(entry.from_stage, entry.from_board_id);
                  const toColor = getStageColor(entry.to_stage, entry.to_board_id);
                  const fromBoard = getBoardName(entry.from_board_id);
                  const toBoard = getBoardName(entry.to_board_id);
                  const changedBoardToo = fromBoard && toBoard && entry.from_board_id !== entry.to_board_id;
                  const changerName = entry.changed_by ? profileNames[entry.changed_by] : null;

                  return (
                    <div key={entry.id} className="relative pl-8">
                      <div className="absolute left-1 top-2 w-4 h-4 rounded-full border-2 bg-background" style={{ borderColor: toColor }} />
                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" style={{ borderColor: fromColor, color: fromColor }} className="text-xs">
                            {fromName}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <Badge variant="outline" style={{ borderColor: toColor, color: toColor, backgroundColor: `${toColor}15` }} className="text-xs font-medium">
                            {toName}
                          </Badge>
                          {changerName && (
                            <Badge variant="outline" className="text-[10px] h-5 gap-1">
                              <User className="h-2.5 w-2.5" />
                              {changerName}
                            </Badge>
                          )}
                        </div>
                        {changedBoardToo && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <LayoutGrid className="h-3 w-3" />
                            <span>{fromBoard}</span>
                            <ArrowRight className="h-2 w-2" />
                            <span className="font-medium">{toBoard}</span>
                          </div>
                        )}
                        {entry.notes && (
                          <p className="text-xs text-muted-foreground mt-2 italic">{entry.notes}</p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span title={format(new Date(entry.changed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}>
                            {formatDistanceToNow(new Date(entry.changed_at), { addSuffix: true, locale: ptBR })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

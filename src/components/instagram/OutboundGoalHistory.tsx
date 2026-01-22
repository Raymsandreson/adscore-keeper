import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trophy, Calendar, Target, TrendingUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface GoalHistoryItem {
  id: string;
  target_rate: number;
  achieved_rate: number;
  total_sent: number;
  total_replies: number;
  achieved_at: string;
  period_start: string;
  period_end: string;
  notes: string | null;
}

export function OutboundGoalHistory() {
  const [history, setHistory] = useState<GoalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('outbound_goal_history')
        .select('*')
        .order('achieved_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('outbound-goal-history-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'outbound_goal_history' },
        (payload) => {
          setHistory(prev => [payload.new as GoalHistoryItem, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('outbound_goal_history')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setHistory(prev => prev.filter(h => h.id !== id));
      toast.success('Registro removido');
    } catch (error) {
      console.error('Erro ao remover:', error);
      toast.error('Erro ao remover registro');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Histórico de Metas Atingidas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Histórico de Metas Atingidas
          </CardTitle>
          <CardDescription>
            Nenhuma meta outbound atingida ainda
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Target className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm text-center">
              Defina uma meta de taxa de resposta e quando atingida, ela será registrada aqui automaticamente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-500" />
          Histórico de Metas Atingidas
        </CardTitle>
        <CardDescription>
          {history.length} meta{history.length !== 1 ? 's' : ''} registrada{history.length !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {history.map((item, index) => {
              const exceededBy = item.achieved_rate - item.target_rate;
              
              return (
                <div 
                  key={item.id} 
                  className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant="outline" 
                          className="bg-green-100 text-green-700 border-green-200"
                        >
                          {item.achieved_rate.toFixed(1)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Meta: {item.target_rate}%
                        </span>
                        {exceededBy > 0 && (
                          <span className="text-xs text-green-600 flex items-center gap-0.5">
                            <TrendingUp className="h-3 w-3" />
                            +{exceededBy.toFixed(1)}pp
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(item.achieved_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      
                      <div className="mt-1.5 text-xs text-muted-foreground">
                        <span>{item.total_replies} respostas de {item.total_sent} enviados</span>
                        <span className="mx-1.5">•</span>
                        <span>
                          Período: {format(new Date(item.period_start), 'dd/MM', { locale: ptBR })} - {format(new Date(item.period_end), 'dd/MM', { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  
                  {index === 0 && history.length > 1 && (
                    <Badge className="mt-2 bg-yellow-100 text-yellow-700 border-yellow-200">
                      🏆 Mais recente
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { 
  Clock, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp,
  Timer,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import { differenceInHours, differenceInDays } from 'date-fns';

interface StageTimeMetricsProps {
  board: KanbanBoard;
  leadIds: string[];
}

interface StageMetric {
  stageId: string;
  stageName: string;
  stageColor: string;
  avgHours: number;
  avgDays: number;
  totalTransitions: number;
  minHours: number;
  maxHours: number;
}

interface HistoryEntry {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
}

export function StageTimeMetrics({ board, leadIds }: StageTimeMetricsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      if (leadIds.length === 0) return;
      
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('lead_stage_history')
          .select('id, lead_id, from_stage, to_stage, changed_at')
          .in('lead_id', leadIds)
          .order('changed_at', { ascending: true });

        if (error) throw error;
        setHistory((data || []) as HistoryEntry[]);
      } catch (error) {
        console.error('Error fetching stage history:', error);
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      fetchHistory();
    }
  }, [leadIds, isOpen]);

  // Calculate time spent in each stage
  const stageMetrics = useMemo((): StageMetric[] => {
    if (history.length === 0) return [];

    // Group history by lead
    const historyByLead: Record<string, HistoryEntry[]> = {};
    history.forEach(entry => {
      if (!historyByLead[entry.lead_id]) {
        historyByLead[entry.lead_id] = [];
      }
      historyByLead[entry.lead_id].push(entry);
    });

    // Calculate time in each stage for each lead
    const stageTimesMap: Record<string, number[]> = {};
    
    Object.values(historyByLead).forEach(leadHistory => {
      // Sort by timestamp
      const sorted = leadHistory.sort((a, b) => 
        new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
      );

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const nextEntry = sorted[i + 1];
        
        if (nextEntry && entry.to_stage) {
          const hoursInStage = differenceInHours(
            new Date(nextEntry.changed_at),
            new Date(entry.changed_at)
          );
          
          if (!stageTimesMap[entry.to_stage]) {
            stageTimesMap[entry.to_stage] = [];
          }
          stageTimesMap[entry.to_stage].push(hoursInStage);
        }
      }
    });

    // Calculate metrics for each stage
    return board.stages.map(stage => {
      const times = stageTimesMap[stage.id] || [];
      
      if (times.length === 0) {
        return {
          stageId: stage.id,
          stageName: stage.name,
          stageColor: stage.color,
          avgHours: 0,
          avgDays: 0,
          totalTransitions: 0,
          minHours: 0,
          maxHours: 0,
        };
      }

      const totalHours = times.reduce((sum, t) => sum + t, 0);
      const avgHours = totalHours / times.length;

      return {
        stageId: stage.id,
        stageName: stage.name,
        stageColor: stage.color,
        avgHours: Math.round(avgHours * 10) / 10,
        avgDays: Math.round((avgHours / 24) * 10) / 10,
        totalTransitions: times.length,
        minHours: Math.min(...times),
        maxHours: Math.max(...times),
      };
    });
  }, [history, board.stages]);

  // Find the max avg time for relative progress bars
  const maxAvgHours = useMemo(() => {
    if (stageMetrics.length === 0) return 1;
    return Math.max(...stageMetrics.map(m => m.avgHours), 1);
  }, [stageMetrics]);

  // Calculate total pipeline time
  const totalPipelineTime = useMemo(() => {
    const totalHours = stageMetrics.reduce((sum, m) => sum + m.avgHours, 0);
    return {
      hours: Math.round(totalHours),
      days: Math.round((totalHours / 24) * 10) / 10,
    };
  }, [stageMetrics]);

  const formatTime = (hours: number) => {
    if (hours < 24) {
      return `${Math.round(hours)}h`;
    }
    const days = Math.round((hours / 24) * 10) / 10;
    return `${days}d`;
  };

  const hasData = stageMetrics.some(m => m.totalTransitions > 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-4">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Tempo Médio por Estágio
              </CardTitle>
              <div className="flex items-center gap-2">
                {hasData && !isOpen && (
                  <Badge variant="secondary" className="text-xs">
                    <Timer className="h-3 w-3 mr-1" />
                    Pipeline: {totalPipelineTime.days}d
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Calculando métricas...
              </div>
            ) : !hasData ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>Sem dados suficientes para calcular métricas</p>
                <p className="text-xs mt-1">Movimente leads entre estágios para gerar métricas</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Total pipeline time */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Tempo Total do Pipeline</span>
                  </div>
                  <Badge variant="default" className="text-sm">
                    {totalPipelineTime.days} dias
                  </Badge>
                </div>

                {/* Stage breakdown */}
                <div className="space-y-3">
                  {stageMetrics.map((metric, index) => (
                    <div key={metric.stageId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: metric.stageColor }}
                          />
                          <span className="text-sm">{metric.stageName}</span>
                          {index < stageMetrics.length - 1 && (
                            <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {metric.totalTransitions > 0 ? (
                            <>
                              <span className="text-xs text-muted-foreground">
                                ({metric.totalTransitions} leads)
                              </span>
                              <Badge 
                                variant="outline" 
                                className="text-xs font-medium"
                                style={{ 
                                  borderColor: metric.stageColor,
                                  color: metric.stageColor,
                                }}
                              >
                                {formatTime(metric.avgHours)}
                              </Badge>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </div>
                      
                      {metric.totalTransitions > 0 && (
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={(metric.avgHours / maxAvgHours) * 100} 
                            className="h-1.5 flex-1"
                            style={{
                              // @ts-ignore - custom CSS variable
                              '--progress-background': metric.stageColor,
                            } as React.CSSProperties}
                          />
                          <span className="text-[10px] text-muted-foreground w-16 text-right">
                            min: {formatTime(metric.minHours)} / max: {formatTime(metric.maxHours)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Insights */}
                {stageMetrics.some(m => m.avgDays > 7) && (
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      💡 Alguns estágios têm tempo médio acima de 7 dias. Considere revisar o processo ou configurar alertas de stagnação.
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

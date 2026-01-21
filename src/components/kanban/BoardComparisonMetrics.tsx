import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { differenceInHours } from 'date-fns';
import { KanbanBoard, KanbanStage } from '@/hooks/useKanbanBoards';
import { Lead } from '@/hooks/useLeads';

interface BoardComparisonMetricsProps {
  boards: KanbanBoard[];
  allLeads: Lead[];
}

interface HistoryEntry {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  from_board_id: string | null;
  to_board_id: string | null;
  changed_at: string;
}

interface BoardMetric {
  boardId: string;
  boardName: string;
  boardColor: string;
  totalLeads: number;
  avgTotalTime: number; // hours
  avgTimePerStage: number; // hours
  stagesCount: number;
  fastestStage: { name: string; avgHours: number } | null;
  slowestStage: { name: string; avgHours: number } | null;
  conversionRate: number;
  bottleneckStages: { name: string; avgHours: number }[];
}

export function BoardComparisonMetrics({ boards, allLeads }: BoardComparisonMetricsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all history when opened
  useEffect(() => {
    if (isOpen && history.length === 0) {
      fetchAllHistory();
    }
  }, [isOpen]);

  const fetchAllHistory = async () => {
    setLoading(true);
    try {
      const leadIds = allLeads.map(l => l.id);
      if (leadIds.length === 0) {
        setHistory([]);
        return;
      }

      const { data, error } = await supabase
        .from('lead_stage_history')
        .select('*')
        .in('lead_id', leadIds)
        .order('changed_at', { ascending: true });

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate metrics per board
  const boardMetrics: BoardMetric[] = useMemo(() => {
    if (boards.length === 0) return [];

    return boards.map(board => {
      const boardLeads = allLeads.filter(l => l.board_id === board.id);
      const leadIds = boardLeads.map(l => l.id);
      const boardHistory = history.filter(h => leadIds.includes(h.lead_id));

      // Group history by lead
      const historyByLead: Record<string, HistoryEntry[]> = {};
      boardHistory.forEach(entry => {
        if (!historyByLead[entry.lead_id]) {
          historyByLead[entry.lead_id] = [];
        }
        historyByLead[entry.lead_id].push(entry);
      });

      // Calculate time per stage
      const stageTimeMap: Record<string, { totalHours: number; count: number }> = {};
      board.stages.forEach(stage => {
        stageTimeMap[stage.id] = { totalHours: 0, count: 0 };
      });

      Object.values(historyByLead).forEach(entries => {
        const sorted = entries.sort(
          (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
        );

        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i];
          const next = sorted[i + 1];
          const hours = differenceInHours(
            new Date(next.changed_at),
            new Date(current.changed_at)
          );

          if (stageTimeMap[current.to_stage]) {
            stageTimeMap[current.to_stage].totalHours += hours;
            stageTimeMap[current.to_stage].count += 1;
          }
        }
      });

      // Calculate stage averages
      const stageAverages = board.stages.map(stage => {
        const data = stageTimeMap[stage.id];
        return {
          id: stage.id,
          name: stage.name,
          avgHours: data.count > 0 ? data.totalHours / data.count : 0,
        };
      });

      const validAverages = stageAverages.filter(s => s.avgHours > 0);
      const fastest = validAverages.length > 0
        ? validAverages.reduce((a, b) => a.avgHours < b.avgHours ? a : b)
        : null;
      const slowest = validAverages.length > 0
        ? validAverages.reduce((a, b) => a.avgHours > b.avgHours ? a : b)
        : null;

      // Find bottlenecks (stages with > 7 days avg)
      const bottleneckStages = stageAverages
        .filter(s => s.avgHours > 168) // 7 days = 168 hours
        .sort((a, b) => b.avgHours - a.avgHours);

      // Calculate total pipeline time
      const totalAvgTime = stageAverages.reduce((sum, s) => sum + s.avgHours, 0);
      const avgPerStage = validAverages.length > 0
        ? totalAvgTime / validAverages.length
        : 0;

      // Conversion rate
      const converted = boardLeads.filter(l => l.status === 'converted').length;
      const conversionRate = boardLeads.length > 0
        ? (converted / boardLeads.length) * 100
        : 0;

      return {
        boardId: board.id,
        boardName: board.name,
        boardColor: board.color,
        totalLeads: boardLeads.length,
        avgTotalTime: totalAvgTime,
        avgTimePerStage: avgPerStage,
        stagesCount: board.stages.length,
        fastestStage: fastest ? { name: fastest.name, avgHours: fastest.avgHours } : null,
        slowestStage: slowest ? { name: slowest.name, avgHours: slowest.avgHours } : null,
        conversionRate,
        bottleneckStages: bottleneckStages.map(s => ({ name: s.name, avgHours: s.avgHours })),
      };
    });
  }, [boards, allLeads, history]);

  // Find overall insights
  const insights = useMemo(() => {
    if (boardMetrics.length < 2) return null;

    const validBoards = boardMetrics.filter(b => b.avgTotalTime > 0);
    if (validBoards.length < 2) return null;

    const fastestBoard = validBoards.reduce((a, b) =>
      a.avgTotalTime < b.avgTotalTime ? a : b
    );
    const slowestBoard = validBoards.reduce((a, b) =>
      a.avgTotalTime > b.avgTotalTime ? a : b
    );
    const highestConversion = boardMetrics.reduce((a, b) =>
      a.conversionRate > b.conversionRate ? a : b
    );
    const totalBottlenecks = boardMetrics.reduce(
      (sum, b) => sum + b.bottleneckStages.length,
      0
    );

    return {
      fastestBoard,
      slowestBoard,
      highestConversion,
      totalBottlenecks,
      timeDifference: slowestBoard.avgTotalTime - fastestBoard.avgTotalTime,
    };
  }, [boardMetrics]);

  const formatTime = (hours: number): string => {
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    return `${days.toFixed(1)} dias`;
  };

  // Find max time for progress scaling
  const maxTime = useMemo(() => {
    return Math.max(...boardMetrics.map(b => b.avgTotalTime), 1);
  }, [boardMetrics]);

  if (boards.length < 2) return null;

  return (
    <Card className="border-l-4 border-l-primary">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-5 w-5 text-primary" />
                Comparativo de Pipelines
                <Badge variant="secondary" className="ml-2">
                  {boards.length} quadros
                </Badge>
              </CardTitle>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Carregando dados...
              </div>
            ) : (
              <>
                {/* Insights Summary */}
                {insights && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Card className="bg-green-500/10 border-green-500/30">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-2 text-green-600">
                          <TrendingUp className="h-4 w-4" />
                          <span className="text-xs font-medium">Mais Rápido</span>
                        </div>
                        <p className="font-semibold text-sm mt-1 truncate">
                          {insights.fastestBoard.boardName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(insights.fastestBoard.avgTotalTime)} total
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="bg-red-500/10 border-red-500/30">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-2 text-red-600">
                          <TrendingDown className="h-4 w-4" />
                          <span className="text-xs font-medium">Mais Lento</span>
                        </div>
                        <p className="font-semibold text-sm mt-1 truncate">
                          {insights.slowestBoard.boardName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(insights.slowestBoard.avgTotalTime)} total
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="bg-primary/10 border-primary/30">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-2 text-primary">
                          <Target className="h-4 w-4" />
                          <span className="text-xs font-medium">Maior Conversão</span>
                        </div>
                        <p className="font-semibold text-sm mt-1 truncate">
                          {insights.highestConversion.boardName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {insights.highestConversion.conversionRate.toFixed(1)}% de taxa
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="bg-amber-500/10 border-amber-500/30">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-2 text-amber-600">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-xs font-medium">Gargalos</span>
                        </div>
                        <p className="font-semibold text-sm mt-1">
                          {insights.totalBottlenecks} estágio(s)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          acima de 7 dias
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Board Comparison Table */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">
                    Tempo Médio por Pipeline
                  </h4>

                  {boardMetrics.map((metric) => (
                    <div
                      key={metric.boardId}
                      className="space-y-2 p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: metric.boardColor }}
                          />
                          <span className="font-medium text-sm">
                            {metric.boardName}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {metric.totalLeads} leads
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">
                            {metric.stagesCount} estágios
                          </span>
                          <Badge
                            variant={metric.conversionRate > 20 ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {metric.conversionRate.toFixed(1)}% conversão
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Tempo total no pipeline</span>
                          <span className="font-medium text-foreground">
                            {formatTime(metric.avgTotalTime)}
                          </span>
                        </div>
                        <Progress
                          value={(metric.avgTotalTime / maxTime) * 100}
                          className="h-2"
                          style={{
                            // @ts-ignore
                            '--progress-background': metric.boardColor,
                          }}
                        />
                      </div>

                      <div className="flex flex-wrap gap-4 text-xs pt-1">
                        {metric.fastestStage && (
                          <div className="flex items-center gap-1">
                            <TrendingUp className="h-3 w-3 text-green-500" />
                            <span className="text-muted-foreground">Mais rápido:</span>
                            <span className="font-medium">
                              {metric.fastestStage.name} ({formatTime(metric.fastestStage.avgHours)})
                            </span>
                          </div>
                        )}
                        {metric.slowestStage && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-amber-500" />
                            <span className="text-muted-foreground">Mais lento:</span>
                            <span className="font-medium">
                              {metric.slowestStage.name} ({formatTime(metric.slowestStage.avgHours)})
                            </span>
                          </div>
                        )}
                      </div>

                      {metric.bottleneckStages.length > 0 && (
                        <div className="flex items-center gap-2 pt-1">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-xs text-amber-600">
                            Gargalos: {metric.bottleneckStages.map(s => s.name).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Recommendations */}
                {insights && insights.timeDifference > 24 && (
                  <Card className="bg-muted/50">
                    <CardContent className="py-3 px-4">
                      <h4 className="font-medium text-sm flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-primary" />
                        Recomendação
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        O pipeline "{insights.slowestBoard.boardName}" leva{' '}
                        <strong>{formatTime(insights.timeDifference)}</strong> a mais que "{insights.fastestBoard.boardName}". 
                        Analise os estágios mais lentos para otimizar o fluxo.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

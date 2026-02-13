import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent,
  ChartConfig
} from '@/components/ui/chart';
import { FunnelChart, Funnel, LabelList, Cell, ResponsiveContainer } from 'recharts';
import { TrendingDown, TrendingUp, Filter, ArrowDown, AlertTriangle } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';

interface ConversionAlert {
  fromStage: string;
  toStage: string;
  currentRate: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

interface StageFunnelChartProps {
  board: KanbanBoard;
  leadsPerStage: Record<string, number>;
  conversionAlerts?: ConversionAlert[];
}

export function StageFunnelChart({ board, leadsPerStage, conversionAlerts = [] }: StageFunnelChartProps) {
  const funnelData = useMemo(() => {
    if (!board?.stages?.length) return [];

    const data = board.stages.map((stage, index) => {
      const count = leadsPerStage[stage.id] || 0;
      const previousCount = index > 0 
        ? (leadsPerStage[board.stages[index - 1].id] || 0) 
        : count;
      
      const conversionRate = previousCount > 0 
        ? Math.round((count / previousCount) * 100) 
        : 100;
      
      const dropOffRate = previousCount > 0 
        ? Math.round(((previousCount - count) / previousCount) * 100) 
        : 0;

      return {
        name: stage.name,
        value: count,
        color: stage.color,
        conversionRate,
        dropOffRate,
        isFirst: index === 0,
        previousCount
      };
    });

    return data;
  }, [board, leadsPerStage]);

  const totalLeads = funnelData[0]?.value || 0;
  const finalLeads = funnelData[funnelData.length - 1]?.value || 0;
  const overallConversion = totalLeads > 0 
    ? Math.round((finalLeads / totalLeads) * 100) 
    : 0;

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    board?.stages?.forEach(stage => {
      config[stage.name] = {
        label: stage.name,
        color: stage.color
      };
    });
    return config;
  }, [board]);

  if (!board?.stages?.length) {
    return null;
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Funil de Conversão</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {overallConversion}% conversão total
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Visualização do fluxo de leads entre estágios
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Funnel Visual */}
          <div className="space-y-1 min-w-0 overflow-hidden">
            {funnelData.map((stage, index) => {
              const widthPercentage = totalLeads > 0 
                ? Math.max(20, (stage.value / totalLeads) * 100) 
                : 100;
              
              return (
                <div key={stage.name} className="relative">
                  <div 
                    className="h-10 rounded-md flex items-center justify-between px-3 transition-all duration-300 hover:opacity-90"
                    style={{ 
                      backgroundColor: stage.color,
                      width: `${widthPercentage}%`,
                      marginLeft: `${(100 - widthPercentage) / 2}%`
                    }}
                  >
                    <span className="text-white text-xs font-medium truncate">
                      {stage.name}
                    </span>
                    <span className="text-white text-xs font-bold">
                      {stage.value}
                    </span>
                  </div>
                  
                  {/* Drop-off indicator */}
                  {index < funnelData.length - 1 && (
                    <div className="flex items-center justify-center py-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowDown className="h-3 w-3" />
                        {(() => {
                          const nextStage = funnelData[index + 1];
                          const hasAlert = conversionAlerts.some(
                            a => a.fromStage === stage.name && a.toStage === nextStage.name
                          );
                          
                          if (nextStage.dropOffRate > 0) {
                            return (
                              <span className={`flex items-center gap-0.5 ${hasAlert ? 'text-destructive font-medium' : 'text-destructive'}`}>
                                {hasAlert && <AlertTriangle className="h-3 w-3" />}
                                <TrendingDown className="h-3 w-3" />
                                -{nextStage.dropOffRate}%
                              </span>
                            );
                          }
                          return (
                            <span className="text-green-500 flex items-center gap-0.5">
                              <TrendingUp className="h-3 w-3" />
                              0%
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Metrics Table */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Detalhamento por Estágio
            </div>
            <div className="space-y-1.5">
                {funnelData.map((stage, index) => {
                  const hasAlert = index > 0 && conversionAlerts.some(
                    a => a.fromStage === funnelData[index - 1].name && a.toStage === stage.name
                  );
                  
                  return (
                    <div 
                      key={stage.name}
                      className={`flex items-center justify-between p-2 rounded-md transition-colors ${
                        hasAlert 
                          ? 'bg-destructive/10 border border-destructive/20' 
                          : 'bg-muted/30 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="text-xs font-medium truncate max-w-[120px]">
                          {stage.name}
                        </span>
                        {hasAlert && (
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-mono font-medium">
                          {stage.value} leads
                        </span>
                        {!stage.isFirst && (
                          <Badge 
                            variant={stage.conversionRate >= 50 ? "default" : hasAlert ? "destructive" : "secondary"}
                            className="text-[10px] px-1.5"
                          >
                            {stage.conversionRate}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Summary */}
            <div className="pt-2 mt-2 border-t border-border/50">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-md bg-primary/10">
                  <div className="text-lg font-bold text-primary">{totalLeads}</div>
                  <div className="text-[10px] text-muted-foreground">Entrada</div>
                </div>
                <div className="p-2 rounded-md bg-green-500/10">
                  <div className="text-lg font-bold text-green-500">{finalLeads}</div>
                  <div className="text-[10px] text-muted-foreground">Saída</div>
                </div>
                <div className="p-2 rounded-md bg-destructive/10">
                  <div className="text-lg font-bold text-destructive">{totalLeads - finalLeads}</div>
                  <div className="text-[10px] text-muted-foreground">Perdidos</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

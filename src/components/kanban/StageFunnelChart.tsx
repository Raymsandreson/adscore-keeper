import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, TrendingUp, Filter, AlertTriangle } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { cn } from '@/lib/utils';

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

  const maxValue = useMemo(() => Math.max(...funnelData.map(s => s.value), 1), [funnelData]);
  const totalLeads = funnelData[0]?.value || 0;
  const finalLeads = funnelData[funnelData.length - 1]?.value || 0;
  const overallConversion = totalLeads > 0 
    ? Math.round((finalLeads / totalLeads) * 100) 
    : 0;

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
      <CardContent className="pt-2 space-y-3">
        {/* Unified funnel rows */}
        <div className="space-y-1.5">
          {funnelData.map((stage, index) => {
            const widthPercent = Math.max(12, (stage.value / maxValue) * 100);
            const hasAlert = index > 0 && conversionAlerts.some(
              a => a.fromStage === funnelData[index - 1].name && a.toStage === stage.name
            );

            return (
              <div key={stage.name}>
                {/* Drop-off between stages */}
                {index > 0 && (
                  <div className="flex items-center justify-center py-0.5">
                    <span className={cn(
                      "text-[10px] flex items-center gap-0.5",
                      hasAlert ? "text-destructive font-medium" : stage.dropOffRate > 0 ? "text-muted-foreground" : "text-green-600"
                    )}>
                      {hasAlert && <AlertTriangle className="h-2.5 w-2.5" />}
                      {stage.dropOffRate > 0 ? (
                        <><TrendingDown className="h-2.5 w-2.5" /> -{stage.dropOffRate}%</>
                      ) : (
                        <><TrendingUp className="h-2.5 w-2.5" /> 0%</>
                      )}
                    </span>
                  </div>
                )}

                {/* Stage row */}
                <div className={cn(
                  "flex items-center gap-3 p-1.5 rounded-lg transition-colors",
                  hasAlert ? "bg-destructive/5" : "hover:bg-muted/30"
                )}>
                  {/* Bar */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="h-8 rounded-md flex items-center justify-between px-2.5 transition-all duration-300"
                      style={{
                        backgroundColor: stage.color,
                        width: `${widthPercent}%`,
                      }}
                    >
                      <span className="text-white text-[11px] font-medium truncate mr-1">
                        {stage.name}
                      </span>
                      <span className="text-white text-xs font-bold shrink-0">
                        {stage.value}
                      </span>
                    </div>
                  </div>

                  {/* Conversion badge */}
                  <div className="shrink-0 w-14 text-right">
                    {!stage.isFirst && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 font-mono",
                          hasAlert && "border-destructive/40 text-destructive",
                          !hasAlert && stage.conversionRate >= 50 && "border-green-500/40 text-green-600",
                        )}
                      >
                        {stage.conversionRate}%
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-border/50">
          <div className="p-2 rounded-md bg-primary/10">
            <div className="text-lg font-bold text-primary">{totalLeads}</div>
            <div className="text-[10px] text-muted-foreground">Entrada</div>
          </div>
          <div className="p-2 rounded-md bg-green-500/10">
            <div className="text-lg font-bold text-green-600">{finalLeads}</div>
            <div className="text-[10px] text-muted-foreground">Saída</div>
          </div>
          <div className="p-2 rounded-md bg-destructive/10">
            <div className="text-lg font-bold text-destructive">{totalLeads - finalLeads}</div>
            <div className="text-[10px] text-muted-foreground">Perdidos</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

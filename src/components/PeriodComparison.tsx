import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Minus, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { MetricData } from "@/hooks/useMetaAPI";

interface PeriodComparisonProps {
  currentMetrics: MetricData;
  isConnected: boolean;
}

const PeriodComparison = ({ currentMetrics, isConnected }: PeriodComparisonProps) => {
  // Simulated previous period data (in a real app, this would come from API)
  const previousMetrics: MetricData = {
    cpc: currentMetrics.cpc * (1 + (Math.random() * 0.4 - 0.2)),
    ctr: currentMetrics.ctr * (1 + (Math.random() * 0.4 - 0.2)),
    cpm: currentMetrics.cpm * (1 + (Math.random() * 0.4 - 0.2)),
    conversionRate: currentMetrics.conversionRate * (1 + (Math.random() * 0.4 - 0.2)),
    hookRate: currentMetrics.hookRate * (1 + (Math.random() * 0.4 - 0.2)),
    spend: currentMetrics.spend * (1 + (Math.random() * 0.4 - 0.2)),
    impressions: Math.round(currentMetrics.impressions * (1 + (Math.random() * 0.4 - 0.2))),
    clicks: Math.round(currentMetrics.clicks * (1 + (Math.random() * 0.4 - 0.2))),
    conversions: Math.round(currentMetrics.conversions * (1 + (Math.random() * 0.4 - 0.2))),
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  };

  const getChangeIcon = (change: number, invertColors: boolean = false) => {
    if (Math.abs(change) < 1) return <Minus className="h-4 w-4 text-muted-foreground" />;
    const isPositive = change > 0;
    const isGood = invertColors ? !isPositive : isPositive;
    
    if (isPositive) {
      return <ArrowUp className={`h-4 w-4 ${isGood ? 'text-emerald-500' : 'text-red-500'}`} />;
    }
    return <ArrowDown className={`h-4 w-4 ${isGood ? 'text-emerald-500' : 'text-red-500'}`} />;
  };

  const getChangeBadge = (change: number, invertColors: boolean = false) => {
    const isPositive = change > 0;
    const isGood = invertColors ? !isPositive : isPositive;
    
    if (Math.abs(change) < 1) {
      return <Badge variant="secondary" className="text-xs">~0%</Badge>;
    }
    
    return (
      <Badge 
        variant={isGood ? "default" : "destructive"}
        className={`text-xs ${isGood ? 'bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/30' : 'bg-red-500/20 text-red-600 hover:bg-red-500/30'}`}
      >
        {isPositive ? '+' : ''}{change.toFixed(1)}%
      </Badge>
    );
  };

  const metrics = [
    { 
      label: 'CPC', 
      current: currentMetrics.cpc, 
      previous: previousMetrics.cpc, 
      format: (v: number) => `R$ ${v.toFixed(2)}`,
      invertColors: true // Lower is better
    },
    { 
      label: 'CTR', 
      current: currentMetrics.ctr, 
      previous: previousMetrics.ctr, 
      format: (v: number) => `${v.toFixed(2)}%`,
      invertColors: false // Higher is better
    },
    { 
      label: 'CPM', 
      current: currentMetrics.cpm, 
      previous: previousMetrics.cpm, 
      format: (v: number) => `R$ ${v.toFixed(2)}`,
      invertColors: true // Lower is better
    },
    { 
      label: 'Taxa de Conversão', 
      current: currentMetrics.conversionRate, 
      previous: previousMetrics.conversionRate, 
      format: (v: number) => `${v.toFixed(2)}%`,
      invertColors: false // Higher is better
    },
    { 
      label: 'Gasto', 
      current: currentMetrics.spend, 
      previous: previousMetrics.spend, 
      format: (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      invertColors: false // Neutral
    },
    { 
      label: 'Impressões', 
      current: currentMetrics.impressions, 
      previous: previousMetrics.impressions, 
      format: (v: number) => v.toLocaleString('pt-BR'),
      invertColors: false // Higher is better
    },
    { 
      label: 'Cliques', 
      current: currentMetrics.clicks, 
      previous: previousMetrics.clicks, 
      format: (v: number) => v.toLocaleString('pt-BR'),
      invertColors: false // Higher is better
    },
    { 
      label: 'Conversões', 
      current: currentMetrics.conversions, 
      previous: previousMetrics.conversions, 
      format: (v: number) => v.toLocaleString('pt-BR'),
      invertColors: false // Higher is better
    },
  ];

  const overallPerformance = metrics.reduce((acc, m) => {
    const change = calculateChange(m.current, m.previous);
    return acc + (m.invertColors ? -change : change);
  }, 0) / metrics.length;

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Comparação de Períodos</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Semana atual vs. semana anterior
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {overallPerformance > 0 ? (
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            ) : overallPerformance < 0 ? (
              <TrendingDown className="h-5 w-5 text-red-500" />
            ) : (
              <Minus className="h-5 w-5 text-muted-foreground" />
            )}
            <Badge 
              variant={overallPerformance > 0 ? "default" : overallPerformance < 0 ? "destructive" : "secondary"}
              className={overallPerformance > 0 ? 'bg-emerald-500/20 text-emerald-600' : overallPerformance < 0 ? 'bg-red-500/20 text-red-600' : ''}
            >
              Performance Geral: {overallPerformance > 0 ? '+' : ''}{overallPerformance.toFixed(1)}%
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <div className="text-center py-8 text-muted-foreground">
            Conecte-se ao Meta Business Manager para ver a comparação de períodos
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric) => {
              const change = calculateChange(metric.current, metric.previous);
              return (
                <div 
                  key={metric.label}
                  className="p-4 rounded-lg bg-background/50 border border-border/30 hover:border-border/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-muted-foreground">{metric.label}</span>
                    {getChangeBadge(change, metric.invertColors)}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Atual</span>
                      <span className="text-lg font-semibold text-foreground">
                        {metric.format(metric.current)}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Anterior</span>
                      <span className="text-sm text-muted-foreground">
                        {metric.format(metric.previous)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2">
                    {getChangeIcon(change, metric.invertColors)}
                    <span className="text-xs text-muted-foreground">
                      {Math.abs(change) < 1 ? 'Sem variação' : 
                        change > 0 ? `Aumento de ${Math.abs(change).toFixed(1)}%` : 
                        `Redução de ${Math.abs(change).toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PeriodComparison;
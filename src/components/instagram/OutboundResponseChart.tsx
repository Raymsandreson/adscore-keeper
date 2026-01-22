import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Prospect {
  id: string;
  created_at: string;
  comment_type: string;
  metadata: { is_third_party?: boolean; is_prospect_reply?: boolean } | null;
}

interface OutboundResponseChartProps {
  prospects: Prospect[];
  period: string;
}

export function OutboundResponseChart({ prospects, period }: OutboundResponseChartProps) {
  const chartData = useMemo(() => {
    const days = Math.min(parseInt(period), 30); // Max 30 days for readability
    const endDate = new Date();
    const startDate = subDays(endDate, days - 1);
    
    const dateRange = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Accumulate data day by day
    let cumulativeSent = 0;
    let cumulativeReplies = 0;
    
    const data = dateRange.map(date => {
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      
      // Count sent outbound comments up to this day
      const daySent = prospects.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && 
               createdAt <= dayEnd && 
               p.comment_type === 'sent' && 
               p.metadata?.is_third_party;
      }).length;
      
      // Count replies received up to this day
      const dayReplies = prospects.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && 
               createdAt <= dayEnd && 
               (p.comment_type === 'reply_to_outbound' || p.metadata?.is_prospect_reply);
      }).length;
      
      cumulativeSent += daySent;
      cumulativeReplies += dayReplies;
      
      // Calculate cumulative response rate
      const responseRate = cumulativeSent > 0 
        ? parseFloat(((cumulativeReplies / cumulativeSent) * 100).toFixed(1))
        : 0;
      
      return {
        date: format(date, 'dd/MM', { locale: ptBR }),
        fullDate: format(date, "dd 'de' MMM", { locale: ptBR }),
        enviados: daySent,
        respostas: dayReplies,
        taxaAcumulada: responseRate,
        totalEnviados: cumulativeSent,
        totalRespostas: cumulativeReplies,
      };
    });
    
    return data;
  }, [prospects, period]);

  // Calculate trend (comparing first half vs second half)
  const trend = useMemo(() => {
    if (chartData.length < 4) return { direction: 'stable' as const, value: 0 };
    
    const midpoint = Math.floor(chartData.length / 2);
    const firstHalf = chartData.slice(0, midpoint);
    const secondHalf = chartData.slice(midpoint);
    
    const avgFirst = firstHalf.reduce((sum, d) => sum + d.taxaAcumulada, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, d) => sum + d.taxaAcumulada, 0) / secondHalf.length;
    
    const diff = avgSecond - avgFirst;
    
    if (Math.abs(diff) < 1) return { direction: 'stable' as const, value: 0 };
    return { 
      direction: diff > 0 ? 'up' as const : 'down' as const, 
      value: Math.abs(diff).toFixed(1) 
    };
  }, [chartData]);

  const currentRate = chartData.length > 0 ? chartData[chartData.length - 1].taxaAcumulada : 0;
  const totalSent = chartData.length > 0 ? chartData[chartData.length - 1].totalEnviados : 0;
  const totalReplies = chartData.length > 0 ? chartData[chartData.length - 1].totalRespostas : 0;

  const chartConfig = {
    taxaAcumulada: {
      label: "Taxa de Resposta",
      color: "hsl(var(--chart-1))",
    },
    enviados: {
      label: "Enviados",
      color: "hsl(var(--chart-2))",
    },
    respostas: {
      label: "Respostas",
      color: "hsl(var(--chart-3))",
    },
  };

  if (totalSent === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolução da Taxa de Resposta Outbound</CardTitle>
          <CardDescription>Nenhum comentário outbound enviado no período</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            <p>Envie comentários em posts de terceiros para ver a evolução</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Evolução da Taxa de Resposta Outbound</CardTitle>
            <CardDescription>
              {totalReplies} respostas de {totalSent} comentários enviados
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">{currentRate}%</p>
              <div className="flex items-center gap-1 text-xs">
                {trend.direction === 'up' && (
                  <>
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span className="text-green-500">+{trend.value}pp</span>
                  </>
                )}
                {trend.direction === 'down' && (
                  <>
                    <TrendingDown className="h-3 w-3 text-red-500" />
                    <span className="text-red-500">-{trend.value}pp</span>
                  </>
                )}
                {trend.direction === 'stable' && (
                  <>
                    <Minus className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Estável</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorTaxa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 11 }} 
              tickLine={false}
              axisLine={false}
              className="text-muted-foreground"
            />
            <YAxis 
              tick={{ fontSize: 11 }} 
              tickLine={false}
              axisLine={false}
              domain={[0, 'auto']}
              tickFormatter={(value) => `${value}%`}
              className="text-muted-foreground"
            />
            <ChartTooltip 
              content={
                <ChartTooltipContent 
                  formatter={(value, name) => {
                    if (name === 'taxaAcumulada') return [`${value}%`, 'Taxa Acumulada'];
                    return [value, name === 'enviados' ? 'Enviados no dia' : 'Respostas no dia'];
                  }}
                  labelFormatter={(label, payload) => {
                    if (payload?.[0]?.payload?.fullDate) {
                      return payload[0].payload.fullDate;
                    }
                    return label;
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="taxaAcumulada"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#colorTaxa)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          </AreaChart>
        </ChartContainer>
        
        {/* Daily breakdown mini-chart */}
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground mb-2">Volume diário</p>
          <ChartContainer config={chartConfig} className="h-[80px] w-full">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorEnviados" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorRespostas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <ChartTooltip 
                content={
                  <ChartTooltipContent 
                    formatter={(value, name) => {
                      return [value, name === 'enviados' ? 'Enviados' : 'Respostas'];
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="enviados"
                stroke="hsl(var(--chart-2))"
                strokeWidth={1.5}
                fill="url(#colorEnviados)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="respostas"
                stroke="hsl(var(--chart-3))"
                strokeWidth={1.5}
                fill="url(#colorRespostas)"
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--chart-2))]" />
              <span className="text-muted-foreground">Enviados</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--chart-3))]" />
              <span className="text-muted-foreground">Respostas</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp } from "lucide-react";

interface Comment {
  id: string;
  comment_type: string;
  created_at: string;
}

interface CommentsEvolutionChartProps {
  comments: Comment[];
  daysToShow?: number;
}

export const CommentsEvolutionChart = ({ comments, daysToShow = 14 }: CommentsEvolutionChartProps) => {
  const chartData = useMemo(() => {
    const endDate = new Date();
    const startDate = subDays(endDate, daysToShow - 1);
    
    // Generate all days in range
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Group comments by day
    const commentsByDay = comments.reduce((acc, comment) => {
      const day = format(startOfDay(new Date(comment.created_at)), 'yyyy-MM-dd');
      if (!acc[day]) {
        acc[day] = { received: 0, sent: 0 };
      }
      if (comment.comment_type === 'received') {
        acc[day].received++;
      } else if (comment.comment_type === 'sent') {
        acc[day].sent++;
      }
      return acc;
    }, {} as Record<string, { received: number; sent: number }>);
    
    // Map to chart format
    return days.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayData = commentsByDay[dayKey] || { received: 0, sent: 0 };
      return {
        date: dayKey,
        dateLabel: format(day, 'dd/MM', { locale: ptBR }),
        received: dayData.received,
        sent: dayData.sent,
        total: dayData.received + dayData.sent
      };
    });
  }, [comments, daysToShow]);

  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, day) => ({
        received: acc.received + day.received,
        sent: acc.sent + day.sent,
        total: acc.total + day.total
      }),
      { received: 0, sent: 0, total: 0 }
    );
  }, [chartData]);

  const chartConfig = {
    received: {
      label: "Recebidos",
      color: "hsl(var(--primary))"
    },
    sent: {
      label: "Enviados", 
      color: "hsl(var(--secondary))"
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Evolução Diária</CardTitle>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">Recebidos: <strong className="text-foreground">{totals.received}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-secondary" />
              <span className="text-muted-foreground">Enviados: <strong className="text-foreground">{totals.sent}</strong></span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fillReceived" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--secondary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="dateLabel" 
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <ChartTooltip 
              content={
                <ChartTooltipContent 
                  labelFormatter={(value) => `Data: ${value}`}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="received"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#fillReceived)"
              name="Recebidos"
            />
            <Area
              type="monotone"
              dataKey="sent"
              stroke="hsl(var(--secondary))"
              strokeWidth={2}
              fill="url(#fillSent)"
              name="Enviados"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};

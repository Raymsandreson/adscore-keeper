import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine
} from "recharts";
import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface GoalHistoryEntry {
  id: string;
  goal_title: string;
  goal_type: string;
  target_value: number;
  achieved_value: number;
  unit: string | null;
  deadline: string;
  status: string;
  achievement_percentage: number | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string;
}

interface GoalSuccessChartProps {
  history: GoalHistoryEntry[];
}

interface ChartDataPoint {
  month: string;
  monthLabel: string;
  successRate: number;
  totalGoals: number;
  completedGoals: number;
  avgAchievement: number;
}

const GoalSuccessChart = ({ history }: GoalSuccessChartProps) => {
  const chartData = useMemo(() => {
    // Group goals by month
    const monthlyData: Record<string, { total: number; completed: number; achievements: number[] }> = {};
    
    // Get last 12 months
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const monthKey = format(monthDate, "yyyy-MM");
      monthlyData[monthKey] = { total: 0, completed: 0, achievements: [] };
    }

    // Populate with actual data
    history.forEach(entry => {
      const monthKey = format(parseISO(entry.created_at), "yyyy-MM");
      if (monthlyData[monthKey]) {
        monthlyData[monthKey].total++;
        if (entry.status === 'completed') {
          monthlyData[monthKey].completed++;
        }
        if (entry.achievement_percentage) {
          monthlyData[monthKey].achievements.push(entry.achievement_percentage);
        }
      }
    });

    // Convert to chart format
    return Object.entries(monthlyData).map(([month, data]) => {
      const successRate = data.total > 0 ? (data.completed / data.total) * 100 : 0;
      const avgAchievement = data.achievements.length > 0 
        ? data.achievements.reduce((a, b) => a + b, 0) / data.achievements.length 
        : 0;
      
      return {
        month,
        monthLabel: format(parseISO(`${month}-01`), "MMM", { locale: ptBR }),
        successRate: Math.round(successRate),
        totalGoals: data.total,
        completedGoals: data.completed,
        avgAchievement: Math.round(avgAchievement)
      };
    });
  }, [history]);

  // Calculate trend
  const trend = useMemo(() => {
    const dataWithGoals = chartData.filter(d => d.totalGoals > 0);
    if (dataWithGoals.length < 2) return 0;
    
    const recent = dataWithGoals.slice(-3);
    const older = dataWithGoals.slice(0, Math.max(1, dataWithGoals.length - 3));
    
    const recentAvg = recent.reduce((a, b) => a + b.successRate, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b.successRate, 0) / older.length;
    
    return recentAvg - olderAvg;
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint;
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
          <p className="font-medium capitalize mb-2">
            {format(parseISO(`${data.month}-01`), "MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <div className="space-y-1 text-sm">
            <p className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Taxa de Sucesso:</span>
              <span className="font-semibold text-green-600">{data.successRate}%</span>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Média Atingimento:</span>
              <span className="font-semibold text-blue-600">{data.avgAchievement}%</span>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Metas:</span>
              <span className="font-medium">{data.completedGoals}/{data.totalGoals}</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  const hasData = chartData.some(d => d.totalGoals > 0);

  if (!hasData) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução da Taxa de Sucesso
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            Sem dados suficientes para exibir o gráfico
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução da Taxa de Sucesso
          </CardTitle>
          <div className="flex items-center gap-1 text-sm">
            {trend > 5 ? (
              <>
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span className="text-green-600 font-medium">+{trend.toFixed(0)}%</span>
              </>
            ) : trend < -5 ? (
              <>
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span className="text-red-600 font-medium">{trend.toFixed(0)}%</span>
              </>
            ) : (
              <>
                <Minus className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Estável</span>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="achievementGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="monthLabel" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine 
                y={75} 
                stroke="hsl(var(--muted-foreground))" 
                strokeDasharray="5 5" 
                strokeOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="avgAchievement"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                fill="url(#achievementGradient)"
                dot={false}
                name="Média Atingimento"
              />
              <Area
                type="monotone"
                dataKey="successRate"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#successGradient)"
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                name="Taxa de Sucesso"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-6 mt-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">Taxa de Sucesso</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(217, 91%, 60%)' }} />
            <span className="text-muted-foreground">Média Atingimento</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GoalSuccessChart;

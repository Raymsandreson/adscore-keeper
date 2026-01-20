import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend 
} from 'recharts';
import { TrendingUp, Users, RefreshCw, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, subWeeks, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface WeeklyData {
  week: string;
  weekLabel: string;
  [username: string]: number | string;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(142, 76%, 36%)',
  'hsl(48, 96%, 53%)',
  'hsl(280, 87%, 60%)',
  'hsl(200, 98%, 50%)',
];

const PERIOD_OPTIONS = [
  { value: '4', label: '4 sem' },
  { value: '8', label: '8 sem' },
  { value: '12', label: '12 sem' },
];

export const EngagementEvolutionChart: React.FC = () => {
  const [weeksToShow, setWeeksToShow] = useState(8);
  const [chartData, setChartData] = useState<WeeklyData[]>([]);
  const [topUsers, setTopUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvolutionData = async (weeks: number) => {
    setLoading(true);
    try {
      // Get the current week start
      const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      
      // Generate week starts for the past N weeks
      const weekStarts: string[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const weekStart = subWeeks(currentWeekStart, i);
        weekStarts.push(format(weekStart, 'yyyy-MM-dd'));
      }

      // Fetch all rankings for these weeks
      const { data: rankingsData, error } = await supabase
        .from('engagement_rankings')
        .select('username, total_points, week_start')
        .in('week_start', weekStarts)
        .order('total_points', { ascending: false });

      if (error) throw error;

      // Find top 5 users by total points across all weeks
      const userTotals: Record<string, number> = {};
      for (const entry of rankingsData || []) {
        const points = entry.total_points ?? 0;
        userTotals[entry.username] = (userTotals[entry.username] || 0) + points;
      }

      const top5Users = Object.entries(userTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([username]) => username);

      setTopUsers(top5Users);

      // Build chart data
      const weeklyData: WeeklyData[] = weekStarts.map(weekStart => {
        const weekDate = new Date(weekStart);
        const dataPoint: WeeklyData = {
          week: weekStart,
          weekLabel: format(weekDate, "dd/MM", { locale: ptBR }),
        };

        // Add each top user's points for this week
        for (const username of top5Users) {
          const entry = rankingsData?.find(
            r => r.week_start === weekStart && r.username === username
          );
          dataPoint[username] = entry?.total_points ?? 0;
        }

        return dataPoint;
      });

      setChartData(weeklyData);
    } catch (error) {
      console.error('Erro ao carregar evolução:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvolutionData(weeksToShow);
  }, [weeksToShow]);

  const handlePeriodChange = (value: string) => {
    if (value) {
      setWeeksToShow(parseInt(value));
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-semibold text-sm mb-2">Semana de {label}</p>
        <div className="space-y-1">
          {payload
            .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))
            .map((entry: any, index: number) => (
              <div key={index} className="flex items-center justify-between gap-4 text-sm">
                <span className="flex items-center gap-2">
                  <span 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: entry.color }}
                  />
                  @{entry.dataKey}
                </span>
                <span className="font-semibold">{(entry.value ?? 0).toLocaleString('pt-BR')} pts</span>
              </div>
            ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (topUsers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Sem dados de evolução</h3>
          <p className="text-muted-foreground">
            O gráfico será exibido quando houver dados de múltiplas semanas
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Evolução dos Top 5 Engajadores
            </CardTitle>
            <CardDescription>
              Pontos acumulados nas últimas {weeksToShow} semanas
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Period Selector */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <ToggleGroup 
                type="single" 
                value={weeksToShow.toString()} 
                onValueChange={handlePeriodChange}
                className="bg-muted rounded-lg p-1"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <ToggleGroupItem 
                    key={option.value} 
                    value={option.value}
                    className="text-xs px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm"
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            
            {/* User Badges */}
            <div className="flex gap-1 flex-wrap">
              {topUsers.map((user, index) => (
                <Badge 
                  key={user} 
                  variant="outline"
                  className="text-xs"
                  style={{ 
                    borderColor: CHART_COLORS[index],
                    color: CHART_COLORS[index]
                  }}
                >
                  @{user}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis 
                dataKey="weekLabel" 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                tickFormatter={(value) => value.toLocaleString('pt-BR')}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                formatter={(value) => `@${value}`}
                wrapperStyle={{ fontSize: '12px' }}
              />
              {topUsers.map((username, index) => (
                <Line
                  key={username}
                  type="monotone"
                  dataKey={username}
                  stroke={CHART_COLORS[index]}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS[index], strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

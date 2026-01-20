import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend, BarChart, Bar, ReferenceLine
} from 'recharts';
import { TrendingUp, Users, RefreshCw, Calendar, Settings2, ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, subWeeks, subDays, startOfWeek, startOfMonth, endOfMonth, startOfYear, startOfQuarter, subMonths, subQuarters } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface WeeklyData {
  week: string;
  weekLabel: string;
  [username: string]: number | string;
}

interface ComparisonData {
  user: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(142, 76%, 36%)',
  'hsl(48, 96%, 53%)',
  'hsl(280, 87%, 60%)',
  'hsl(200, 98%, 50%)',
];

type PeriodType = 
  | 'this_week' 
  | 'last_week' 
  | 'this_month' 
  | 'last_month'
  | 'this_quarter'
  | 'last_30_days'
  | 'last_60_days'
  | 'last_90_days'
  | '4_weeks'
  | '8_weeks'
  | '12_weeks'
  | 'custom_days';

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'this_week', label: 'Esta semana' },
  { value: 'last_week', label: 'Semana passada' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'this_quarter', label: 'Este trimestre' },
  { value: 'last_30_days', label: 'Últimos 30 dias' },
  { value: 'last_60_days', label: 'Últimos 60 dias' },
  { value: 'last_90_days', label: 'Últimos 90 dias' },
  { value: '4_weeks', label: '4 semanas' },
  { value: '8_weeks', label: '8 semanas' },
  { value: '12_weeks', label: '12 semanas' },
  { value: 'custom_days', label: 'Personalizado' },
];

const getComparisonPeriodLabel = (period: PeriodType): string => {
  switch (period) {
    case 'this_week': return 'vs Semana anterior';
    case 'last_week': return 'vs 2 semanas atrás';
    case 'this_month': return 'vs Mês passado';
    case 'last_month': return 'vs 2 meses atrás';
    case 'this_quarter': return 'vs Trimestre passado';
    case 'last_30_days': return 'vs 30 dias anteriores';
    case 'last_60_days': return 'vs 60 dias anteriores';
    case 'last_90_days': return 'vs 90 dias anteriores';
    case '4_weeks': return 'vs 4 semanas anteriores';
    case '8_weeks': return 'vs 8 semanas anteriores';
    case '12_weeks': return 'vs 12 semanas anteriores';
    case 'custom_days': return 'vs Período anterior';
    default: return 'vs Período anterior';
  }
};

const calculateWeeksFromPeriod = (period: PeriodType, customDays: number): number => {
  const now = new Date();
  
  switch (period) {
    case 'this_week':
      return 1;
    case 'last_week':
      return 2;
    case 'this_month': {
      const monthStart = startOfMonth(now);
      const weeksInMonth = Math.ceil((now.getTime() - monthStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return Math.max(1, weeksInMonth);
    }
    case 'last_month': {
      return 5; // Approximate
    }
    case 'this_quarter': {
      const quarterStart = startOfQuarter(now);
      const weeksInQuarter = Math.ceil((now.getTime() - quarterStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return Math.max(1, weeksInQuarter);
    }
    case 'last_30_days':
      return 5;
    case 'last_60_days':
      return 9;
    case 'last_90_days':
      return 13;
    case '4_weeks':
      return 4;
    case '8_weeks':
      return 8;
    case '12_weeks':
      return 12;
    case 'custom_days':
      return Math.max(1, Math.ceil(customDays / 7));
    default:
      return 8;
  }
};

export const EngagementEvolutionChart: React.FC = () => {
  const [period, setPeriod] = useState<PeriodType>('8_weeks');
  const [customDays, setCustomDays] = useState(30);
  const [customDaysInput, setCustomDaysInput] = useState('30');
  const [chartData, setChartData] = useState<WeeklyData[]>([]);
  const [topUsers, setTopUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonData[]>([]);

  const weeksToShow = calculateWeeksFromPeriod(period, customDays);

  const fetchEvolutionData = async (weeks: number) => {
    setLoading(true);
    try {
      const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      
      // Current period week starts
      const weekStarts: string[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const weekStart = subWeeks(currentWeekStart, i);
        weekStarts.push(format(weekStart, 'yyyy-MM-dd'));
      }

      // Previous period week starts (for comparison)
      const previousWeekStarts: string[] = [];
      for (let i = weeks * 2 - 1; i >= weeks; i--) {
        const weekStart = subWeeks(currentWeekStart, i);
        previousWeekStarts.push(format(weekStart, 'yyyy-MM-dd'));
      }

      const allWeekStarts = [...weekStarts, ...previousWeekStarts];

      const { data: rankingsData, error } = await supabase
        .from('engagement_rankings')
        .select('username, total_points, week_start')
        .in('week_start', allWeekStarts)
        .order('total_points', { ascending: false });

      if (error) throw error;

      // Calculate totals for current period
      const userTotals: Record<string, number> = {};
      for (const entry of rankingsData || []) {
        if (weekStarts.includes(entry.week_start)) {
          const points = entry.total_points ?? 0;
          userTotals[entry.username] = (userTotals[entry.username] || 0) + points;
        }
      }

      // Calculate totals for previous period
      const previousUserTotals: Record<string, number> = {};
      for (const entry of rankingsData || []) {
        if (previousWeekStarts.includes(entry.week_start)) {
          const points = entry.total_points ?? 0;
          previousUserTotals[entry.username] = (previousUserTotals[entry.username] || 0) + points;
        }
      }

      const top5Users = Object.entries(userTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([username]) => username);

      setTopUsers(top5Users);

      // Build comparison data
      const comparison: ComparisonData[] = top5Users.map(user => {
        const current = userTotals[user] || 0;
        const previous = previousUserTotals[user] || 0;
        const change = current - previous;
        const changePercent = previous > 0 ? ((change / previous) * 100) : (current > 0 ? 100 : 0);
        return { user, current, previous, change, changePercent };
      });
      setComparisonData(comparison);

      const weeklyData: WeeklyData[] = weekStarts.map(weekStart => {
        const weekDate = new Date(weekStart);
        const dataPoint: WeeklyData = {
          week: weekStart,
          weekLabel: format(weekDate, "dd/MM", { locale: ptBR }),
        };

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

  const handlePeriodChange = (value: PeriodType) => {
    setPeriod(value);
  };

  const handleCustomDaysChange = (value: string) => {
    setCustomDaysInput(value);
  };

  const handleCustomDaysBlur = () => {
    const days = parseInt(customDaysInput);
    if (!isNaN(days) && days >= 1 && days <= 365) {
      setCustomDays(days);
    } else {
      setCustomDaysInput(customDays.toString());
    }
  };

  const handleCustomDaysKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomDaysBlur();
    }
  };

  const getPeriodLabel = (): string => {
    if (period === 'custom_days') {
      return `Últimos ${customDays} dias`;
    }
    return PERIOD_OPTIONS.find(p => p.value === period)?.label || '';
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

  const ComparisonTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0]?.payload as ComparisonData;
    if (!data) return null;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-semibold text-sm mb-2">@{data.user}</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Período atual:</span>
            <span className="font-semibold">{data.current.toLocaleString('pt-BR')} pts</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Período anterior:</span>
            <span className="font-semibold">{data.previous.toLocaleString('pt-BR')} pts</span>
          </div>
          <div className="flex justify-between gap-4 pt-1 border-t border-border mt-1">
            <span className="text-muted-foreground">Variação:</span>
            <span className={`font-semibold ${data.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {data.change >= 0 ? '+' : ''}{data.change.toLocaleString('pt-BR')} ({data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(1)}%)
            </span>
          </div>
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
            <CardDescription className="flex items-center gap-2">
              {showComparison 
                ? `${getPeriodLabel()} ${getComparisonPeriodLabel(period)}`
                : `${getPeriodLabel()} (${weeksToShow} semanas)`
              }
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Comparison Toggle */}
            <div className="flex items-center gap-2">
              <Switch 
                id="comparison-mode" 
                checked={showComparison} 
                onCheckedChange={setShowComparison}
              />
              <Label htmlFor="comparison-mode" className="text-sm flex items-center gap-1 cursor-pointer">
                <ArrowLeftRight className="w-4 h-4" />
                Comparar
              </Label>
            </div>
            {/* Period Selector */}
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={(value) => handlePeriodChange(value as PeriodType)}>
                <SelectTrigger className="w-[180px]">
                  <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <div className="text-xs font-semibold text-muted-foreground px-2 py-1">Rápido</div>
                  <SelectItem value="this_week">Esta semana</SelectItem>
                  <SelectItem value="last_week">Semana passada</SelectItem>
                  <SelectItem value="this_month">Este mês</SelectItem>
                  <SelectItem value="last_month">Mês passado</SelectItem>
                  <SelectItem value="this_quarter">Este trimestre</SelectItem>
                  <div className="text-xs font-semibold text-muted-foreground px-2 py-1 mt-2">Últimos dias</div>
                  <SelectItem value="last_30_days">Últimos 30 dias</SelectItem>
                  <SelectItem value="last_60_days">Últimos 60 dias</SelectItem>
                  <SelectItem value="last_90_days">Últimos 90 dias</SelectItem>
                  <div className="text-xs font-semibold text-muted-foreground px-2 py-1 mt-2">Semanas</div>
                  <SelectItem value="4_weeks">4 semanas</SelectItem>
                  <SelectItem value="8_weeks">8 semanas</SelectItem>
                  <SelectItem value="12_weeks">12 semanas</SelectItem>
                  <div className="text-xs font-semibold text-muted-foreground px-2 py-1 mt-2">Personalizado</div>
                  <SelectItem value="custom_days">Dias personalizados</SelectItem>
                </SelectContent>
              </Select>

              {period === 'custom_days' && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={customDaysInput}
                    onChange={(e) => handleCustomDaysChange(e.target.value)}
                    onBlur={handleCustomDaysBlur}
                    onKeyDown={handleCustomDaysKeyDown}
                    className="w-20 h-9"
                    placeholder="Dias"
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              )}
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
        {showComparison ? (
          <div className="space-y-4">
            {/* Comparison Bar Chart */}
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={comparisonData} 
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={true} vertical={false} />
                  <XAxis 
                    type="number"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                    tickFormatter={(value) => value.toLocaleString('pt-BR')}
                  />
                  <YAxis 
                    type="category"
                    dataKey="user"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                    tickFormatter={(value) => `@${value}`}
                    width={80}
                  />
                  <Tooltip content={<ComparisonTooltip />} />
                  <Legend />
                  <Bar 
                    dataKey="current" 
                    name="Período Atual" 
                    fill="hsl(var(--primary))" 
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar 
                    dataKey="previous" 
                    name="Período Anterior" 
                    fill="hsl(var(--muted-foreground))" 
                    opacity={0.5}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            {/* Comparison Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {comparisonData.map((data, index) => (
                <div 
                  key={data.user}
                  className="p-3 rounded-lg border bg-card"
                  style={{ borderLeftColor: CHART_COLORS[index], borderLeftWidth: 3 }}
                >
                  <div className="text-sm font-medium truncate">@{data.user}</div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-lg font-bold">{data.current.toLocaleString('pt-BR')}</span>
                    <span 
                      className={`text-xs font-medium ${
                        data.change > 0 ? 'text-green-500' : data.change < 0 ? 'text-red-500' : 'text-muted-foreground'
                      }`}
                    >
                      {data.change > 0 ? '↑' : data.change < 0 ? '↓' : '='} {data.change >= 0 ? '+' : ''}{data.changePercent.toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    anterior: {data.previous.toLocaleString('pt-BR')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
};

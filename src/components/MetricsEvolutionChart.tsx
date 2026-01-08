import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, Line } from 'recharts';
import { TrendingUp, DollarSign, MousePointer, Users, Calendar as CalendarIcon } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isWithinInterval, addDays, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';

export interface DailyMetric {
  date: string;
  cpc: number;
  ctr: number;
  cpm: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: number;
}

interface MetricsEvolutionChartProps {
  data: DailyMetric[];
  isLoading?: boolean;
}

type PeriodType = 'day' | 'week' | 'biweekly' | 'month' | 'quarter' | 'semester' | 'custom';

const periodOptions = [
  { value: 'day', label: 'Por Dia' },
  { value: 'week', label: 'Por Semana' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'month', label: 'Por Mês' },
  { value: 'quarter', label: 'Por Trimestre' },
  { value: 'semester', label: 'Por Semestre' },
  { value: 'custom', label: 'Período Personalizado' },
];

export const MetricsEvolutionChart = ({ data, isLoading }: MetricsEvolutionChartProps) => {
  const [period, setPeriod] = useState<PeriodType>('day');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const aggregatedData = useMemo(() => {
    if (!data || data.length === 0) return [];

    let filteredData = [...data];

    // Apply custom date range filter
    if (period === 'custom' && dateRange?.from && dateRange?.to) {
      filteredData = data.filter(d => {
        const date = new Date(d.date + 'T12:00:00');
        return isWithinInterval(date, { start: dateRange.from!, end: dateRange.to! });
      });
    }

    if (filteredData.length === 0) return [];

    const sortedData = filteredData.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const firstDate = new Date(sortedData[0].date + 'T12:00:00');
    const lastDate = new Date(sortedData[sortedData.length - 1].date + 'T12:00:00');

    switch (period) {
      case 'day':
      case 'custom':
        return sortedData.map(d => ({
          ...d,
          label: format(new Date(d.date + 'T12:00:00'), 'dd/MM', { locale: ptBR }),
          fullLabel: format(new Date(d.date + 'T12:00:00'), "EEEE, dd 'de' MMMM", { locale: ptBR }),
        }));

      case 'week': {
        const weeks = eachWeekOfInterval({ start: firstDate, end: lastDate }, { weekStartsOn: 0 });
        return weeks.map(weekStart => {
          const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
          const weekData = sortedData.filter(d => {
            const date = new Date(d.date + 'T12:00:00');
            return isWithinInterval(date, { start: weekStart, end: weekEnd });
          });

          if (weekData.length === 0) return null;

          return {
            label: `${format(weekStart, 'dd/MM', { locale: ptBR })} - ${format(weekEnd, 'dd/MM', { locale: ptBR })}`,
            fullLabel: `Semana de ${format(weekStart, 'dd/MM', { locale: ptBR })} a ${format(weekEnd, 'dd/MM', { locale: ptBR })}`,
            cpc: weekData.reduce((acc, d) => acc + d.cpc, 0) / weekData.length,
            ctr: weekData.reduce((acc, d) => acc + d.ctr, 0) / weekData.length,
            cpm: weekData.reduce((acc, d) => acc + d.cpm, 0) / weekData.length,
            spend: weekData.reduce((acc, d) => acc + d.spend, 0),
            impressions: weekData.reduce((acc, d) => acc + d.impressions, 0),
            clicks: weekData.reduce((acc, d) => acc + d.clicks, 0),
            conversions: weekData.reduce((acc, d) => acc + d.conversions, 0),
            conversionRate: weekData.reduce((acc, d) => acc + d.conversionRate, 0) / weekData.length,
          };
        }).filter(Boolean);
      }

      case 'biweekly': {
        const biweeks: any[] = [];
        let currentStart = firstDate;
        
        while (currentStart <= lastDate) {
          const biweekEnd = addDays(currentStart, 13);
          const biweekData = sortedData.filter(d => {
            const date = new Date(d.date + 'T12:00:00');
            return isWithinInterval(date, { start: currentStart, end: biweekEnd > lastDate ? lastDate : biweekEnd });
          });

          if (biweekData.length > 0) {
            biweeks.push({
              label: `${format(currentStart, 'dd/MM', { locale: ptBR })} - ${format(biweekEnd > lastDate ? lastDate : biweekEnd, 'dd/MM', { locale: ptBR })}`,
              fullLabel: `Quinzena de ${format(currentStart, 'dd/MM', { locale: ptBR })} a ${format(biweekEnd > lastDate ? lastDate : biweekEnd, 'dd/MM', { locale: ptBR })}`,
              cpc: biweekData.reduce((acc, d) => acc + d.cpc, 0) / biweekData.length,
              ctr: biweekData.reduce((acc, d) => acc + d.ctr, 0) / biweekData.length,
              cpm: biweekData.reduce((acc, d) => acc + d.cpm, 0) / biweekData.length,
              spend: biweekData.reduce((acc, d) => acc + d.spend, 0),
              impressions: biweekData.reduce((acc, d) => acc + d.impressions, 0),
              clicks: biweekData.reduce((acc, d) => acc + d.clicks, 0),
              conversions: biweekData.reduce((acc, d) => acc + d.conversions, 0),
              conversionRate: biweekData.reduce((acc, d) => acc + d.conversionRate, 0) / biweekData.length,
            });
          }
          currentStart = addDays(biweekEnd, 1);
        }
        return biweeks;
      }

      case 'month': {
        const months = eachMonthOfInterval({ start: firstDate, end: lastDate });
        return months.map(monthStart => {
          const monthEnd = endOfMonth(monthStart);
          const monthData = sortedData.filter(d => {
            const date = new Date(d.date + 'T12:00:00');
            return isWithinInterval(date, { start: monthStart, end: monthEnd });
          });

          if (monthData.length === 0) return null;

          return {
            label: format(monthStart, 'MMM/yy', { locale: ptBR }),
            fullLabel: format(monthStart, "MMMM 'de' yyyy", { locale: ptBR }),
            cpc: monthData.reduce((acc, d) => acc + d.cpc, 0) / monthData.length,
            ctr: monthData.reduce((acc, d) => acc + d.ctr, 0) / monthData.length,
            cpm: monthData.reduce((acc, d) => acc + d.cpm, 0) / monthData.length,
            spend: monthData.reduce((acc, d) => acc + d.spend, 0),
            impressions: monthData.reduce((acc, d) => acc + d.impressions, 0),
            clicks: monthData.reduce((acc, d) => acc + d.clicks, 0),
            conversions: monthData.reduce((acc, d) => acc + d.conversions, 0),
            conversionRate: monthData.reduce((acc, d) => acc + d.conversionRate, 0) / monthData.length,
          };
        }).filter(Boolean);
      }

      case 'quarter': {
        const quarters: any[] = [];
        let currentQuarterStart = startOfQuarter(firstDate);
        
        while (currentQuarterStart <= lastDate) {
          const quarterEnd = endOfQuarter(currentQuarterStart);
          const quarterData = sortedData.filter(d => {
            const date = new Date(d.date + 'T12:00:00');
            return isWithinInterval(date, { start: currentQuarterStart, end: quarterEnd });
          });

          if (quarterData.length > 0) {
            const quarterNumber = Math.ceil((currentQuarterStart.getMonth() + 1) / 3);
            quarters.push({
              label: `Q${quarterNumber}/${format(currentQuarterStart, 'yy')}`,
              fullLabel: `${quarterNumber}º Trimestre de ${format(currentQuarterStart, 'yyyy')}`,
              cpc: quarterData.reduce((acc, d) => acc + d.cpc, 0) / quarterData.length,
              ctr: quarterData.reduce((acc, d) => acc + d.ctr, 0) / quarterData.length,
              cpm: quarterData.reduce((acc, d) => acc + d.cpm, 0) / quarterData.length,
              spend: quarterData.reduce((acc, d) => acc + d.spend, 0),
              impressions: quarterData.reduce((acc, d) => acc + d.impressions, 0),
              clicks: quarterData.reduce((acc, d) => acc + d.clicks, 0),
              conversions: quarterData.reduce((acc, d) => acc + d.conversions, 0),
              conversionRate: quarterData.reduce((acc, d) => acc + d.conversionRate, 0) / quarterData.length,
            });
          }
          currentQuarterStart = addDays(quarterEnd, 1);
        }
        return quarters;
      }

      case 'semester': {
        const semesters: any[] = [];
        let currentStart = new Date(firstDate.getFullYear(), firstDate.getMonth() < 6 ? 0 : 6, 1);
        
        while (currentStart <= lastDate) {
          const semesterEnd = new Date(currentStart.getFullYear(), currentStart.getMonth() + 6, 0);
          const semesterData = sortedData.filter(d => {
            const date = new Date(d.date + 'T12:00:00');
            return isWithinInterval(date, { start: currentStart, end: semesterEnd > lastDate ? lastDate : semesterEnd });
          });

          if (semesterData.length > 0) {
            const semesterNumber = currentStart.getMonth() < 6 ? 1 : 2;
            semesters.push({
              label: `S${semesterNumber}/${format(currentStart, 'yy')}`,
              fullLabel: `${semesterNumber}º Semestre de ${format(currentStart, 'yyyy')}`,
              cpc: semesterData.reduce((acc, d) => acc + d.cpc, 0) / semesterData.length,
              ctr: semesterData.reduce((acc, d) => acc + d.ctr, 0) / semesterData.length,
              cpm: semesterData.reduce((acc, d) => acc + d.cpm, 0) / semesterData.length,
              spend: semesterData.reduce((acc, d) => acc + d.spend, 0),
              impressions: semesterData.reduce((acc, d) => acc + d.impressions, 0),
              clicks: semesterData.reduce((acc, d) => acc + d.clicks, 0),
              conversions: semesterData.reduce((acc, d) => acc + d.conversions, 0),
              conversionRate: semesterData.reduce((acc, d) => acc + d.conversionRate, 0) / semesterData.length,
            });
          }
          currentStart = new Date(currentStart.getFullYear(), currentStart.getMonth() + 6, 1);
        }
        return semesters;
      }

      default:
        return sortedData;
    }
  }, [data, period, dateRange]);

  const handlePeriodChange = (value: string) => {
    setPeriod(value as PeriodType);
    if (value === 'custom') {
      setIsCalendarOpen(true);
    }
  };

  const formatCurrency = (value: number) => `R$ ${value.toFixed(2)}`;
  const formatPercent = (value: number) => `${value.toFixed(2)}%`;
  const formatNumber = (value: number) => value.toLocaleString('pt-BR');

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0]?.payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="text-foreground font-medium mb-2">{dataPoint?.fullLabel || label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {
                entry.name.includes('R$') || entry.name === 'Gasto' || entry.name === 'CPC' || entry.name === 'CPM' 
                  ? formatCurrency(entry.value) 
                  : entry.name.includes('%') || entry.name === 'CTR' || entry.name === 'Taxa Conv.' 
                    ? formatPercent(entry.value)
                    : formatNumber(entry.value)
              }
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Evolução das Métricas
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <div className="text-muted-foreground">Carregando dados...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Evolução das Métricas
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <div className="text-muted-foreground">Conecte-se à Meta API para ver os gráficos</div>
        </CardContent>
      </Card>
    );
  }

  const getPeriodLabel = () => {
    if (period === 'custom' && dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, 'dd/MM/yyyy', { locale: ptBR })} - ${format(dateRange.to, 'dd/MM/yyyy', { locale: ptBR })}`;
    }
    return periodOptions.find(p => p.value === period)?.label || 'Por Dia';
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-foreground flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Evolução das Métricas
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {period === 'custom' && (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {dateRange?.from && dateRange?.to 
                      ? `${format(dateRange.from, 'dd/MM', { locale: ptBR })} - ${format(dateRange.to, 'dd/MM', { locale: ptBR })}`
                      : 'Selecionar datas'
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={(range) => {
                      setDateRange(range);
                      if (range?.from && range?.to) {
                        setIsCalendarOpen(false);
                      }
                    }}
                    numberOfMonths={2}
                    locale={ptBR}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        
        <p className="text-sm text-muted-foreground mt-2">
          Visualização: {getPeriodLabel()} • {aggregatedData.length} período{aggregatedData.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="custos" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="custos" className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Custos
            </TabsTrigger>
            <TabsTrigger value="engajamento" className="flex items-center gap-1">
              <MousePointer className="h-4 w-4" />
              Engajamento
            </TabsTrigger>
            <TabsTrigger value="conversoes" className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              Conversões
            </TabsTrigger>
            <TabsTrigger value="volume" className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Volume
            </TabsTrigger>
          </TabsList>

          <TabsContent value="custos" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="label" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  angle={aggregatedData.length > 10 ? -45 : 0}
                  textAnchor={aggregatedData.length > 10 ? "end" : "middle"}
                  height={aggregatedData.length > 10 ? 60 : 30}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `R$${value}`}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `R$${value}`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar 
                  yAxisId="left"
                  dataKey="cpc" 
                  name="CPC" 
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  yAxisId="left"
                  dataKey="cpm" 
                  name="CPM" 
                  fill="#8b5cf6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  yAxisId="right"
                  dataKey="spend" 
                  name="Gasto" 
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="engajamento" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="label" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  angle={aggregatedData.length > 10 ? -45 : 0}
                  textAnchor={aggregatedData.length > 10 ? "end" : "middle"}
                  height={aggregatedData.length > 10 ? 60 : 30}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar 
                  dataKey="ctr" 
                  name="CTR" 
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="conversoes" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="label" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  angle={aggregatedData.length > 10 ? -45 : 0}
                  textAnchor={aggregatedData.length > 10 ? "end" : "middle"}
                  height={aggregatedData.length > 10 ? 60 : 30}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar 
                  yAxisId="left"
                  dataKey="conversions" 
                  name="Conversões" 
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="conversionRate" 
                  name="Taxa Conv." 
                  stroke="#ef4444" 
                  strokeWidth={2}
                  dot={{ fill: '#ef4444', r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="volume" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="label" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  angle={aggregatedData.length > 10 ? -45 : 0}
                  textAnchor={aggregatedData.length > 10 ? "end" : "middle"}
                  height={aggregatedData.length > 10 ? 60 : 30}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar 
                  yAxisId="left"
                  dataKey="impressions" 
                  name="Impressões" 
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  yAxisId="right"
                  dataKey="clicks" 
                  name="Cliques" 
                  fill="#ec4899"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, BarChart, Bar } from 'recharts';
import { TrendingUp, DollarSign, MousePointer, Users } from 'lucide-react';

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

interface MetricsChartProps {
  data: DailyMetric[];
  isLoading?: boolean;
}

export const MetricsChart = ({ data, isLoading }: MetricsChartProps) => {
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = date.toLocaleDateString('pt-BR', { weekday: 'short' });
    const dayMonth = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${dayOfWeek.replace('.', '')} ${dayMonth}`;
  };

  const getDateRangeText = () => {
    if (data.length === 0) return '';
    const firstDate = new Date(data[0].date + 'T12:00:00');
    const lastDate = new Date(data[data.length - 1].date + 'T12:00:00');
    return `${firstDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${lastDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  };

  const formatCurrency = (value: number) => `R$ ${value.toFixed(2)}`;
  const formatPercent = (value: number) => `${value.toFixed(2)}%`;
  const formatNumber = (value: number) => value.toLocaleString('pt-BR');

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="text-foreground font-medium mb-2">{formatDate(label)}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {entry.name.includes('R$') || entry.name === 'Gasto' ? formatCurrency(entry.value) : 
                            entry.name.includes('%') || entry.name === 'CTR' || entry.name === 'Taxa Conv.' ? formatPercent(entry.value) :
                            formatNumber(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-foreground flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Evolução das Métricas
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            Período: {getDateRangeText()} (dados consolidados até ontem)
          </span>
        </div>
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
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={formatDate}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
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
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="cpc" 
                  name="CPC" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  dot={{ fill: '#3b82f6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="cpm" 
                  name="CPM" 
                  stroke="#8b5cf6" 
                  strokeWidth={2}
                  dot={{ fill: '#8b5cf6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="spend" 
                  name="Gasto" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ fill: '#10b981', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="engajamento" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={formatDate}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Area 
                  type="monotone" 
                  dataKey="ctr" 
                  name="CTR" 
                  stroke="#f59e0b" 
                  fill="#f59e0b"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="conversoes" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={formatDate}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
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
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>

          <TabsContent value="volume" className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={formatDate}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
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
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="impressions" 
                  name="Impressões" 
                  stroke="#6366f1" 
                  fill="#6366f1"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="clicks" 
                  name="Cliques" 
                  stroke="#ec4899" 
                  fill="#ec4899"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

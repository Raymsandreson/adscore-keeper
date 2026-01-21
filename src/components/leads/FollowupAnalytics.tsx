import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';
import { 
  TrendingUp, 
  Phone, 
  Clock, 
  Target,
  BarChart3,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  useFollowupAnalytics, 
  FollowupType,
  FOLLOWUP_TYPE_CONFIG,
  FOLLOWUP_OUTCOME_CONFIG,
  FollowupOutcome
} from '@/hooks/useLeadFollowups';

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export function FollowupAnalytics() {
  const { stats, loading, calculateStats } = useFollowupAnalytics();

  useEffect(() => {
    calculateStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Nenhum dado de follow-up disponível</p>
          <Button onClick={calculateStats} variant="outline" className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const typeChartData = Object.entries(stats.byType).map(([type, count]) => ({
    name: FOLLOWUP_TYPE_CONFIG[type as FollowupType]?.label || type,
    value: count,
  }));

  const outcomeChartData = Object.entries(stats.byOutcome).map(([outcome, count]) => ({
    name: FOLLOWUP_OUTCOME_CONFIG[outcome as FollowupOutcome]?.label || outcome,
    value: count,
    color: FOLLOWUP_OUTCOME_CONFIG[outcome as FollowupOutcome]?.color || 'bg-gray-500',
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Total de Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalFollowups}</div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              Média até Conversão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.avgFollowupsToConversion.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground ml-1">follow-ups</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Intervalo Médio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.avgDaysBetweenFollowups.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground ml-1">dias</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Melhor Faixa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.conversionByFollowupCount.length > 0 ? (
              <div className="text-3xl font-bold">
                {stats.conversionByFollowupCount.reduce((best, curr) => 
                  curr.rate > best.rate ? curr : best
                ).count}
                <span className="text-sm font-normal text-muted-foreground ml-1">follow-ups</span>
              </div>
            ) : (
              <div className="text-muted-foreground">-</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion by Followup Count */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Taxa de Conversão por Quantidade de Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.conversionByFollowupCount.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.conversionByFollowupCount}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="count" 
                    tickFormatter={(v) => `${v} FU`}
                    className="text-xs"
                  />
                  <YAxis 
                    tickFormatter={(v) => `${v}%`}
                    className="text-xs"
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      if (name === 'rate') return [`${value.toFixed(1)}%`, 'Taxa de Conversão'];
                      return [value, name];
                    }}
                    labelFormatter={(label) => `${label} follow-ups`}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar 
                    dataKey="rate" 
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                Sem dados suficientes
              </div>
            )}
            
            {/* Table below chart */}
            {stats.conversionByFollowupCount.length > 0 && (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 gap-2 p-2 bg-muted/50 text-xs font-medium">
                  <div>Follow-ups</div>
                  <div className="text-center">Total Leads</div>
                  <div className="text-center">Convertidos</div>
                  <div className="text-right">Taxa</div>
                </div>
                {stats.conversionByFollowupCount.slice(0, 6).map((row) => (
                  <div key={row.count} className="grid grid-cols-4 gap-2 p-2 text-xs border-t">
                    <div className="font-medium">{row.count} FU</div>
                    <div className="text-center text-muted-foreground">{row.total}</div>
                    <div className="text-center">{row.converted}</div>
                    <div className="text-right">
                      <Badge variant={row.rate > 20 ? 'default' : 'secondary'}>
                        {row.rate.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Followup Types Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por Tipo</CardTitle>
          </CardHeader>
          <CardContent>
            {typeChartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={typeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {typeChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {typeChartData.map((item, index) => (
                    <Badge 
                      key={item.name} 
                      variant="outline"
                      className="gap-1"
                    >
                      <span 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      {item.name}: {item.value}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                Sem dados
              </div>
            )}
          </CardContent>
        </Card>

        {/* Outcome Distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Resultados dos Follow-ups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(Object.keys(FOLLOWUP_OUTCOME_CONFIG) as FollowupOutcome[]).map((outcome) => {
                const count = stats.byOutcome[outcome] || 0;
                const total = Object.values(stats.byOutcome).reduce((sum, v) => sum + v, 0);
                const percentage = total > 0 ? (count / total) * 100 : 0;
                
                return (
                  <div 
                    key={outcome}
                    className="p-4 rounded-lg border bg-muted/30"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${FOLLOWUP_OUTCOME_CONFIG[outcome].color}`} />
                      <span className="font-medium text-sm">
                        {FOLLOWUP_OUTCOME_CONFIG[outcome].label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-muted-foreground">
                      {percentage.toFixed(1)}% do total
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">💡 Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {stats.avgFollowupsToConversion > 0 && (
              <li>
                Em média, são necessários <strong>{stats.avgFollowupsToConversion.toFixed(1)} follow-ups</strong> para converter um lead.
              </li>
            )}
            {stats.avgDaysBetweenFollowups > 0 && (
              <li>
                O intervalo médio entre follow-ups é de <strong>{stats.avgDaysBetweenFollowups.toFixed(1)} dias</strong>.
                {stats.avgDaysBetweenFollowups > 7 && (
                  <span className="text-amber-600 ml-1">
                    Considere reduzir para manter o lead aquecido.
                  </span>
                )}
              </li>
            )}
            {stats.conversionByFollowupCount.length > 0 && (
              <li>
                A maior taxa de conversão está em leads com{' '}
                <strong>
                  {stats.conversionByFollowupCount.reduce((best, curr) => 
                    curr.rate > best.rate ? curr : best
                  ).count} follow-ups
                </strong>{' '}
                ({stats.conversionByFollowupCount.reduce((best, curr) => 
                  curr.rate > best.rate ? curr : best
                ).rate.toFixed(1)}% de conversão).
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

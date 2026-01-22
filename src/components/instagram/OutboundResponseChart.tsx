import { useMemo, useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { XAxis, YAxis, CartesianGrid, Area, AreaChart, ReferenceLine } from 'recharts';
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TrendingUp, TrendingDown, Minus, Target, Settings, Trophy, Bell, BellOff, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';

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

interface GoalConfig {
  enabled: boolean;
  targetRate: number;
  notifyOnAchieve: boolean;
}

const DEFAULT_GOAL: GoalConfig = {
  enabled: false,
  targetRate: 15,
  notifyOnAchieve: true,
};

export function OutboundResponseChart({ prospects, period }: OutboundResponseChartProps) {
  const [goalConfig, setGoalConfig] = useState<GoalConfig>(() => {
    const saved = localStorage.getItem('outbound-response-goal');
    return saved ? JSON.parse(saved) : DEFAULT_GOAL;
  });
  const [goalSettingsOpen, setGoalSettingsOpen] = useState(false);
  const [tempGoal, setTempGoal] = useState(goalConfig);
  const hasNotifiedRef = useRef(false);
  const previousRateRef = useRef<number | null>(null);

  // Save goal config to localStorage
  useEffect(() => {
    localStorage.setItem('outbound-response-goal', JSON.stringify(goalConfig));
  }, [goalConfig]);

  const chartData = useMemo(() => {
    const days = Math.min(parseInt(period), 30);
    const endDate = new Date();
    const startDate = subDays(endDate, days - 1);
    
    const dateRange = eachDayOfInterval({ start: startDate, end: endDate });
    
    let cumulativeSent = 0;
    let cumulativeReplies = 0;
    
    const data = dateRange.map(date => {
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      
      const daySent = prospects.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && 
               createdAt <= dayEnd && 
               p.comment_type === 'sent' && 
               p.metadata?.is_third_party;
      }).length;
      
      const dayReplies = prospects.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && 
               createdAt <= dayEnd && 
               (p.comment_type === 'reply_to_outbound' || p.metadata?.is_prospect_reply);
      }).length;
      
      cumulativeSent += daySent;
      cumulativeReplies += dayReplies;
      
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

  // Check if goal is achieved
  const goalAchieved = goalConfig.enabled && currentRate >= goalConfig.targetRate;
  const goalProgress = goalConfig.enabled 
    ? Math.min((currentRate / goalConfig.targetRate) * 100, 100).toFixed(0)
    : 0;

  // Trigger notification when goal is achieved
  useEffect(() => {
    if (!goalConfig.enabled || !goalConfig.notifyOnAchieve) return;
    
    const wasBelow = previousRateRef.current !== null && previousRateRef.current < goalConfig.targetRate;
    const isNowAbove = currentRate >= goalConfig.targetRate;
    
    if (wasBelow && isNowAbove && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      
      // Show toast notification
      toast.success(
        <div className="flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-yellow-500" />
          <div>
            <p className="font-semibold">Meta atingida! 🎉</p>
            <p className="text-sm">Taxa de resposta outbound: {currentRate}%</p>
          </div>
        </div>,
        { duration: 10000 }
      );
      
      // Browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🎯 Meta Outbound Atingida!', {
          body: `Sua taxa de resposta chegou a ${currentRate}%, superando a meta de ${goalConfig.targetRate}%!`,
          icon: '/favicon.ico',
          tag: 'outbound-goal-achieved',
        });
      }
    }
    
    // Reset notification flag if rate goes below goal again
    if (currentRate < goalConfig.targetRate) {
      hasNotifiedRef.current = false;
    }
    
    previousRateRef.current = currentRate;
  }, [currentRate, goalConfig]);

  const handleSaveGoal = () => {
    setGoalConfig(tempGoal);
    setGoalSettingsOpen(false);
    toast.success('Meta de resposta outbound atualizada!');
  };

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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Evolução da Taxa de Resposta Outbound</CardTitle>
              <CardDescription>Nenhum comentário outbound enviado no período</CardDescription>
            </div>
            <GoalSettingsPopover
              open={goalSettingsOpen}
              onOpenChange={setGoalSettingsOpen}
              tempGoal={tempGoal}
              setTempGoal={setTempGoal}
              onSave={handleSaveGoal}
              goalConfig={goalConfig}
            />
          </div>
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
    <Card className={goalAchieved ? 'ring-2 ring-green-500/50 bg-green-50/30 dark:bg-green-950/10' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Evolução da Taxa de Resposta Outbound</CardTitle>
              {goalAchieved && (
                <Badge className="bg-green-500 text-white gap-1">
                  <Trophy className="h-3 w-3" />
                  Meta atingida!
                </Badge>
              )}
            </div>
            <CardDescription>
              {totalReplies} respostas de {totalSent} comentários enviados
              {goalConfig.enabled && !goalAchieved && (
                <span className="ml-2 text-amber-600">
                  • {goalProgress}% da meta ({goalConfig.targetRate}%)
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className={`text-2xl font-bold ${goalAchieved ? 'text-green-600' : 'text-primary'}`}>
                {currentRate}%
              </p>
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
            <GoalSettingsPopover
              open={goalSettingsOpen}
              onOpenChange={setGoalSettingsOpen}
              tempGoal={tempGoal}
              setTempGoal={setTempGoal}
              onSave={handleSaveGoal}
              goalConfig={goalConfig}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorTaxa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={goalAchieved ? 'hsl(142, 76%, 36%)' : 'hsl(var(--primary))'} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={goalAchieved ? 'hsl(142, 76%, 36%)' : 'hsl(var(--primary))'} stopOpacity={0}/>
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
              domain={[0, (dataMax: number) => {
                const max = Math.max(dataMax, goalConfig.enabled ? goalConfig.targetRate * 1.2 : dataMax);
                return Math.ceil(max / 5) * 5;
              }]}
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
            {/* Goal reference line */}
            {goalConfig.enabled && (
              <ReferenceLine 
                y={goalConfig.targetRate} 
                stroke="hsl(var(--destructive))"
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{
                  value: `Meta: ${goalConfig.targetRate}%`,
                  position: 'right',
                  fill: 'hsl(var(--destructive))',
                  fontSize: 11,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="taxaAcumulada"
              stroke={goalAchieved ? 'hsl(142, 76%, 36%)' : 'hsl(var(--primary))'}
              strokeWidth={2}
              fill="url(#colorTaxa)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          </AreaChart>
        </ChartContainer>
        
        {/* Goal progress bar */}
        {goalConfig.enabled && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Progresso da Meta</span>
              </div>
              <span className="text-sm font-medium">
                {currentRate}% / {goalConfig.targetRate}%
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  goalAchieved ? 'bg-green-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(parseFloat(goalProgress as string), 100)}%` }}
              />
            </div>
            {!goalAchieved && (
              <p className="text-xs text-muted-foreground mt-1">
                Faltam {(goalConfig.targetRate - currentRate).toFixed(1)}pp para atingir a meta
              </p>
            )}
          </div>
        )}
        
        {/* Daily breakdown mini-chart */}
        <div className={`mt-4 pt-4 border-t ${goalConfig.enabled ? '' : ''}`}>
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

// Goal Settings Popover Component
function GoalSettingsPopover({
  open,
  onOpenChange,
  tempGoal,
  setTempGoal,
  onSave,
  goalConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempGoal: GoalConfig;
  setTempGoal: (goal: GoalConfig) => void;
  onSave: () => void;
  goalConfig: GoalConfig;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8"
          onClick={() => setTempGoal(goalConfig)}
        >
          {goalConfig.enabled ? (
            <Target className="h-4 w-4 text-primary" />
          ) : (
            <Settings className="h-4 w-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Meta de Resposta
            </h4>
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="goal-enabled" className="text-sm">Ativar meta</Label>
            <Switch
              id="goal-enabled"
              checked={tempGoal.enabled}
              onCheckedChange={(checked) => setTempGoal({ ...tempGoal, enabled: checked })}
            />
          </div>
          
          {tempGoal.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="target-rate" className="text-sm">Taxa alvo (%)</Label>
                <Input
                  id="target-rate"
                  type="number"
                  min={1}
                  max={100}
                  value={tempGoal.targetRate}
                  onChange={(e) => setTempGoal({ 
                    ...tempGoal, 
                    targetRate: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) 
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  Defina a porcentagem de respostas que deseja alcançar
                </p>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {tempGoal.notifyOnAchieve ? (
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <BellOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Label htmlFor="notify-achieve" className="text-sm">Notificar ao atingir</Label>
                </div>
                <Switch
                  id="notify-achieve"
                  checked={tempGoal.notifyOnAchieve}
                  onCheckedChange={(checked) => setTempGoal({ ...tempGoal, notifyOnAchieve: checked })}
                />
              </div>
            </>
          )}
          
          <Button onClick={onSave} className="w-full">
            Salvar Meta
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

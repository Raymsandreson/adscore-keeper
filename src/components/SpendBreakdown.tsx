import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  Megaphone,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from "lucide-react";
import { CampaignInsight, DailyInsight } from "@/hooks/useMetaAPI";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid
} from "recharts";
import { format, subDays, startOfMonth, startOfQuarter, startOfYear, isWithinInterval, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";

type PeriodOption = 'last_7d' | 'last_15d' | 'last_30d' | 'this_month' | 'this_quarter' | 'this_year' | 'custom';

interface SpendBreakdownProps {
  campaigns: CampaignInsight[];
  dailyData: DailyInsight[];
  totalSpend: number;
  isConnected: boolean;
}

const SpendBreakdown = ({ campaigns, dailyData, totalSpend, isConnected }: SpendBreakdownProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [period, setPeriod] = useState<PeriodOption>('last_7d');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const periodOptions: { value: PeriodOption; label: string }[] = [
    { value: 'last_7d', label: 'Últimos 7 dias' },
    { value: 'last_15d', label: 'Últimos 15 dias' },
    { value: 'last_30d', label: 'Últimos 30 dias' },
    { value: 'this_month', label: 'Este mês' },
    { value: 'this_quarter', label: 'Este trimestre' },
    { value: 'this_year', label: 'Este ano' },
    { value: 'custom', label: 'Personalizado' },
  ];

  const getDateRangeFromPeriod = (p: PeriodOption): { from: Date; to: Date } => {
    const today = new Date();
    switch (p) {
      case 'last_7d':
        return { from: subDays(today, 7), to: today };
      case 'last_15d':
        return { from: subDays(today, 15), to: today };
      case 'last_30d':
        return { from: subDays(today, 30), to: today };
      case 'this_month':
        return { from: startOfMonth(today), to: today };
      case 'this_quarter':
        return { from: startOfQuarter(today), to: today };
      case 'this_year':
        return { from: startOfYear(today), to: today };
      case 'custom':
        return dateRange?.from && dateRange?.to 
          ? { from: dateRange.from, to: dateRange.to }
          : { from: subDays(today, 7), to: today };
      default:
        return { from: subDays(today, 7), to: today };
    }
  };

  // Filter daily data based on selected period
  const filteredDailyData = useMemo(() => {
    const range = getDateRangeFromPeriod(period);
    return dailyData.filter(day => {
      const dayDate = parseISO(day.date);
      return isWithinInterval(dayDate, { start: range.from, end: range.to });
    });
  }, [dailyData, period, dateRange]);

  // Calculate previous period data for comparison
  const previousPeriodData = useMemo(() => {
    const currentRange = getDateRangeFromPeriod(period);
    const periodLength = differenceInDays(currentRange.to, currentRange.from) + 1;
    const previousRange = {
      from: subDays(currentRange.from, periodLength),
      to: subDays(currentRange.from, 1)
    };
    
    return dailyData.filter(day => {
      const dayDate = parseISO(day.date);
      return isWithinInterval(dayDate, { start: previousRange.from, end: previousRange.to });
    });
  }, [dailyData, period, dateRange]);

  // Calculate filtered total spend
  const filteredTotalSpend = useMemo(() => {
    return filteredDailyData.reduce((sum, day) => sum + day.spend, 0);
  }, [filteredDailyData]);

  // Calculate previous period total spend
  const previousTotalSpend = useMemo(() => {
    return previousPeriodData.reduce((sum, day) => sum + day.spend, 0);
  }, [previousPeriodData]);

  // Calculate previous period conversions
  const previousTotalConversions = useMemo(() => {
    return previousPeriodData.reduce((sum, day) => sum + day.conversions, 0);
  }, [previousPeriodData]);

  // Calculate current period conversions
  const currentTotalConversions = useMemo(() => {
    return filteredDailyData.reduce((sum, day) => sum + day.conversions, 0);
  }, [filteredDailyData]);

  // Calculate CPA for current and previous period
  const currentCPA = currentTotalConversions > 0 
    ? filteredTotalSpend / currentTotalConversions 
    : 0;

  const previousCPA = previousTotalConversions > 0 
    ? previousTotalSpend / previousTotalConversions 
    : 0;

  // Calculate percentage change
  const spendChange = previousTotalSpend > 0 
    ? ((filteredTotalSpend - previousTotalSpend) / previousTotalSpend) * 100 
    : 0;

  const conversionsChange = previousTotalConversions > 0 
    ? ((currentTotalConversions - previousTotalConversions) / previousTotalConversions) * 100 
    : 0;

  const cpaChange = previousCPA > 0 
    ? ((currentCPA - previousCPA) / previousCPA) * 100 
    : 0;

  // Sort campaigns by spend (descending)
  const sortedCampaigns = [...campaigns].sort((a, b) => b.spend - a.spend);
  
  // Calculate campaign percentages (using filtered total when available)
  const displayTotalSpend = filteredDailyData.length > 0 ? filteredTotalSpend : totalSpend;
  const campaignData = sortedCampaigns.map(campaign => ({
    name: campaign.name.length > 25 ? campaign.name.substring(0, 25) + '...' : campaign.name,
    fullName: campaign.name,
    spend: campaign.spend,
    percentage: displayTotalSpend > 0 ? (campaign.spend / displayTotalSpend) * 100 : 0,
    conversions: campaign.conversions,
    cpa: campaign.conversions > 0 ? campaign.spend / campaign.conversions : 0
  }));

  // Format daily data for chart (filtered)
  const dailyChartData = filteredDailyData.map(day => ({
    date: new Date(day.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    fullDate: day.date,
    spend: day.spend,
    conversions: day.conversions
  }));

  // Calculate daily average
  const dailyAverage = filteredDailyData.length > 0 
    ? filteredDailyData.reduce((sum, day) => sum + day.spend, 0) / filteredDailyData.length 
    : 0;

  const handlePeriodChange = (value: PeriodOption) => {
    setPeriod(value);
    if (value === 'custom') {
      setIsCalendarOpen(true);
    }
  };

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      setIsCalendarOpen(false);
    }
  };

  const getPeriodLabel = () => {
    if (period === 'custom' && dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, 'dd/MM', { locale: ptBR })} - ${format(dateRange.to, 'dd/MM', { locale: ptBR })}`;
    }
    return periodOptions.find(p => p.value === period)?.label || 'Selecionar período';
  };

  // Get trend (compare last 3 days vs first 3 days)
  const getTrend = () => {
    if (filteredDailyData.length < 6) return null;
    const firstHalf = filteredDailyData.slice(0, 3).reduce((sum, d) => sum + d.spend, 0) / 3;
    const lastHalf = filteredDailyData.slice(-3).reduce((sum, d) => sum + d.spend, 0) / 3;
    const change = ((lastHalf - firstHalf) / firstHalf) * 100;
    return { change, direction: change >= 0 ? 'up' : 'down' };
  };

  const trend = getTrend();

  const formatCurrency = (value: number) => 
    `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground">{payload[0]?.payload?.fullName || label}</p>
          <p className="text-primary font-bold">{formatCurrency(payload[0]?.value || 0)}</p>
          {payload[0]?.payload?.conversions !== undefined && (
            <p className="text-muted-foreground text-sm">
              {payload[0].payload.conversions} conversões
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const colors = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <Card className="border-border/50">
      <CardHeader 
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Gasto Total</CardTitle>
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(displayTotalSpend)}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {trend && (
              <Badge 
                variant="outline" 
                className={trend.direction === 'up' 
                  ? 'border-red-500/50 text-red-600 dark:text-red-400' 
                  : 'border-green-500/50 text-green-600 dark:text-green-400'
                }
              >
                {trend.direction === 'up' ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {Math.abs(trend.change).toFixed(1)}%
              </Badge>
            )}
            
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          {/* Period Filter */}
          <div className="flex items-center gap-2 mb-4" onClick={(e) => e.stopPropagation()}>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Select value={period} onValueChange={(v) => handlePeriodChange(v as PeriodOption)}>
              <SelectTrigger className="w-[180px] h-8 text-sm">
                <SelectValue placeholder="Selecionar período" />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {period === 'custom' && (
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 justify-start text-left font-normal text-sm",
                      !dateRange && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-3.5 w-3.5" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "dd/MM/yy", { locale: ptBR })} -{" "}
                          {format(dateRange.to, "dd/MM/yy", { locale: ptBR })}
                        </>
                      ) : (
                        format(dateRange.from, "dd/MM/yy", { locale: ptBR })
                      )
                    ) : (
                      <span>Selecionar datas</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={handleDateRangeSelect}
                    numberOfMonths={2}
                    locale={ptBR}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Period Comparison Card */}
          {previousPeriodData.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 p-4 rounded-lg bg-muted/20 border border-border/50">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Período Atual</p>
                <p className="font-bold text-lg">{formatCurrency(filteredTotalSpend)}</p>
                <p className="text-xs text-muted-foreground">{currentTotalConversions} conv. • CPA {formatCurrency(currentCPA)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Período Anterior</p>
                <p className="font-bold text-lg text-muted-foreground">{formatCurrency(previousTotalSpend)}</p>
                <p className="text-xs text-muted-foreground">{previousTotalConversions} conv. • CPA {formatCurrency(previousCPA)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Variação Gasto</p>
                <div className="flex items-center gap-1">
                  {spendChange > 0 ? (
                    <ArrowUpRight className="h-4 w-4 text-red-500" />
                  ) : spendChange < 0 ? (
                    <ArrowDownRight className="h-4 w-4 text-green-500" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    "font-bold text-lg",
                    spendChange > 0 ? "text-red-500" : spendChange < 0 ? "text-green-500" : "text-muted-foreground"
                  )}>
                    {spendChange > 0 ? "+" : ""}{spendChange.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {spendChange > 0 ? "Aumento" : spendChange < 0 ? "Redução" : "Estável"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Variação Conv.</p>
                <div className="flex items-center gap-1">
                  {conversionsChange > 0 ? (
                    <ArrowUpRight className="h-4 w-4 text-green-500" />
                  ) : conversionsChange < 0 ? (
                    <ArrowDownRight className="h-4 w-4 text-red-500" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    "font-bold text-lg",
                    conversionsChange > 0 ? "text-green-500" : conversionsChange < 0 ? "text-red-500" : "text-muted-foreground"
                  )}>
                    {conversionsChange > 0 ? "+" : ""}{conversionsChange.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {conversionsChange > 0 ? "Aumento" : conversionsChange < 0 ? "Redução" : "Estável"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Variação CPA</p>
                <div className="flex items-center gap-1">
                  {cpaChange > 0 ? (
                    <ArrowUpRight className="h-4 w-4 text-red-500" />
                  ) : cpaChange < 0 ? (
                    <ArrowDownRight className="h-4 w-4 text-green-500" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    "font-bold text-lg",
                    cpaChange > 0 ? "text-red-500" : cpaChange < 0 ? "text-green-500" : "text-muted-foreground"
                  )}>
                    {cpaChange > 0 ? "+" : ""}{cpaChange.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cpaChange > 0 ? "Aumento" : cpaChange < 0 ? "Redução" : "Estável"}
                </p>
              </div>
            </div>
          )}

          <Tabs defaultValue="campaigns" className="w-full">
            <TabsList className="grid w-full max-w-xs grid-cols-2 mb-4">
              <TabsTrigger value="campaigns" className="gap-1.5 text-sm">
                <Megaphone className="h-3.5 w-3.5" />
                Por Campanha
              </TabsTrigger>
              <TabsTrigger value="daily" className="gap-1.5 text-sm">
                <Calendar className="h-3.5 w-3.5" />
                Por Dia
              </TabsTrigger>
            </TabsList>

            <TabsContent value="campaigns" className="space-y-4">
              {!isConnected || campaignData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Conecte-se ao Meta para ver breakdown por campanha</p>
                </div>
              ) : (
                <>
                  {/* Bar Chart */}
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={campaignData} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <XAxis type="number" tickFormatter={(v) => `R$ ${v}`} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="spend" radius={[0, 4, 4, 0]}>
                          {campaignData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Campaign List */}
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {campaignData.map((campaign, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0" 
                            style={{ backgroundColor: colors[index % colors.length] }}
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate" title={campaign.fullName}>
                              {campaign.fullName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {campaign.conversions} conv. | CPA: {formatCurrency(campaign.cpa)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className="font-bold text-sm">{formatCurrency(campaign.spend)}</p>
                          <p className="text-xs text-muted-foreground">
                            {campaign.percentage.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="daily" className="space-y-4">
              {!isConnected || dailyChartData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Conecte-se ao Meta para ver breakdown diário</p>
                </div>
              ) : (
                <>
                  {/* Daily Stats */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Média diária</p>
                      <p className="font-bold text-lg">{formatCurrency(dailyAverage)}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Dias analisados</p>
                      <p className="font-bold text-lg">{filteredDailyData.length} dias</p>
                    </div>
                  </div>

                  {/* Line Chart */}
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyChartData} margin={{ left: 10, right: 30, top: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `R$ ${v}`} tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line 
                          type="monotone" 
                          dataKey="spend" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Daily List */}
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {[...dailyChartData].reverse().map((day, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{day.date}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="outline" className="text-xs">
                            {day.conversions} conv.
                          </Badge>
                          <span className="font-medium text-sm">{formatCurrency(day.spend)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
};

export default SpendBreakdown;

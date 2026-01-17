import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  MessageCircle,
  Send,
  Reply,
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  BarChart3,
  CalendarDays,
  RefreshCw,
  Inbox,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Activity
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Line, LineChart, ComposedChart, Area, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfWeek, startOfMonth, startOfQuarter, startOfYear, endOfWeek, endOfMonth, differenceInDays, isSameDay, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Comment {
  id: string;
  comment_type: string;
  created_at: string;
  author_username: string | null;
  comment_text: string | null;
  post_id: string | null;
}

type PeriodType = 'week' | 'month' | 'quarter' | 'semester' | 'year' | 'custom';

const periodOptions = [
  { value: 'week', label: 'Esta Semana' },
  { value: 'month', label: 'Este Mês' },
  { value: 'quarter', label: 'Este Trimestre' },
  { value: 'semester', label: 'Este Semestre' },
  { value: 'year', label: 'Este Ano' },
  { value: 'custom', label: 'Últimos X dias' },
];

export const CommentsDashboard = () => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>('week');
  const [customDays, setCustomDays] = useState(14);

  useEffect(() => {
    fetchComments();
  }, []);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('id, comment_type, created_at, author_username, comment_text, post_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate date range based on period
  const dateRange = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate = now;

    switch (period) {
      case 'week':
        startDate = startOfWeek(now, { weekStartsOn: 0 });
        endDate = endOfWeek(now, { weekStartsOn: 0 });
        break;
      case 'month':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'quarter':
        startDate = startOfQuarter(now);
        break;
      case 'semester':
        startDate = subDays(now, 180);
        break;
      case 'year':
        startDate = startOfYear(now);
        break;
      case 'custom':
        startDate = subDays(now, customDays);
        break;
      default:
        startDate = startOfWeek(now);
    }

    return { startDate, endDate };
  }, [period, customDays]);

  // Filter comments by period
  const filteredComments = useMemo(() => {
    const { startDate, endDate } = dateRange;
    return comments.filter(c => {
      const commentDate = new Date(c.created_at);
      return commentDate >= startDate && commentDate <= endDate;
    });
  }, [comments, dateRange]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const received = filteredComments.filter(c => c.comment_type === 'received');
    const sent = filteredComments.filter(c => c.comment_type === 'sent');

    // Unique users who commented
    const uniqueUsers = new Set(received.map(c => c.author_username).filter(Boolean));

    // Unique posts that received comments
    const uniquePosts = new Set(received.map(c => c.post_id).filter(Boolean));

    // Average comments per day
    const daysInPeriod = Math.max(1, differenceInDays(dateRange.endDate, dateRange.startDate) + 1);
    const avgPerDay = Math.round((received.length + sent.length) / daysInPeriod * 10) / 10;

    // Response rate (sent/received ratio)
    const responseRate = received.length > 0 ? Math.round((sent.length / received.length) * 100) : 0;

    // Peak hour (hour with most comments)
    const hourCounts: Record<number, number> = {};
    filteredComments.forEach(c => {
      const hour = new Date(c.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

    // Peak day of week
    const dayCounts: Record<number, number> = {};
    filteredComments.forEach(c => {
      const day = new Date(c.created_at).getDay();
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const peakDayNum = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
    const peakDay = dayNames[Number(peakDayNum)];

    return {
      totalReceived: received.length,
      totalSent: sent.length,
      total: filteredComments.length,
      uniqueUsers: uniqueUsers.size,
      uniquePosts: uniquePosts.size,
      avgPerDay,
      responseRate,
      peakHour: `${String(peakHour).padStart(2, '0')}:00`,
      peakDay,
      daysInPeriod
    };
  }, [filteredComments, dateRange]);

  // Compare with previous period
  const comparison = useMemo(() => {
    const { startDate, endDate } = dateRange;
    const periodLength = differenceInDays(endDate, startDate) + 1;
    const previousStart = subDays(startDate, periodLength);
    const previousEnd = subDays(startDate, 1);

    const previousComments = comments.filter(c => {
      const commentDate = new Date(c.created_at);
      return commentDate >= previousStart && commentDate <= previousEnd;
    });

    const previousReceived = previousComments.filter(c => c.comment_type === 'received').length;
    const previousSent = previousComments.filter(c => c.comment_type === 'sent').length;

    const receivedChange = previousReceived > 0 
      ? Math.round(((metrics.totalReceived - previousReceived) / previousReceived) * 100) 
      : metrics.totalReceived > 0 ? 100 : 0;

    const sentChange = previousSent > 0 
      ? Math.round(((metrics.totalSent - previousSent) / previousSent) * 100) 
      : metrics.totalSent > 0 ? 100 : 0;

    return {
      receivedChange,
      sentChange,
      previousReceived,
      previousSent
    };
  }, [comments, dateRange, metrics]);

  // Daily data for chart
  const dailyData = useMemo(() => {
    const { startDate, endDate } = dateRange;
    const days: Record<string, { date: string; dateFormatted: string; received: number; sent: number }> = {};

    // Initialize all days in range
    let currentDate = startDate;
    while (currentDate <= endDate && currentDate <= new Date()) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      days[dateStr] = {
        date: dateStr,
        dateFormatted: format(currentDate, 'dd/MM', { locale: ptBR }),
        received: 0,
        sent: 0
      };
      currentDate = addDays(currentDate, 1);
    }

    // Fill in comment counts
    filteredComments.forEach(c => {
      const dateStr = format(new Date(c.created_at), 'yyyy-MM-dd');
      if (days[dateStr]) {
        if (c.comment_type === 'received') {
          days[dateStr].received++;
        } else {
          days[dateStr].sent++;
        }
      }
    });

    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredComments, dateRange]);

  // Hourly distribution data
  const hourlyData = useMemo(() => {
    const hours: Record<number, { hour: string; count: number }> = {};
    
    for (let i = 0; i < 24; i++) {
      hours[i] = { hour: `${String(i).padStart(2, '0')}h`, count: 0 };
    }

    filteredComments.forEach(c => {
      const hour = new Date(c.created_at).getHours();
      hours[hour].count++;
    });

    return Object.values(hours);
  }, [filteredComments]);

  // Weekly distribution data
  const weeklyData = useMemo(() => {
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const days = dayNames.map((name, i) => ({ day: name, received: 0, sent: 0 }));

    filteredComments.forEach(c => {
      const dayIndex = new Date(c.created_at).getDay();
      if (c.comment_type === 'received') {
        days[dayIndex].received++;
      } else {
        days[dayIndex].sent++;
      }
    });

    return days;
  }, [filteredComments]);

  // Top commenters
  const topCommenters = useMemo(() => {
    const userCounts: Record<string, number> = {};
    
    filteredComments
      .filter(c => c.comment_type === 'received' && c.author_username)
      .forEach(c => {
        const username = c.author_username!;
        userCounts[username] = (userCounts[username] || 0) + 1;
      });

    return Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([username, count]) => ({ username, count }));
  }, [filteredComments]);

  // Type distribution for pie chart
  const typeDistribution = useMemo(() => {
    return [
      { name: 'Recebidos', value: metrics.totalReceived, color: 'hsl(var(--chart-2))' },
      { name: 'Enviados', value: metrics.totalSent, color: 'hsl(var(--chart-1))' },
    ];
  }, [metrics]);

  const chartConfig: ChartConfig = {
    received: {
      label: "Recebidos",
      color: "hsl(var(--chart-2))",
    },
    sent: {
      label: "Enviados",
      color: "hsl(var(--chart-1))",
    },
    count: {
      label: "Total",
      color: "hsl(var(--chart-3))",
    },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Dashboard de Comentários
          </h3>
          <p className="text-sm text-muted-foreground">
            Resumo de métricas de engajamento baseado em comentários
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
            <SelectTrigger className="w-[160px]">
              <CalendarDays className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {period === 'custom' && (
            <Input
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-[80px]"
              placeholder="Dias"
            />
          )}
          <Button variant="outline" size="icon" onClick={fetchComments} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Period Info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>
          {format(dateRange.startDate, "dd 'de' MMMM", { locale: ptBR })} - {format(Math.min(dateRange.endDate.getTime(), Date.now()), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </span>
        <Badge variant="outline" className="ml-2">
          {metrics.daysInPeriod} dias
        </Badge>
      </div>

      {/* Main Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Recebidos</p>
                <p className="text-3xl font-bold">{metrics.totalReceived}</p>
              </div>
              <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-full">
                <Inbox className="h-6 w-6 text-blue-600" />
              </div>
            </div>
            <div className={`flex items-center gap-1 mt-2 text-sm ${comparison.receivedChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {comparison.receivedChange >= 0 ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              <span>{Math.abs(comparison.receivedChange)}%</span>
              <span className="text-muted-foreground">vs anterior</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Enviados</p>
                <p className="text-3xl font-bold">{metrics.totalSent}</p>
              </div>
              <div className="p-3 bg-green-100 dark:bg-green-950 rounded-full">
                <Send className="h-6 w-6 text-green-600" />
              </div>
            </div>
            <div className={`flex items-center gap-1 mt-2 text-sm ${comparison.sentChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {comparison.sentChange >= 0 ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              <span>{Math.abs(comparison.sentChange)}%</span>
              <span className="text-muted-foreground">vs anterior</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Usuários Únicos</p>
                <p className="text-3xl font-bold">{metrics.uniqueUsers}</p>
              </div>
              <div className="p-3 bg-purple-100 dark:bg-purple-950 rounded-full">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Pessoas que comentaram
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Taxa de Resposta</p>
                <p className="text-3xl font-bold">{metrics.responseRate}%</p>
              </div>
              <div className="p-3 bg-amber-100 dark:bg-amber-950 rounded-full">
                <Reply className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <Progress value={Math.min(metrics.responseRate, 100)} className="mt-3 h-2" />
          </CardContent>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Média/Dia</span>
            </div>
            <p className="text-xl font-bold mt-1">{metrics.avgPerDay}</p>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Posts</span>
            </div>
            <p className="text-xl font-bold mt-1">{metrics.uniquePosts}</p>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Horário Pico</span>
            </div>
            <p className="text-xl font-bold mt-1">{metrics.peakHour}</p>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Dia Pico</span>
            </div>
            <p className="text-xl font-bold mt-1">{metrics.peakDay}</p>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total</span>
            </div>
            <p className="text-xl font-bold mt-1">{metrics.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <Tabs defaultValue="daily" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="daily">Evolução Diária</TabsTrigger>
          <TabsTrigger value="hourly">Por Horário</TabsTrigger>
          <TabsTrigger value="weekly">Por Dia da Semana</TabsTrigger>
          <TabsTrigger value="top">Top Comentadores</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Evolução Diária de Comentários
              </CardTitle>
              <CardDescription>
                Comentários recebidos e enviados por dia
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : dailyData.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Sem comentários no período selecionado</p>
                  </div>
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <ComposedChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis 
                      dataKey="dateFormatted" 
                      tickLine={false} 
                      axisLine={false} 
                      className="text-xs"
                      interval={Math.floor(dailyData.length / 10)}
                    />
                    <YAxis tickLine={false} axisLine={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="received" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Recebidos" />
                    <Bar dataKey="sent" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Enviados" />
                  </ComposedChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hourly">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Distribuição por Horário
              </CardTitle>
              <CardDescription>
                Identifique os horários de maior engajamento
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis 
                      dataKey="hour" 
                      tickLine={false} 
                      axisLine={false} 
                      className="text-xs"
                      interval={2}
                    />
                    <YAxis tickLine={false} axisLine={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} name="Comentários" />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="weekly">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Distribuição Semanal
              </CardTitle>
              <CardDescription>
                Comentários por dia da semana
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} className="text-xs" />
                    <YAxis tickLine={false} axisLine={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="received" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Recebidos" stackId="a" />
                    <Bar dataKey="sent" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Enviados" stackId="a" />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="top">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Top 5 Comentadores
              </CardTitle>
              <CardDescription>
                Usuários mais engajados no período
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : topCommenters.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Nenhum comentador encontrado</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {topCommenters.map((user, index) => (
                    <div key={user.username} className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                        ${index === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' :
                          index === 1 ? 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' :
                          index === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' :
                          'bg-muted text-muted-foreground'}`}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">@{user.username}</p>
                        <p className="text-sm text-muted-foreground">{user.count} comentário{user.count > 1 ? 's' : ''}</p>
                      </div>
                      <div className="w-32">
                        <Progress 
                          value={(user.count / (topCommenters[0]?.count || 1)) * 100} 
                          className="h-2" 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Distribution Card */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Insights do Período</p>
              <p className="text-sm text-muted-foreground mt-1">
                {metrics.responseRate < 50 
                  ? `Você respondeu ${metrics.responseRate}% dos comentários recebidos. Tente aumentar sua taxa de resposta para melhorar o engajamento!`
                  : metrics.responseRate < 80 
                  ? `Boa taxa de resposta de ${metrics.responseRate}%! Seu melhor horário é ${metrics.peakHour} e melhor dia é ${metrics.peakDay}.`
                  : `Excelente! Taxa de resposta de ${metrics.responseRate}%. Continue aproveitando ${metrics.peakDay} às ${metrics.peakHour} para máximo engajamento.`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

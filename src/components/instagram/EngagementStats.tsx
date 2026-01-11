import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  TrendingUp, 
  TrendingDown,
  MessageCircle,
  Send,
  Heart,
  Users,
  Eye,
  Reply,
  RefreshCw,
  Calendar
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Line, LineChart, ComposedChart, Area } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DailyStat {
  id: string;
  platform: string;
  stat_date: string;
  comments_sent: number;
  comments_received: number;
  replies_sent: number;
  likes_given: number;
  likes_received: number;
  new_followers: number;
  reach: number;
  engagement_rate: number;
}

export const EngagementStats = () => {
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState('7');
  const [platform, setPlatform] = useState('all');

  useEffect(() => {
    fetchStats();
  }, [period, platform]);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const startDate = subDays(new Date(), parseInt(period)).toISOString().split('T')[0];
      
      let query = supabase
        .from('engagement_daily_stats')
        .select('*')
        .gte('stat_date', startDate)
        .order('stat_date', { ascending: true });

      if (platform !== 'all') {
        query = query.eq('platform', platform);
      }

      const { data, error } = await query;

      if (error) throw error;
      setStats(data || []);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Aggregate stats by date
  const aggregatedStats = stats.reduce((acc, stat) => {
    const existing = acc.find(s => s.date === stat.stat_date);
    if (existing) {
      existing.comments_sent += stat.comments_sent || 0;
      existing.comments_received += stat.comments_received || 0;
      existing.replies_sent += stat.replies_sent || 0;
      existing.likes_given += stat.likes_given || 0;
      existing.likes_received += stat.likes_received || 0;
      existing.new_followers += stat.new_followers || 0;
      existing.reach += stat.reach || 0;
    } else {
      acc.push({
        date: stat.stat_date,
        dateFormatted: format(new Date(stat.stat_date), 'dd/MM', { locale: ptBR }),
        comments_sent: stat.comments_sent || 0,
        comments_received: stat.comments_received || 0,
        replies_sent: stat.replies_sent || 0,
        likes_given: stat.likes_given || 0,
        likes_received: stat.likes_received || 0,
        new_followers: stat.new_followers || 0,
        reach: stat.reach || 0,
      });
    }
    return acc;
  }, [] as any[]);

  // Calculate totals
  const totals = aggregatedStats.reduce((acc, stat) => ({
    comments_sent: acc.comments_sent + stat.comments_sent,
    comments_received: acc.comments_received + stat.comments_received,
    replies_sent: acc.replies_sent + stat.replies_sent,
    likes_given: acc.likes_given + stat.likes_given,
    likes_received: acc.likes_received + stat.likes_received,
    new_followers: acc.new_followers + stat.new_followers,
    reach: acc.reach + stat.reach,
  }), {
    comments_sent: 0,
    comments_received: 0,
    replies_sent: 0,
    likes_given: 0,
    likes_received: 0,
    new_followers: 0,
    reach: 0,
  });

  const chartConfig: ChartConfig = {
    comments_sent: {
      label: "Enviados",
      color: "hsl(var(--chart-1))",
    },
    comments_received: {
      label: "Recebidos",
      color: "hsl(var(--chart-2))",
    },
    replies_sent: {
      label: "Respostas",
      color: "hsl(var(--chart-3))",
    },
  };

  const responseRate = totals.comments_received > 0 
    ? Math.round((totals.replies_sent / totals.comments_received) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Estatísticas de Engajamento
          </h3>
          <p className="text-sm text-muted-foreground">
            Acompanhe sua evolução ao longo do tempo
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="14">14 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchStats}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Send className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-600">Enviados</span>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{totals.comments_sent}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageCircle className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-blue-600">Recebidos</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{totals.comments_received}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Reply className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-purple-600">Respostas</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{totals.replies_sent}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 border-red-200 dark:border-red-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Heart className="h-4 w-4 text-red-600" />
              <span className="text-xs text-red-600">Curtidas</span>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300">{totals.likes_received}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950 dark:to-cyan-900 border-cyan-200 dark:border-cyan-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-cyan-600" />
              <span className="text-xs text-cyan-600">Seguidores</span>
            </div>
            <p className="text-2xl font-bold text-cyan-700 dark:text-cyan-300">+{totals.new_followers}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-amber-600">Alcance</span>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{totals.reach.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border-emerald-200 dark:border-emerald-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-emerald-600">Taxa Resposta</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{responseRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Comments Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Comentários por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[250px] flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : aggregatedStats.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Sem dados para o período selecionado</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[250px]">
                <BarChart data={aggregatedStats}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateFormatted" tickLine={false} axisLine={false} className="text-xs" />
                  <YAxis tickLine={false} axisLine={false} className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="comments_sent" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Enviados" />
                  <Bar dataKey="comments_received" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Recebidos" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Engagement Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Tendência de Engajamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[250px] flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : aggregatedStats.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Sem dados para o período selecionado</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[250px]">
                <ComposedChart data={aggregatedStats}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateFormatted" tickLine={false} axisLine={false} className="text-xs" />
                  <YAxis tickLine={false} axisLine={false} className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="likes_received"
                    fill="hsl(var(--chart-4))"
                    fillOpacity={0.3}
                    stroke="hsl(var(--chart-4))"
                    name="Curtidas"
                  />
                  <Line
                    type="monotone"
                    dataKey="replies_sent"
                    stroke="hsl(var(--chart-3))"
                    strokeWidth={2}
                    dot={false}
                    name="Respostas"
                  />
                </ComposedChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tips */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Dica para melhorar engajamento</p>
              <p className="text-sm text-muted-foreground mt-1">
                {responseRate < 50 
                  ? "Tente responder mais comentários! Uma taxa de resposta acima de 50% ajuda a criar conexão com seu público."
                  : responseRate < 80 
                  ? "Ótima taxa de resposta! Continue assim e tente responder ainda mais rápido para aumentar o engajamento."
                  : "Excelente taxa de resposta! Você está fazendo um ótimo trabalho engajando com seu público."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

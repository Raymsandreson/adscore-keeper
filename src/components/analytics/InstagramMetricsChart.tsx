import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, Users, Eye, Heart } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface InstagramAccount {
  id: string;
  account_name: string;
}

interface MetricData {
  metric_date: string;
  followers_count: number;
  reach: number;
  impressions: number;
  engagement_rate: number;
  profile_views: number;
  reels_views: number;
  stories_views: number;
}

interface ChartData {
  date: string;
  formattedDate: string;
  followers: number;
  reach: number;
  impressions: number;
  engagement: number;
  profileViews: number;
  reelsViews: number;
  storiesViews: number;
}

const COLORS = {
  followers: "hsl(var(--primary))",
  reach: "#8b5cf6",
  impressions: "#f59e0b",
  engagement: "#10b981",
  profileViews: "#ec4899",
  reelsViews: "#06b6d4",
  storiesViews: "#f97316",
};

export const InstagramMetricsChart = () => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [metrics, setMetrics] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("30");

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [selectedAccount, period]);

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from('instagram_accounts' as any)
      .select('id, account_name')
      .order('account_name');
    
    if (data) {
      setAccounts(data as unknown as InstagramAccount[]);
    }
  };

  const fetchMetrics = async () => {
    setLoading(true);
    
    const startDate = format(subDays(new Date(), parseInt(period)), 'yyyy-MM-dd');
    
    let query = supabase
      .from('instagram_metrics' as any)
      .select('*')
      .gte('metric_date', startDate)
      .order('metric_date', { ascending: true });

    if (selectedAccount !== "all") {
      query = query.eq('account_id', selectedAccount);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching metrics:', error);
      setMetrics([]);
    } else if (data) {
      // Group by date and aggregate if showing all accounts
      const rawData = data as unknown as MetricData[];
      const groupedData = rawData.reduce((acc: Record<string, ChartData>, item) => {
        const date = item.metric_date;
        if (!acc[date]) {
          acc[date] = {
            date,
            formattedDate: format(parseISO(date), 'dd/MM', { locale: ptBR }),
            followers: 0,
            reach: 0,
            impressions: 0,
            engagement: 0,
            profileViews: 0,
            reelsViews: 0,
            storiesViews: 0,
          };
        }
        acc[date].followers += item.followers_count || 0;
        acc[date].reach += item.reach || 0;
        acc[date].impressions += item.impressions || 0;
        acc[date].engagement += Number(item.engagement_rate) || 0;
        acc[date].profileViews += item.profile_views || 0;
        acc[date].reelsViews += item.reels_views || 0;
        acc[date].storiesViews += item.stories_views || 0;
        return acc;
      }, {});

      setMetrics(Object.values(groupedData));
    }
    
    setLoading(false);
  };

  const formatNumber = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {formatNumber(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Selecione a conta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.account_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : metrics.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
            <h4 className="text-lg font-medium mb-2">Sem dados para exibir</h4>
            <p className="text-sm text-muted-foreground text-center">
              Adicione métricas às suas contas para visualizar a evolução ao longo do tempo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Row 1: Asymmetric layout - Large chart + Small chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Growth Chart - Takes 2/3 of the space */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Evolução de Seguidores
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics}>
                      <defs>
                        <linearGradient id="colorFollowers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.followers} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={COLORS.followers} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="formattedDate" 
                        tick={{ fontSize: 11 }}
                        className="text-muted-foreground"
                      />
                      <YAxis 
                        tickFormatter={formatNumber}
                        tick={{ fontSize: 11 }}
                        className="text-muted-foreground"
                        width={45}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="followers"
                        name="Seguidores"
                        stroke={COLORS.followers}
                        fillOpacity={1}
                        fill="url(#colorFollowers)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Engagement Chart - Takes 1/3 of the space */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="h-5 w-5 text-green-500" />
                  Engajamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics}>
                      <defs>
                        <linearGradient id="colorEngagement" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.engagement} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={COLORS.engagement} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="formattedDate" 
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 10 }}
                        width={40}
                      />
                      <Tooltip 
                        content={<CustomTooltip />}
                        formatter={(value: number) => [`${value.toFixed(2)}%`, 'Engajamento']}
                      />
                      <Area
                        type="monotone"
                        dataKey="engagement"
                        name="Engajamento %"
                        stroke={COLORS.engagement}
                        fillOpacity={1}
                        fill="url(#colorEngagement)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Asymmetric layout - Small chart + Large chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Content Performance - Takes 1/3 of the space */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-cyan-500" />
                  Conteúdo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metrics}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="formattedDate" 
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tickFormatter={formatNumber}
                        tick={{ fontSize: 10 }}
                        width={40}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line
                        type="monotone"
                        dataKey="reelsViews"
                        name="Reels"
                        stroke={COLORS.reelsViews}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="storiesViews"
                        name="Stories"
                        stroke={COLORS.storiesViews}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Reach Chart - Takes 2/3 of the space */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eye className="h-5 w-5 text-purple-500" />
                  Alcance e Impressões
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metrics}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="formattedDate" 
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis 
                        tickFormatter={formatNumber}
                        tick={{ fontSize: 11 }}
                        width={45}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="reach"
                        name="Alcance"
                        stroke={COLORS.reach}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="impressions"
                        name="Impressões"
                        stroke={COLORS.impressions}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="profileViews"
                        name="Visitas ao Perfil"
                        stroke={COLORS.profileViews}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

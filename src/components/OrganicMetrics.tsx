import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Users, 
  UserPlus, 
  Heart, 
  MessageCircle, 
  Share2, 
  TrendingUp, 
  TrendingDown,
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";

export interface OrganicInsights {
  totalFollowers: number;
  newFollowers: number;
  followerChange: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  websiteClicks: number;
}

export interface DailyOrganicData {
  date: string;
  followers: number;
  newFollowers: number;
  reach: number;
  engagement: number;
}

interface OrganicMetricsProps {
  pageId?: string;
  accessToken?: string;
  isConnected: boolean;
}

const OrganicMetrics = ({ pageId, accessToken, isConnected }: OrganicMetricsProps) => {
  const [insights, setInsights] = useState<OrganicInsights | null>(null);
  const [dailyData, setDailyData] = useState<DailyOrganicData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealData, setIsRealData] = useState(false);
  const [platform, setPlatform] = useState<string>('');
  const [isPermissionError, setIsPermissionError] = useState(false);

  const fetchOrganicInsights = async () => {
    setIsLoading(true);
    setError(null);
    setIsPermissionError(false);

    try {
      console.log('🔄 Buscando insights orgânicos via edge function...');
      
      const { data, error: fetchError } = await supabase.functions.invoke('fetch-organic-insights', {
        body: { pageId, accessToken }
      });

      if (fetchError) {
        console.error('Edge function error:', fetchError);
        throw new Error(fetchError.message);
      }

      console.log('📊 Dados recebidos:', data);

      if (data.success && data.insights) {
        setInsights(data.insights);
        setDailyData(data.dailyData.map((d: any) => ({
          ...d,
          date: new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
        })));
        setIsRealData(!data.simulated);
        setPlatform(data.platform || 'facebook');
        
        if (data.simulated && data.message) {
          console.warn('⚠️', data.message);
        }
      } else {
        // API returned error or no data
        setInsights(null);
        setIsRealData(false);
        setIsPermissionError(data.isPermissionError || false);
        setError(data.message || data.error || 'Erro ao buscar dados');
        console.error('API Error:', data.error);
      }
      
    } catch (err) {
      console.error('Error fetching organic insights:', err);
      setError(err instanceof Error ? err.message : 'Erro ao buscar dados');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrganicInsights();
  }, [pageId, accessToken]);

  const chartConfig: ChartConfig = {
    followers: {
      label: "Seguidores",
      color: "hsl(var(--primary))",
    },
    newFollowers: {
      label: "Novos",
      color: "hsl(var(--chart-2))",
    },
    reach: {
      label: "Alcance",
      color: "hsl(var(--chart-3))",
    },
    engagement: {
      label: "Engajamento",
      color: "hsl(var(--chart-4))",
    },
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <Card className={isPermissionError ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-border/50"}>
        <CardContent className="py-12 text-center">
          <AlertCircle className={`h-12 w-12 mx-auto mb-4 ${isPermissionError ? 'text-red-500' : 'text-muted-foreground'}`} />
          {isPermissionError ? (
            <>
              <p className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
                Token sem permissões necessárias
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 max-w-md mx-auto">
                O token de acesso do Facebook não tem as permissões necessárias para buscar insights da página. 
                É necessário ter: <code className="bg-red-100 dark:bg-red-900 px-1 rounded">pages_read_engagement</code>,{' '}
                <code className="bg-red-100 dark:bg-red-900 px-1 rounded">read_insights</code> e{' '}
                <code className="bg-red-100 dark:bg-red-900 px-1 rounded">pages_show_list</code>.
              </p>
              <Button variant="outline" size="sm" onClick={fetchOrganicInsights} className="mt-4">
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar Novamente
              </Button>
            </>
          ) : error ? (
            <>
              <p className="text-muted-foreground mb-2">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchOrganicInsights} className="mt-2">
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar Novamente
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              Conecte sua página do Facebook/Instagram para ver métricas orgânicas.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Público Orgânico</h2>
          <p className="text-muted-foreground">Acompanhe o crescimento e engajamento do seu perfil</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOrganicInsights} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* KPIs Principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">Total Seguidores</span>
            </div>
            <p className="text-3xl font-bold">{insights.totalFollowers.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus className="h-5 w-5 text-green-500" />
              <span className="text-sm text-muted-foreground">Novos (7 dias)</span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-3xl font-bold text-green-600">+{insights.newFollowers.toLocaleString('pt-BR')}</p>
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                <TrendingUp className="h-3 w-3 mr-1" />
                {insights.followerChange.toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-5 w-5 text-blue-500" />
              <span className="text-sm text-muted-foreground">Alcance</span>
            </div>
            <p className="text-3xl font-bold">{insights.reach.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="h-5 w-5 text-red-500" />
              <span className="text-sm text-muted-foreground">Engajamento</span>
            </div>
            <p className="text-3xl font-bold">{insights.engagementRate.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Crescimento de Seguidores */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Crescimento de Seguidores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px]">
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis 
                  dataKey="date" 
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                />
                <YAxis 
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                  tickFormatter={(value) => value.toLocaleString('pt-BR')}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="followers"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.2)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Novos Seguidores por Dia */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-green-500" />
              Novos Seguidores por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px]">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis 
                  dataKey="date" 
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                />
                <YAxis 
                  tickLine={false}
                  axisLine={false}
                  className="text-xs"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="newFollowers"
                  fill="hsl(var(--chart-2))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Métricas de Engajamento */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Detalhes de Engajamento (7 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <Heart className="h-6 w-6 mx-auto mb-2 text-red-500" />
              <p className="text-2xl font-bold">{insights.likes.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Curtidas</p>
            </div>
            
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <MessageCircle className="h-6 w-6 mx-auto mb-2 text-blue-500" />
              <p className="text-2xl font-bold">{insights.comments.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Comentários</p>
            </div>
            
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <Share2 className="h-6 w-6 mx-auto mb-2 text-green-500" />
              <p className="text-2xl font-bold">{insights.shares.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Compartilhamentos</p>
            </div>
            
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <svg className="h-6 w-6 mx-auto mb-2 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-2xl font-bold">{insights.saves.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Salvos</p>
            </div>
            
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <Eye className="h-6 w-6 mx-auto mb-2 text-yellow-500" />
              <p className="text-2xl font-bold">{insights.profileViews.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Visitas ao Perfil</p>
            </div>
            
            <div className="text-center p-4 bg-muted/30 rounded-lg">
              <svg className="h-6 w-6 mx-auto mb-2 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <p className="text-2xl font-bold">{insights.websiteClicks.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Cliques no Site</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status da conexão */}
      {isRealData ? (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Dados Reais do {platform === 'facebook' ? 'Facebook' : 'Instagram'}
                </p>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  Os dados exibidos são obtidos diretamente da API do Meta.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Dados de Demonstração
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  Para ver dados reais, configure <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">FACEBOOK_PAGE_ID</code> e{' '}
                  <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">FACEBOOK_CAPI_ACCESS_TOKEN</code> nas secrets do backend.
                  O token precisa ter permissões <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">pages_read_engagement</code> e{' '}
                  <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">read_insights</code>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default OrganicMetrics;

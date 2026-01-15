import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Users, 
  UserPlus, 
  Heart, 
  MessageCircle, 
  Share2, 
  TrendingUp, 
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Instagram,
  Facebook,
  Play,
  Bookmark,
  LogOut,
  Reply,
  Calendar,
  Info,
  Settings,
  Key
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import TokenConfigGuide from "./TokenConfigGuide";

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
  // Stories metrics (Instagram only)
  storiesViews: number;
  storiesReplies: number;
  storiesExits: number;
  storiesReach: number;
  // Video views
  videoViews: number;
}

export interface DailyOrganicData {
  date: string;
  followers: number;
  newFollowers: number;
  reach: number;
  engagement: number;
}

// Track which metrics are unavailable due to API/permission limitations
interface UnavailableMetrics {
  reach?: string;
  impressions?: string;
  newFollowers?: string;
  profileViews?: string;
  websiteClicks?: string;
  shares?: string;
  saves?: string;
  storiesViews?: string;
  storiesReplies?: string;
  storiesExits?: string;
  storiesReach?: string;
}

interface PlatformData {
  platform: 'facebook' | 'instagram';
  accountId: string;
  accountName?: string;
  insights: OrganicInsights;
  dailyData: DailyOrganicData[];
  unavailableMetrics?: UnavailableMetrics;
}

interface OrganicMetricsProps {
  pageId?: string;
  accessToken?: string;
  isConnected: boolean;
}

const OrganicMetrics = ({ pageId, accessToken, isConnected }: OrganicMetricsProps) => {
  const [platforms, setPlatforms] = useState<PlatformData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // For subtle loading when period changes
  const [error, setError] = useState<string | null>(null);
  const [isRealData, setIsRealData] = useState(false);
  const [isPermissionError, setIsPermissionError] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('instagram');
  const [period, setPeriod] = useState<string>("7");
  const [customDateRange, setCustomDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined
  });
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  // Get the display label for the period
  const getPeriodLabel = () => {
    if (period === "custom" && customDateRange.from && customDateRange.to) {
      const days = differenceInDays(customDateRange.to, customDateRange.from) + 1;
      return `${days} dias`;
    }
    if (period === "1") return "Hoje";
    return `${period} dias`;
  };

  // Handle period change
  const handlePeriodChange = (value: string) => {
    if (value === "custom") {
      setIsCustomDateOpen(true);
    } else {
      setPeriod(value);
      setCustomDateRange({ from: undefined, to: undefined });
    }
  };

  // Apply custom date range
  const applyCustomDateRange = () => {
    if (customDateRange.from && customDateRange.to) {
      const days = differenceInDays(customDateRange.to, customDateRange.from) + 1;
      setPeriod("custom");
      setIsCustomDateOpen(false);
    }
  };

  // Cache key to avoid refetching same data
  const [lastFetchKey, setLastFetchKey] = useState<string>('');

  const fetchOrganicInsights = async () => {
    // Build fetch key to detect actual changes
    const fetchKey = `${pageId}-${accessToken}-${period}-${customDateRange.from?.toISOString()}-${customDateRange.to?.toISOString()}`;
    
    // Skip if same request
    if (fetchKey === lastFetchKey && platforms.length > 0) {
      console.log('⏭️ Skipping fetch - same parameters');
      return;
    }

    // Use isRefreshing for subtle loading when we have existing data
    const hasExistingData = platforms.length > 0;
    if (hasExistingData) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    setIsPermissionError(false);

    try {
      // Determine the actual period to send
      let periodDays = parseInt(period);
      if (period === "custom" && customDateRange.from && customDateRange.to) {
        periodDays = differenceInDays(customDateRange.to, customDateRange.from) + 1;
      }

      console.log('🔄 Buscando insights orgânicos - período:', periodDays, 'dias');
      
      const { data, error: fetchError } = await supabase.functions.invoke('fetch-organic-insights', {
        body: { pageId, accessToken, period: periodDays }
      });

      if (fetchError) {
        console.error('Edge function error:', fetchError);
        throw new Error(fetchError.message);
      }

      console.log('📊 Dados recebidos para', periodDays, 'dias:', data);

      if (data.success && data.platforms?.length > 0) {
        const processedPlatforms = data.platforms.map((p: PlatformData & { unavailableMetrics?: UnavailableMetrics }) => ({
          ...p,
          unavailableMetrics: p.unavailableMetrics,
          dailyData: p.dailyData.map((d: any) => ({
            ...d,
            date: new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
          }))
        }));
        setPlatforms(processedPlatforms);
        setIsRealData(!data.simulated);
        setLastFetchKey(fetchKey);
        
        // Set active tab to first available platform
        if (processedPlatforms.length > 0) {
          const hasInstagram = processedPlatforms.some((p: PlatformData) => p.platform === 'instagram');
          setActiveTab(hasInstagram ? 'instagram' : 'facebook');
        }
        
        if (data.simulated && data.message) {
          console.warn('⚠️', data.message);
        }
      } else {
        setPlatforms([]);
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
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrganicInsights();
  }, [pageId, accessToken, period, customDateRange.from, customDateRange.to]);

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

  if (platforms.length === 0) {
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
                O token de acesso não tem as permissões necessárias. 
                Para Instagram: <code className="bg-red-100 dark:bg-red-900 px-1 rounded">instagram_basic</code>,{' '}
                <code className="bg-red-100 dark:bg-red-900 px-1 rounded">instagram_manage_insights</code>.
                Para Facebook: <code className="bg-red-100 dark:bg-red-900 px-1 rounded">pages_read_engagement</code>,{' '}
                <code className="bg-red-100 dark:bg-red-900 px-1 rounded">read_insights</code>.
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

  // Skeleton overlay component for subtle loading
  const SkeletonOverlay = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`relative ${className}`}>
      {children}
      {isRefreshing && (
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-10 transition-opacity duration-200">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">Atualizando...</span>
          </div>
        </div>
      )}
    </div>
  );

  // Component to show unavailable metric indicator
  const UnavailableMetricIndicator = ({ reason, value }: { reason?: string; value: number }) => {
    if (value !== 0 || !reason) return null;
    
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3 text-amber-500" />
              <span className="text-xs text-amber-600 dark:text-amber-400">Indisponível</span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{reason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Wrapper component for metrics that might be unavailable
  const MetricValue = ({ 
    value, 
    unavailableReason, 
    format = 'number',
    suffix = ''
  }: { 
    value: number; 
    unavailableReason?: string;
    format?: 'number' | 'percent';
    suffix?: string;
  }) => {
    const formattedValue = format === 'percent' 
      ? `${value.toFixed(2)}%` 
      : value.toLocaleString('pt-BR');
    
    const isUnavailable = value === 0 && unavailableReason;
    
    return (
      <div>
        <p className={`text-2xl font-bold ${isUnavailable ? 'text-muted-foreground/50' : ''}`}>
          {formattedValue}{suffix}
        </p>
        {isUnavailable && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 mt-1 cursor-help">
                  <AlertCircle className="h-3 w-3 text-amber-500" />
                  <span className="text-xs text-amber-600 dark:text-amber-400">Indisponível</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">{unavailableReason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  };

  const renderPlatformMetrics = (platformData: PlatformData) => {
    const { insights, dailyData, accountName, platform, unavailableMetrics } = platformData;
    const isInstagram = platform === 'instagram';

    return (
      <div className="space-y-6">
        {/* Account Name Badge */}
        <div className="flex items-center gap-2">
          {isInstagram ? (
            <Instagram className="h-5 w-5 text-pink-500" />
          ) : (
            <Facebook className="h-5 w-5 text-blue-600" />
          )}
          <span className="font-medium">{accountName}</span>
          <Badge variant="secondary" className={isInstagram ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white" : "bg-blue-600 text-white"}>
            {isInstagram ? 'Instagram' : 'Facebook'}
          </Badge>
          {unavailableMetrics && Object.keys(unavailableMetrics).length > 0 && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-700 cursor-help">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Algumas métricas limitadas
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <p className="font-medium mb-1">Métricas com dados limitados:</p>
                    <p className="text-xs text-muted-foreground">
                      Algumas métricas exibem 0 porque requerem permissões adicionais da API do Meta.
                      Procure por indicadores amarelos "Indisponível" para ver detalhes.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <Dialog open={showPermissionGuide} onOpenChange={setShowPermissionGuide}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950/30">
                    <Key className="h-3 w-3" />
                    Solicitar Permissões
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                  <TokenConfigGuide onClose={() => setShowPermissionGuide(false)} />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>

        {/* KPIs */}
        <SkeletonOverlay>
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

            <Card className={`border-border/50 ${unavailableMetrics?.newFollowers && insights.newFollowers === 0 ? 'border-amber-200 dark:border-amber-800' : ''}`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <UserPlus className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">Novos ({getPeriodLabel()})</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <MetricValue 
                    value={insights.newFollowers} 
                    unavailableReason={unavailableMetrics?.newFollowers}
                    suffix=""
                  />
                  {insights.followerChange > 0 && !unavailableMetrics?.newFollowers && (
                    <Badge variant="secondary" className="bg-green-100 text-green-700">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {insights.followerChange.toFixed(1)}%
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className={`border-border/50 ${unavailableMetrics?.reach && insights.reach === 0 ? 'border-amber-200 dark:border-amber-800' : ''}`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="h-5 w-5 text-blue-500" />
                  <span className="text-sm text-muted-foreground">Alcance</span>
                </div>
                <MetricValue 
                  value={insights.reach} 
                  unavailableReason={unavailableMetrics?.reach}
                />
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
        </SkeletonOverlay>

        {/* Charts */}
        <SkeletonOverlay>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      stroke={isInstagram ? "#E1306C" : "#1877F2"}
                      fill={isInstagram ? "rgba(225, 48, 108, 0.2)" : "rgba(24, 119, 242, 0.2)"}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

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
                      fill={isInstagram ? "#E1306C" : "#1877F2"}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </SkeletonOverlay>

        {/* Engagement Details */}
        <SkeletonOverlay>
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Detalhes de Engajamento ({getPeriodLabel()})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <Heart className="h-6 w-6 mx-auto mb-2 text-red-500" />
                  <p className="text-2xl font-bold">{insights.likes.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-muted-foreground">Curtidas</p>
                </div>
                
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-center p-4 bg-muted/30 rounded-lg cursor-help relative">
                        <Info className="h-3 w-3 absolute top-2 right-2 text-muted-foreground/50" />
                        <MessageCircle className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                        <p className="text-2xl font-bold">{insights.comments.toLocaleString('pt-BR')}</p>
                        <p className="text-xs text-muted-foreground">Comentários</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="font-medium">Comentários Recebidos</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        A API do Instagram/Facebook só fornece dados de comentários recebidos nos seus posts. 
                        Comentários que sua página fez em outros perfis não são contabilizados.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                
                <div className={`text-center p-4 rounded-lg ${unavailableMetrics?.shares && insights.shares === 0 ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                  <Share2 className="h-6 w-6 mx-auto mb-2 text-green-500" />
                  <MetricValue 
                    value={insights.shares} 
                    unavailableReason={unavailableMetrics?.shares}
                  />
                  <p className="text-xs text-muted-foreground">Compartilhamentos</p>
                </div>
                
                {isInstagram && (
                  <div className={`text-center p-4 rounded-lg ${unavailableMetrics?.saves && insights.saves === 0 ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                    <Bookmark className="h-6 w-6 mx-auto mb-2 text-purple-500" />
                    <MetricValue 
                      value={insights.saves} 
                      unavailableReason={unavailableMetrics?.saves}
                    />
                    <p className="text-xs text-muted-foreground">Salvos</p>
                  </div>
                )}

                {isInstagram && (
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <Play className="h-6 w-6 mx-auto mb-2 text-orange-500" />
                    <p className="text-2xl font-bold">{insights.videoViews.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Visualizações de Vídeo</p>
                  </div>
                )}
                
                <div className={`text-center p-4 rounded-lg ${unavailableMetrics?.profileViews && insights.profileViews === 0 ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                  <Eye className="h-6 w-6 mx-auto mb-2 text-yellow-500" />
                  <MetricValue 
                    value={insights.profileViews} 
                    unavailableReason={unavailableMetrics?.profileViews}
                  />
                  <p className="text-xs text-muted-foreground">Visitas ao Perfil</p>
                </div>
                
                <div className={`text-center p-4 rounded-lg ${unavailableMetrics?.websiteClicks && insights.websiteClicks === 0 ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/30'}`}>
                  <svg className="h-6 w-6 mx-auto mb-2 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <MetricValue 
                    value={insights.websiteClicks} 
                    unavailableReason={unavailableMetrics?.websiteClicks}
                  />
                  <p className="text-xs text-muted-foreground">Cliques no Site</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </SkeletonOverlay>

        {/* Instagram Stories Metrics */}
        {isInstagram && (insights.storiesViews > 0 || insights.storiesReach > 0 || insights.storiesReplies > 0) && (
          <SkeletonOverlay>
            <Card className="border-border/50 bg-gradient-to-br from-pink-500/5 to-purple-500/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                  </div>
                  Stories do Instagram
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <Eye className="h-6 w-6 mx-auto mb-2 text-pink-500" />
                    <p className="text-2xl font-bold">{insights.storiesViews.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Visualizações</p>
                  </div>
                  
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <Users className="h-6 w-6 mx-auto mb-2 text-purple-500" />
                    <p className="text-2xl font-bold">{insights.storiesReach.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Alcance</p>
                  </div>
                  
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <Reply className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                    <p className="text-2xl font-bold">{insights.storiesReplies.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Respostas</p>
                  </div>
                  
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <LogOut className="h-6 w-6 mx-auto mb-2 text-red-400" />
                    <p className="text-2xl font-bold">{insights.storiesExits.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-muted-foreground">Saídas</p>
                  </div>
                </div>
                
                {insights.storiesViews > 0 && insights.storiesExits > 0 && (
                  <div className="mt-4 p-3 bg-muted/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Taxa de Retenção: </span>
                      {((1 - (insights.storiesExits / insights.storiesViews)) * 100).toFixed(1)}% 
                      dos espectadores assistiram até o final
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </SkeletonOverlay>
        )}

        {/* Show placeholder if no stories data */}
        {isInstagram && insights.storiesViews === 0 && insights.storiesReach === 0 && (
          <Card className="border-border/50 border-dashed">
            <CardContent className="py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center mx-auto mb-4 opacity-50">
                <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </div>
              <p className="text-muted-foreground text-sm">
                Nenhum Story publicado recentemente ou sem dados disponíveis.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Stories expiram após 24h - métricas aparecem quando há stories ativos.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const instagramData = platforms.find(p => p.platform === 'instagram');
  const facebookData = platforms.find(p => p.platform === 'facebook');

  const renderComparisonCard = () => {
    if (!instagramData || !facebookData) return null;

    // Helper to check if a metric is available for Facebook
    const isFacebookMetricAvailable = (metricValue: number | undefined, metricName: string) => {
      // Facebook doesn't support saves and video views in the same way
      const unsupportedFBMetrics = ['saves', 'videoViews'];
      if (unsupportedFBMetrics.includes(metricName)) return false;
      return true;
    };

    const compareMetrics = [
      {
        label: 'Seguidores',
        icon: Users,
        instagram: instagramData.insights.totalFollowers,
        facebook: facebookData.insights.totalFollowers,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'followers'
      },
      {
        label: `Novos (${getPeriodLabel()})`,
        icon: UserPlus,
        instagram: instagramData.insights.newFollowers,
        facebook: facebookData.insights.newFollowers,
        format: (v: number) => `+${v.toLocaleString('pt-BR')}`,
        colorClass: 'text-green-600',
        metricName: 'newFollowers'
      },
      {
        label: 'Alcance',
        icon: Eye,
        instagram: instagramData.insights.reach,
        facebook: facebookData.insights.reach,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'reach'
      },
      {
        label: 'Engajamento',
        icon: Heart,
        instagram: instagramData.insights.engagementRate,
        facebook: facebookData.insights.engagementRate,
        format: (v: number) => `${v.toFixed(2)}%`,
        metricName: 'engagementRate'
      },
      {
        label: 'Curtidas',
        icon: Heart,
        instagram: instagramData.insights.likes,
        facebook: facebookData.insights.likes,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'likes'
      },
      {
        label: 'Comentários',
        icon: MessageCircle,
        instagram: instagramData.insights.comments,
        facebook: facebookData.insights.comments,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'comments'
      },
      {
        label: 'Compartilhamentos',
        icon: Share2,
        instagram: instagramData.insights.shares,
        facebook: facebookData.insights.shares,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'shares'
      },
      {
        label: 'Salvos',
        icon: Bookmark,
        instagram: instagramData.insights.saves,
        facebook: 0, // Facebook doesn't have saves
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'saves',
        fbUnavailable: true
      },
      {
        label: 'Visualizações de Vídeo',
        icon: Play,
        instagram: instagramData.insights.videoViews,
        facebook: 0, // Facebook video views require different API
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'videoViews',
        fbUnavailable: true
      },
      {
        label: 'Visitas ao Perfil',
        icon: Eye,
        instagram: instagramData.insights.profileViews,
        facebook: facebookData.insights.profileViews,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'profileViews'
      }
    ];

    return (
      <SkeletonOverlay>
        <Card className="border-border/50 bg-gradient-to-br from-background to-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Comparativo de Plataformas
            </CardTitle>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={period === "custom" ? "custom" : period} onValueChange={handlePeriodChange}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue placeholder="Período">
                    {period === "custom" && customDateRange.from && customDateRange.to 
                      ? `${format(customDateRange.from, "dd/MM")} - ${format(customDateRange.to, "dd/MM")}`
                      : period === "1" ? "Hoje" : `${period} dias`
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Hoje</SelectItem>
                  <SelectItem value="7">7 dias</SelectItem>
                  <SelectItem value="14">14 dias</SelectItem>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="90">90 dias</SelectItem>
                  <SelectItem value="custom">Personalizado...</SelectItem>
                </SelectContent>
              </Select>

              {/* Custom Date Range Popover */}
              <Popover open={isCustomDateOpen} onOpenChange={setIsCustomDateOpen}>
                <PopoverTrigger asChild>
                  <span />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-4" align="end">
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm">Selecione o período</h4>
                    <CalendarComponent
                      mode="range"
                      selected={{ from: customDateRange.from, to: customDateRange.to }}
                      onSelect={(range) => setCustomDateRange({ from: range?.from, to: range?.to })}
                      locale={ptBR}
                      disabled={(date) => date > new Date()}
                      numberOfMonths={2}
                      className="rounded-md border"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {customDateRange.from && customDateRange.to && (
                          <>
                            {format(customDateRange.from, "dd/MM/yyyy", { locale: ptBR })} - {format(customDateRange.to, "dd/MM/yyyy", { locale: ptBR })}
                            {" "}({differenceInDays(customDateRange.to, customDateRange.from) + 1} dias)
                          </>
                        )}
                      </div>
                      <Button 
                        size="sm" 
                        onClick={applyCustomDateRange}
                        disabled={!customDateRange.from || !customDateRange.to}
                      >
                        Aplicar
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Métrica</th>
                  <th className="text-center py-3 px-2">
                    <div className="flex items-center justify-center gap-2">
                      <Instagram className="h-5 w-5 text-pink-500" />
                      <span className="text-sm font-medium">Instagram</span>
                    </div>
                  </th>
                  <th className="text-center py-3 px-2">
                    <div className="flex items-center justify-center gap-2">
                      <Facebook className="h-5 w-5 text-blue-600" />
                      <span className="text-sm font-medium">Facebook</span>
                    </div>
                  </th>
                  <th className="text-center py-3 px-2 text-sm font-medium text-muted-foreground">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {compareMetrics.map((metric, index) => {
                  const diff = metric.instagram - metric.facebook;
                  const diffPercent = metric.facebook > 0 ? ((diff / metric.facebook) * 100) : 0;
                  const IconComponent = metric.icon;
                  const isFbUnavailable = (metric as any).fbUnavailable;
                  
                  return (
                    <tr key={index} className="border-b border-border/30 last:border-0">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{metric.label}</span>
                        </div>
                      </td>
                      <td className={`text-center py-3 px-2 font-semibold ${metric.colorClass || ''}`}>
                        {metric.format(metric.instagram)}
                      </td>
                      <td className={`text-center py-3 px-2 font-semibold ${metric.colorClass || ''}`}>
                        {isFbUnavailable ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground/50 text-xs cursor-help flex items-center justify-center gap-1">
                                  <Info className="h-3 w-3" />
                                  N/D
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Esta métrica não está disponível para Facebook</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          metric.format(metric.facebook)
                        )}
                      </td>
                      <td className="text-center py-3 px-2">
                        {isFbUnavailable ? (
                          <Badge variant="outline" className="text-muted-foreground/50 text-xs">
                            Só Instagram
                          </Badge>
                        ) : diff !== 0 ? (
                          <Badge 
                            variant="secondary" 
                            className={diff > 0 
                              ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" 
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            }
                          >
                            {diff > 0 ? (
                              <><Instagram className="h-3 w-3 mr-1" /> +{Math.abs(diffPercent).toFixed(0)}%</>
                            ) : (
                              <><Facebook className="h-3 w-3 mr-1" /> +{Math.abs(diffPercent).toFixed(0)}%</>
                            )}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Igual</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="p-4 rounded-lg bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-200/50 dark:border-pink-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Instagram className="h-5 w-5 text-pink-500" />
                <span className="font-medium text-sm">{instagramData.accountName}</span>
              </div>
              <p className="text-2xl font-bold">{instagramData.insights.totalFollowers.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">seguidores</p>
            </div>
            <div className="p-4 rounded-lg bg-gradient-to-br from-blue-500/10 to-blue-600/10 border border-blue-200/50 dark:border-blue-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Facebook className="h-5 w-5 text-blue-600" />
                <span className="font-medium text-sm">{facebookData.accountName}</span>
              </div>
              <p className="text-2xl font-bold">{facebookData.insights.totalFollowers.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">seguidores</p>
            </div>
          </div>

          {/* Total Combined */}
          <div className="mt-4 p-4 rounded-lg bg-muted/30 text-center">
            <p className="text-sm text-muted-foreground mb-1">Total Combinado</p>
            <p className="text-3xl font-bold text-primary">
              {(instagramData.insights.totalFollowers + facebookData.insights.totalFollowers).toLocaleString('pt-BR')}
            </p>
            <p className="text-xs text-muted-foreground">seguidores nas duas plataformas</p>
          </div>
        </CardContent>
      </Card>
      </SkeletonOverlay>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Público Orgânico</h2>
          <p className="text-muted-foreground">Acompanhe o crescimento e engajamento dos seus perfis</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOrganicInsights} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Comparison Card - Only show if both platforms available */}
      {renderComparisonCard()}

      {/* Platform Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger 
            value="instagram" 
            disabled={!instagramData}
            className="flex items-center gap-2"
          >
            <Instagram className="h-4 w-4" />
            Instagram
            {instagramData && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {instagramData.insights.totalFollowers.toLocaleString('pt-BR')}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="facebook" 
            disabled={!facebookData}
            className="flex items-center gap-2"
          >
            <Facebook className="h-4 w-4" />
            Facebook
            {facebookData && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {facebookData.insights.totalFollowers.toLocaleString('pt-BR')}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instagram" className="mt-6">
          {instagramData ? renderPlatformMetrics(instagramData) : (
            <Card className="border-border/50">
              <CardContent className="py-8 text-center">
                <Instagram className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Instagram não conectado</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="facebook" className="mt-6">
          {facebookData ? renderPlatformMetrics(facebookData) : (
            <Card className="border-border/50">
              <CardContent className="py-8 text-center">
                <Facebook className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Facebook não conectado</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Status */}
      {isRealData ? (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Dados Reais Conectados
                </p>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  Exibindo dados de {platforms.map(p => p.platform === 'instagram' ? 'Instagram' : 'Facebook').join(' e ')}.
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
                  Configure as secrets do backend para ver dados reais.
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

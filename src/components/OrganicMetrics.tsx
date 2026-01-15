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
  Key,
  ExternalLink
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

  const instagramData = platforms.find(p => p.platform === 'instagram');
  const facebookData = platforms.find(p => p.platform === 'facebook');

  const renderComparisonCard = () => {
    if (!instagramData || !facebookData) return null;

    // Helper to check if a metric is available for Facebook
    // Check for unavailable metrics in either platform
    const igUnavailable = instagramData.unavailableMetrics || {};
    const fbUnavailable = facebookData.unavailableMetrics || {};
    const hasUnavailableMetrics = Object.keys(igUnavailable).length > 0 || Object.keys(fbUnavailable).length > 0;

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
        metricName: 'newFollowers',
        igUnavailable: igUnavailable.newFollowers,
        fbUnavailableReason: fbUnavailable.newFollowers
      },
      {
        label: 'Alcance',
        icon: Eye,
        instagram: instagramData.insights.reach,
        facebook: facebookData.insights.reach,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'reach',
        igUnavailable: igUnavailable.reach,
        fbUnavailableReason: fbUnavailable.reach
      },
      {
        label: 'Impressões',
        icon: Eye,
        instagram: instagramData.insights.impressions,
        facebook: facebookData.insights.impressions,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'impressions',
        igUnavailable: igUnavailable.impressions
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
        metricName: 'shares',
        igUnavailable: igUnavailable.shares
      },
      {
        label: 'Salvos',
        icon: Bookmark,
        instagram: instagramData.insights.saves,
        facebook: 0,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'saves',
        fbUnavailable: true,
        igUnavailable: igUnavailable.saves
      },
      {
        label: 'Visualizações de Vídeo',
        icon: Play,
        instagram: instagramData.insights.videoViews,
        facebook: 0,
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
        metricName: 'profileViews',
        igUnavailable: igUnavailable.profileViews
      },
      {
        label: 'Cliques no Site',
        icon: ExternalLink,
        instagram: instagramData.insights.websiteClicks,
        facebook: facebookData.insights.websiteClicks,
        format: (v: number) => v.toLocaleString('pt-BR'),
        metricName: 'websiteClicks',
        igUnavailable: igUnavailable.websiteClicks
      }
    ];

    // Render unavailable indicator for a metric value
    const renderMetricValue = (value: number, format: (v: number) => string, unavailableReason?: string, colorClass?: string) => {
      const isUnavailable = value === 0 && unavailableReason;
      
      if (isUnavailable) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground/50 text-xs cursor-help flex items-center justify-center gap-1">
                  <AlertCircle className="h-3 w-3 text-amber-500" />
                  0
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">{unavailableReason}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }
      
      return <span className={colorClass}>{format(value)}</span>;
    };

    return (
      <SkeletonOverlay>
        <Card className="border-border/50 bg-gradient-to-br from-background to-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Comparativo de Plataformas
              </CardTitle>
              
              {hasUnavailableMetrics && (
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
              )}
            </div>
            
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
          
          {hasUnavailableMetrics && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              <span>Algumas métricas estão indisponíveis por falta de permissões na API</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
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
          <div className="p-4 rounded-lg bg-muted/30 text-center">
            <p className="text-sm text-muted-foreground mb-1">Total Combinado</p>
            <p className="text-3xl font-bold text-primary">
              {(instagramData.insights.totalFollowers + facebookData.insights.totalFollowers).toLocaleString('pt-BR')}
            </p>
            <p className="text-xs text-muted-foreground">seguidores nas duas plataformas</p>
          </div>

          {/* Comparison Table */}
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
                  const igUnavailableReason = (metric as any).igUnavailable;
                  const fbUnavailableReason = (metric as any).fbUnavailableReason;
                  
                  return (
                    <tr key={index} className="border-b border-border/30 last:border-0">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{metric.label}</span>
                        </div>
                      </td>
                      <td className={`text-center py-3 px-2 font-semibold`}>
                        {renderMetricValue(metric.instagram, metric.format, igUnavailableReason, metric.colorClass)}
                      </td>
                      <td className={`text-center py-3 px-2 font-semibold`}>
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
                          renderMetricValue(metric.facebook, metric.format, fbUnavailableReason, metric.colorClass)
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

      {/* Consolidated Comparison Card */}
      {renderComparisonCard()}

      {/* Status indicator - compact */}
      {!isRealData && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4" />
          <span>Dados de demonstração - Configure o backend para ver dados reais</span>
        </div>
      )}
    </div>
  );
};

export default OrganicMetrics;

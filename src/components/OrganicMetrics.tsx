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
import { format, differenceInDays, startOfWeek, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
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
  ExternalLink,
  Wifi,
  WifiOff,
  Clock,
  UserCheck
} from "lucide-react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis, CartesianGrid, Line, LineChart, Legend, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import TokenConfigGuide from "./TokenConfigGuide";
import { useOrganicCache } from "@/hooks/useOrganicCache";
import { ContentTypeBreakdownComponent } from "./ContentTypeBreakdown";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

// Content type breakdown interface
interface ContentTypeBreakdown {
  reels: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    count: number;
  };
  feed: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    count: number;
  };
  stories: {
    views: number;
    replies: number;
    exits: number;
    reach: number;
    count: number;
  };
  carousel: {
    views: number;
    likes: number;
    comments: number;
    saves: number;
    reach: number;
    count: number;
  };
}

export interface OrganicInsights {
  totalFollowers: number;
  followingCount: number;
  netFollowerChange: number;
  followerChangePercent: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  totalInteractions: number; // From Instagram API - includes likes, comments, saves, shares, replies
  profileViews: number;
  websiteClicks: number;
  // Stories metrics (Instagram only)
  storiesViews: number;
  storiesReplies: number;
  storiesExits: number;
  storiesReach: number;
  // Video views
  videoViews: number;
  // Data freshness
  dataUpdatedAt?: string; // ISO date of when the API data was last updated
  // Content breakdown
  contentBreakdown?: ContentTypeBreakdown;
}

export interface DailyOrganicData {
  date: string;
  followers: number;
  netChange: number;
  reach: number;
  engagement: number;
}

// Track which metrics are unavailable due to API/permission limitations
interface UnavailableMetrics {
  reach?: string;
  impressions?: string;
  netFollowerChange?: string;
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
  onMetricsChange?: (data: { impressions: number; reach: number }) => void;
  externalPeriod?: string; // Period from parent Dashboard for synchronization
}

// Map Dashboard period values to OrganicMetrics internal values
const mapExternalPeriod = (external: string): string => {
  const mapping: Record<string, string> = {
    'today': '1',
    'yesterday': 'yesterday',
    'last_7d': '7',
    'last_15d': '14',
    'last_30d': '30',
    'last_60d': '60',
    'last_90d': '90',
    'this_month': 'this_month',
    'last_month': '30',
    'this_quarter': '90',
    'this_semester': 'this_semester',
    'this_year': 'this_year'
  };
  return mapping[external] || '7';
};

const OrganicMetrics = ({ pageId, accessToken, isConnected, onMetricsChange, externalPeriod }: OrganicMetricsProps) => {
  const [platforms, setPlatforms] = useState<PlatformData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // For subtle loading when period changes
  const [error, setError] = useState<string | null>(null);
  const [isRealData, setIsRealData] = useState(false);
  const [isPermissionError, setIsPermissionError] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('instagram');
  
  // Use external period if provided, otherwise use internal state
  const [internalPeriod, setInternalPeriod] = useState<string>("7");
  const period = externalPeriod ? mapExternalPeriod(externalPeriod) : internalPeriod;
  const setPeriod = setInternalPeriod; // For backwards compatibility
  
  const [customDateRange, setCustomDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined
  });
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  // Helper to calculate period in days from preset
  const getPresetPeriodDays = (preset: string): number => {
    const today = new Date();
    switch (preset) {
      case 'this_week': 
        return differenceInDays(today, startOfWeek(today, { weekStartsOn: 0 })) + 1;
      case 'this_month':
        return differenceInDays(today, startOfMonth(today)) + 1;
      case 'this_semester':
        const semesterStart = today.getMonth() < 6 
          ? new Date(today.getFullYear(), 0, 1)
          : new Date(today.getFullYear(), 6, 1);
        return differenceInDays(today, semesterStart) + 1;
      case 'this_year':
        return differenceInDays(today, startOfYear(today)) + 1;
      default:
        return parseInt(preset) || 7;
    }
  };

  // Get the display label for the period
  const getPeriodLabel = () => {
    if (period === "custom" && customDateRange.from && customDateRange.to) {
      const days = differenceInDays(customDateRange.to, customDateRange.from) + 1;
      return `${days} dias`;
    }
    switch (period) {
      case "1": return "Hoje";
      case "yesterday": return "Ontem";
      case "this_week": return "Esta semana";
      case "this_month": return "Este mês";
      case "this_semester": return "Este semestre";
      case "this_year": return "Este ano";
      default: return `${period} dias`;
    }
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

  // Apply custom date range (supports single date or range)
  const applyCustomDateRange = () => {
    if (customDateRange.from) {
      // If only from is set (single click), set to as well for single day
      if (!customDateRange.to) {
        setCustomDateRange({ from: customDateRange.from, to: customDateRange.from });
      }
      setPeriod("custom");
      setIsCustomDateOpen(false);
    }
  };

  // Cache hook for 5-minute local caching
  const { getCachedData, setCachedData, clearCache, getCacheAge } = useOrganicCache();
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  const fetchOrganicInsights = async (forceRefresh = false) => {
    // Debug log para rastrear token
    console.log('🔧 [OrganicMetrics Debug] Iniciando fetch:', {
      hasAccessToken: !!accessToken,
      accessTokenLength: accessToken?.length || 0,
      pageId: pageId || 'não definido',
      period,
      forceRefresh
    });

    // Build fetch key to detect actual changes
    const fetchKey = `${pageId}-${accessToken}-${period}-${customDateRange.from?.toISOString()}-${customDateRange.to?.toISOString()}`;
    
    // Check local cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCachedData(fetchKey);
      if (cached) {
        console.log('📦 Usando dados do cache local');
        setPlatforms(cached.platforms);
        setIsRealData(cached.isRealData);
        setCacheAge(getCacheAge());
        return;
      }
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
      let periodDays: number;
      if (period === "custom" && customDateRange.from && customDateRange.to) {
        periodDays = differenceInDays(customDateRange.to, customDateRange.from) + 1;
      } else if (period === "yesterday") {
        periodDays = 1; // Yesterday is 1 day of data
      } else if (['this_week', 'this_month', 'this_semester', 'this_year'].includes(period)) {
        periodDays = getPresetPeriodDays(period);
      } else {
        periodDays = parseInt(period) || 7;
      }

      console.log('🔄 Buscando insights orgânicos - período:', periodDays, 'dias');
      console.log('🔧 [OrganicMetrics Debug] Payload para Edge Function:', {
        pageId,
        hasAccessToken: !!accessToken,
        period: periodDays
      });
      
      const { data, error: fetchError } = await cloudFunctions.invoke('fetch-organic-insights', {
        body: { pageId, accessToken, period: periodDays }
      });

      console.log('🔧 [OrganicMetrics Debug] Resposta da Edge Function:', {
        success: data?.success,
        isRealData: data?.isRealData,
        platformsCount: data?.platforms?.length || 0,
        error: data?.error || fetchError?.message
      });

      if (fetchError) {
        console.error('Edge function error:', fetchError);
        throw new Error(fetchError.message);
      }

      console.log('📊 Dados recebidos para', periodDays, 'dias:', data);

      if (data.success && data.platforms?.length > 0) {
        const processedPlatforms = data.platforms.map((p: any) => {
          // Normalize insights from API response to match OrganicInsights interface
          const apiInsights = p.insights || {};
          const normalizedInsights: OrganicInsights = {
            // Map API fields to expected interface fields
            totalFollowers: apiInsights.followers ?? apiInsights.totalFollowers ?? 0,
            followingCount: apiInsights.followingCount ?? 0,
            netFollowerChange: apiInsights.followersChange ?? apiInsights.netFollowerChange ?? 0,
            followerChangePercent: apiInsights.followersChangePercent ?? apiInsights.followerChangePercent ?? 0,
            reach: apiInsights.reach ?? 0,
            impressions: apiInsights.impressions ?? 0,
            engagementRate: apiInsights.engagementRate ?? 0,
            likes: apiInsights.likes ?? 0,
            comments: apiInsights.comments ?? 0,
            shares: apiInsights.shares ?? 0,
            saves: apiInsights.saves ?? 0,
            totalInteractions: apiInsights.totalInteractions ?? apiInsights.engagement ?? (
              (apiInsights.likes ?? 0) + (apiInsights.comments ?? 0) + (apiInsights.saves ?? 0) + (apiInsights.shares ?? 0)
            ),
            profileViews: apiInsights.profileViews ?? 0,
            websiteClicks: apiInsights.websiteClicks ?? 0,
            storiesViews: apiInsights.storiesViews ?? 0,
            storiesReplies: apiInsights.storiesReplies ?? 0,
            storiesExits: apiInsights.storiesExits ?? 0,
            storiesReach: apiInsights.storiesReach ?? 0,
            videoViews: apiInsights.videoViews ?? 0,
            dataUpdatedAt: apiInsights.dataUpdatedAt,
            contentBreakdown: apiInsights.contentBreakdown,
          };

          return {
            ...p,
            insights: normalizedInsights,
            unavailableMetrics: p.unavailableMetrics || {},
            dailyData: (p.dailyData || []).map((d: any) => ({
              ...d,
              date: new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
            }))
          };
        });
        setPlatforms(processedPlatforms);
        setIsRealData(!data.simulated);
        
        // Save to local cache
        setCachedData({
          platforms: processedPlatforms,
          isRealData: !data.simulated,
          fetchKey,
        });
        setCacheAge(0);
        
        // Set active tab to first available platform
        if (processedPlatforms.length > 0) {
          const hasInstagram = processedPlatforms.some((p: PlatformData) => p.platform === 'instagram');
          setActiveTab(hasInstagram ? 'instagram' : 'facebook');
          
          // Notify parent of organic metrics for ViewsBreakdown
          if (onMetricsChange) {
            const totalImpressions = processedPlatforms.reduce((sum: number, p: PlatformData) => sum + (p.insights.impressions || 0), 0);
            const totalReach = processedPlatforms.reduce((sum: number, p: PlatformData) => sum + (p.insights.reach || 0), 0);
            onMetricsChange({ impressions: totalImpressions, reach: totalReach });
          }
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

  // Force refresh handler (bypasses cache)
  const handleForceRefresh = () => {
    clearCache();
    fetchOrganicInsights(true);
  };

  useEffect(() => {
    fetchOrganicInsights();
  }, [pageId, accessToken, period, customDateRange.from, customDateRange.to]);

  // Update cache age every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const age = getCacheAge();
      if (age !== null) {
        setCacheAge(age);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const chartConfig: ChartConfig = {
    followers: {
      label: "Seguidores",
      color: "hsl(var(--primary))",
    },
    netChange: {
      label: "Saldo",
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
              <Button variant="outline" size="sm" onClick={handleForceRefresh} className="mt-4">
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar Novamente
              </Button>
            </>
          ) : error ? (
            <>
              <p className="text-muted-foreground mb-2">{error}</p>
              <Button variant="outline" size="sm" onClick={handleForceRefresh} className="mt-2">
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

    // Safe format helper to handle undefined/null values
    const safeFormat = (v: number | undefined | null) => (v ?? 0).toLocaleString('pt-BR');
    const safeFormatPercent = (v: number | undefined | null) => `${(v ?? 0).toFixed(2)}%`;
    const safeFormatChange = (v: number | undefined | null) => {
      const safeV = v ?? 0;
      const prefix = safeV > 0 ? '+' : '';
      return `${prefix}${safeV.toLocaleString('pt-BR')}`;
    };

    const compareMetrics = [
      {
        label: 'Seguidores',
        icon: Users,
        instagram: instagramData.insights.totalFollowers,
        facebook: facebookData.insights.totalFollowers,
        format: safeFormat,
        metricName: 'followers',
        tooltip: 'Número total de pessoas que seguem seu perfil.'
      },
      {
        label: 'Seguindo',
        icon: UserCheck,
        instagram: instagramData.insights.followingCount || 0,
        facebook: 0, // Facebook pages don't follow others
        format: safeFormat,
        metricName: 'following',
        fbUnavailable: true,
        tooltip: 'Número de contas que você está seguindo. (Apenas Instagram)'
      },
      {
        label: `Saldo de Seguidores (${getPeriodLabel()})`,
        icon: TrendingUp,
        instagram: instagramData.insights.netFollowerChange,
        facebook: facebookData.insights.netFollowerChange,
        format: safeFormatChange,
        colorClass: undefined, // Will be determined dynamically
        getColorClass: (v: number) => v >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold',
        metricName: 'netFollowerChange',
        igUnavailable: igUnavailable.netFollowerChange,
        fbUnavailableReason: fbUnavailable.netFollowerChange,
        tooltip: 'Diferença líquida de seguidores no período (ganhos - perdas). A API do Instagram fornece apenas o saldo diário, não valores separados.'
      },
      {
        label: 'Alcance',
        icon: Eye,
        instagram: instagramData.insights.reach,
        facebook: facebookData.insights.reach,
        format: safeFormat,
        metricName: 'reach',
        igUnavailable: igUnavailable.reach,
        fbUnavailableReason: fbUnavailable.reach,
        tooltip: 'Número de contas únicas que viram seu conteúdo no período.'
      },
      {
        label: 'Impressões',
        icon: Eye,
        instagram: instagramData.insights.impressions,
        facebook: facebookData.insights.impressions,
        format: safeFormat,
        metricName: 'impressions',
        igUnavailable: igUnavailable.impressions,
        tooltip: 'Número total de vezes que seu conteúdo foi exibido (inclui visualizações repetidas).'
      },
      {
        label: 'Engajamento',
        icon: Heart,
        instagram: instagramData.insights.engagementRate,
        facebook: facebookData.insights.engagementRate,
        format: safeFormatPercent,
        metricName: 'engagementRate',
        hasBreakdown: true,
        instagramBreakdown: {
          likes: instagramData.insights.likes,
          comments: instagramData.insights.comments,
          saves: instagramData.insights.saves,
          shares: instagramData.insights.shares,
          totalInteractions: instagramData.insights.totalInteractions, // From API - matches Instagram Insights
          followers: instagramData.insights.totalFollowers,
          formula: 'total_interactions (API) / seguidores × 100'
        },
        facebookBreakdown: {
          likes: facebookData.insights.likes,
          comments: facebookData.insights.comments,
          shares: facebookData.insights.shares,
          totalInteractions: facebookData.insights.totalInteractions,
          followers: facebookData.insights.totalFollowers,
          formula: 'page_post_engagements / seguidores × 100'
        },
        tooltip: 'Percentual de interações em relação ao número de seguidores. Clique no ícone para ver o cálculo detalhado.'
      },
      {
        label: 'Curtidas',
        icon: Heart,
        instagram: instagramData.insights.likes,
        facebook: facebookData.insights.likes,
        format: safeFormat,
        metricName: 'likes',
        tooltip: 'Total de curtidas recebidas em posts do período.'
      },
      {
        label: 'Comentários',
        icon: MessageCircle,
        instagram: instagramData.insights.comments,
        facebook: facebookData.insights.comments,
        format: safeFormat,
        metricName: 'comments',
        tooltip: 'Total de comentários recebidos em posts do período.'
      },
      {
        label: 'Compartilhamentos',
        icon: Share2,
        instagram: instagramData.insights.shares,
        facebook: facebookData.insights.shares,
        format: safeFormat,
        metricName: 'shares',
        igUnavailable: igUnavailable.shares,
        tooltip: 'Número de vezes que seu conteúdo foi compartilhado. Para Instagram, disponível apenas para Reels com permissões específicas. Zero pode indicar falta de permissão ou realmente nenhum compartilhamento.'
      },
      {
        label: 'Salvos',
        icon: Bookmark,
        instagram: instagramData.insights.saves,
        facebook: 0,
        format: safeFormat,
        metricName: 'saves',
        fbUnavailable: true,
        igUnavailable: igUnavailable.saves,
        tooltip: 'Número de vezes que seu conteúdo foi salvo por outros usuários. (Apenas Instagram)'
      },
      {
        label: 'Visualizações de Vídeo',
        icon: Play,
        instagram: instagramData.insights.videoViews,
        facebook: 0,
        format: safeFormat,
        metricName: 'videoViews',
        fbUnavailable: true,
        tooltip: 'Total de reproduções de vídeos e Reels no período. Zero pode indicar que não há vídeos publicados no período ou falta de permissão.'
      },
      {
        label: 'Visitas ao Perfil',
        icon: Eye,
        instagram: instagramData.insights.profileViews,
        facebook: facebookData.insights.profileViews,
        format: safeFormat,
        metricName: 'profileViews',
        igUnavailable: igUnavailable.profileViews,
        tooltip: 'Número de vezes que seu perfil foi visitado no período.'
      },
      {
        label: 'Cliques no Site',
        icon: ExternalLink,
        instagram: instagramData.insights.websiteClicks,
        facebook: facebookData.insights.websiteClicks,
        format: safeFormat,
        metricName: 'websiteClicks',
        igUnavailable: igUnavailable.websiteClicks,
        tooltip: 'Número de cliques no link do site na bio/perfil.'
      }
    ];

    // Render unavailable indicator for a metric value
    const renderMetricValue = (value: number | undefined | null, format: (v: number | undefined | null) => string, unavailableReason?: string, colorClass?: string) => {
      const safeValue = value ?? 0;
      const isUnavailable = safeValue === 0 && unavailableReason;
      
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
      
      return <span className={colorClass}>{format(safeValue)}</span>;
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
              
              {/* Data Source Indicator */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className={`gap-1 cursor-help ${
                        isRealData 
                          ? 'border-success/50 bg-success/10 text-success hover:bg-success/20' 
                          : 'border-warning/50 bg-warning/10 text-warning hover:bg-warning/20'
                      }`}
                    >
                      {isRealData ? (
                        <Wifi className="h-3 w-3" />
                      ) : (
                        <WifiOff className="h-3 w-3" />
                      )}
                      <span className="text-xs">
                        {isRealData ? 'Dados reais' : 'Demo'}
                      </span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-semibold">
                        {isRealData ? '✅ Dados Reais' : '⚠️ Dados de Demonstração'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {isRealData 
                          ? 'Conectado à Meta Graph API. Dados de Facebook e Instagram em tempo real.'
                          : 'Valores fictícios para visualização. Conecte sua conta para ver dados reais.'
                        }
                      </p>
                      {isRealData && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 pt-2 border-t border-border/50">
                          ⏱️ <strong>Nota:</strong> A API do Instagram atualiza dados com atraso de 24-48h. 
                          Métricas de hoje ainda não estão disponíveis - dados são até ontem.
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
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
              {/* Show synced period badge when using external period, otherwise show selector */}
              {externalPeriod ? (
                <div className="flex items-center gap-2 bg-primary/10 rounded-md px-3 py-1.5">
                  <span className="text-sm font-medium text-primary">{getPeriodLabel()}</span>
                  <Badge variant="outline" className="text-xs bg-background">
                    Sincronizado
                  </Badge>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Select value={period} onValueChange={handlePeriodChange}>
                    <SelectTrigger className={period === "custom" ? "w-[160px] h-9" : "w-[180px] h-9"}>
                      <SelectValue placeholder="Período">
                        {period === "custom" && customDateRange.from && customDateRange.to 
                          ? `${format(customDateRange.from, "dd/MM")} - ${format(customDateRange.to, "dd/MM")}`
                          : getPeriodLabel()
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Hoje</SelectItem>
                      <SelectItem value="yesterday">Ontem</SelectItem>
                      <SelectItem value="this_week">Esta semana</SelectItem>
                      <SelectItem value="7">7 dias</SelectItem>
                      <SelectItem value="14">14 dias</SelectItem>
                      <SelectItem value="this_month">Este mês</SelectItem>
                      <SelectItem value="30">30 dias</SelectItem>
                      <SelectItem value="60">60 dias</SelectItem>
                      <SelectItem value="this_semester">Este semestre</SelectItem>
                      <SelectItem value="90">90 dias</SelectItem>
                      <SelectItem value="this_year">Este ano</SelectItem>
                      <SelectItem value="custom">Data personalizada...</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Button to edit custom date range when in custom mode */}
                  {period === "custom" && (
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-9 w-9 shrink-0"
                      onClick={() => setIsCustomDateOpen(true)}
                    >
                      <Calendar className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}

              {/* Custom Date Range Popover */}
              <Popover open={isCustomDateOpen} onOpenChange={setIsCustomDateOpen}>
                <PopoverTrigger asChild>
                  <span />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-4 z-50 bg-popover" align="end">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="font-medium text-sm">Selecione o período</h4>
                      <p className="text-xs text-muted-foreground">
                        Clique em uma data para um único dia, ou selecione duas datas para um período
                      </p>
                    </div>
                    <CalendarComponent
                      mode="range"
                      selected={{ from: customDateRange.from, to: customDateRange.to }}
                      onSelect={(range) => {
                        // Allow single date selection by setting both from and to to the same date
                        if (range?.from && !range?.to) {
                          setCustomDateRange({ from: range.from, to: range.from });
                        } else {
                          setCustomDateRange({ from: range?.from, to: range?.to });
                        }
                      }}
                      locale={ptBR}
                      disabled={(date) => {
                        const today = new Date();
                        const yesterday = new Date(today);
                        yesterday.setHours(0, 0, 0, 0);
                        yesterday.setDate(yesterday.getDate() - 1);
                        
                        // Max 90 days back (Instagram API limit)
                        const maxPastDate = new Date(today);
                        maxPastDate.setDate(maxPastDate.getDate() - 90);
                        
                        // Disable: today, future dates, and dates older than 90 days
                        const dateToCheck = new Date(date);
                        dateToCheck.setHours(0, 0, 0, 0);
                        
                        return dateToCheck > yesterday || dateToCheck < maxPastDate;
                      }}
                      numberOfMonths={2}
                      className="rounded-md border pointer-events-auto"
                    />
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                      ⚠️ Dados disponíveis apenas até ontem (atraso de 24-48h da API do Instagram)
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {customDateRange.from && customDateRange.to && (
                          <>
                            {customDateRange.from.getTime() === customDateRange.to.getTime() ? (
                              <>{format(customDateRange.from, "dd/MM/yyyy", { locale: ptBR })} (1 dia)</>
                            ) : (
                              <>
                                {format(customDateRange.from, "dd/MM/yyyy", { locale: ptBR })} - {format(customDateRange.to, "dd/MM/yyyy", { locale: ptBR })}
                                {" "}({differenceInDays(customDateRange.to, customDateRange.from) + 1} dias)
                              </>
                            )}
                          </>
                        )}
                      </div>
                      <Button 
                        size="sm" 
                        onClick={applyCustomDateRange}
                        disabled={!customDateRange.from}
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
              <p className="text-2xl font-bold">{(instagramData.insights.totalFollowers ?? 0).toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">seguidores</p>
            </div>
            <div className="p-4 rounded-lg bg-gradient-to-br from-blue-500/10 to-blue-600/10 border border-blue-200/50 dark:border-blue-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Facebook className="h-5 w-5 text-blue-600" />
                <span className="font-medium text-sm">{facebookData.accountName}</span>
              </div>
              <p className="text-2xl font-bold">{(facebookData.insights.totalFollowers ?? 0).toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">seguidores</p>
            </div>
          </div>

          {/* Total Combined */}
          <div className="p-4 rounded-lg bg-muted/30 text-center">
            <p className="text-sm text-muted-foreground mb-1">Total Combinado</p>
            <p className="text-3xl font-bold text-primary">
              {((instagramData.insights.totalFollowers ?? 0) + (facebookData.insights.totalFollowers ?? 0)).toLocaleString('pt-BR')}
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
                  const hasBreakdown = (metric as any).hasBreakdown;
                  const instagramBreakdown = (metric as any).instagramBreakdown;
                  const facebookBreakdown = (metric as any).facebookBreakdown;
                  
                  const renderEngagementWithBreakdown = (value: number, breakdown: any, platform: 'instagram' | 'facebook') => {
                    if (!breakdown) return <span className="font-semibold">{metric.format(value)}</span>;
                    
                    const isInstagram = platform === 'instagram';
                    // Use totalInteractions from API if available, otherwise calculate manually
                    const totalInteractions = breakdown.totalInteractions ?? (isInstagram 
                      ? ((breakdown.likes ?? 0) + (breakdown.comments ?? 0) + (breakdown.saves ?? 0))
                      : ((breakdown.likes ?? 0) + (breakdown.comments ?? 0) + (breakdown.shares ?? 0)));
                    
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-semibold cursor-help underline decoration-dashed decoration-muted-foreground/40 underline-offset-4 flex items-center justify-center gap-1">
                              {metric.format(value)}
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs p-3">
                            <div className="space-y-2">
                              <p className="font-medium text-xs text-muted-foreground border-b pb-1 mb-2">
                                {isInstagram ? 'Cálculo Instagram' : 'Cálculo Facebook'}
                              </p>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between gap-4">
                                  <span className="flex items-center gap-1">
                                    <Heart className="h-3 w-3" /> Curtidas:
                                  </span>
                                  <span className="font-semibold">{(breakdown.likes ?? 0).toLocaleString('pt-BR')}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span className="flex items-center gap-1">
                                    <MessageCircle className="h-3 w-3" /> Comentários:
                                  </span>
                                  <span className="font-semibold">{(breakdown.comments ?? 0).toLocaleString('pt-BR')}</span>
                                </div>
                                {isInstagram ? (
                                  <>
                                    <div className="flex justify-between gap-4">
                                      <span className="flex items-center gap-1">
                                        <Bookmark className="h-3 w-3" /> Salvos:
                                      </span>
                                      <span className="font-semibold">{(breakdown.saves || 0).toLocaleString('pt-BR')}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="flex items-center gap-1">
                                        <Share2 className="h-3 w-3" /> Compartilhamentos:
                                      </span>
                                      <span className="font-semibold">{(breakdown.shares || 0).toLocaleString('pt-BR')}</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex justify-between gap-4">
                                    <span className="flex items-center gap-1">
                                      <Share2 className="h-3 w-3" /> Compartilhamentos:
                                    </span>
                                    <span className="font-semibold">{(breakdown.shares || 0).toLocaleString('pt-BR')}</span>
                                  </div>
                                )}
                                <div className="border-t pt-1 mt-1">
                                  <div className="flex justify-between gap-4">
                                    <span>Total interações:</span>
                                    <span className="font-semibold">{(totalInteractions ?? 0).toLocaleString('pt-BR')}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="flex items-center gap-1">
                                      <Users className="h-3 w-3" /> Seguidores:
                                    </span>
                                    <span className="font-semibold">{(breakdown.followers ?? 0).toLocaleString('pt-BR')}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="border-t pt-2 mt-2">
                                <p className="text-xs text-muted-foreground italic">
                                  {breakdown.formula}
                                </p>
                                <p className="text-xs font-medium mt-1">
                                  = {(totalInteractions ?? 0).toLocaleString('pt-BR')} / {(breakdown.followers ?? 0).toLocaleString('pt-BR')} × 100 = <span className="text-primary">{(value ?? 0).toFixed(2)}%</span>
                                </p>
                                {isInstagram && (breakdown.totalInteractions ?? 0) > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-1.5 pt-1.5 border-t border-dashed">
                                    💡 Total de interações da API do Instagram (inclui curtidas, comentários, salvos, compartilhamentos e respostas)
                                  </p>
                                )}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  };
                  
                  return (
                    <tr key={index} className="border-b border-border/30 last:border-0">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{metric.label}</span>
                          {hasBreakdown && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              ver cálculo
                            </Badge>
                          )}
                          {(metric as any).tooltip && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help hover:text-muted-foreground transition-colors" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">{(metric as any).tooltip}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </td>
                      <td className={`text-center py-3 px-2 font-semibold`}>
                        {hasBreakdown 
                          ? renderEngagementWithBreakdown(metric.instagram, instagramBreakdown, 'instagram')
                          : (() => {
                              const getColorClass = (metric as any).getColorClass;
                              const colorClass = getColorClass ? getColorClass(metric.instagram) : metric.colorClass;
                              return renderMetricValue(metric.instagram, metric.format, igUnavailableReason, colorClass);
                            })()
                        }
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
                        ) : hasBreakdown 
                          ? renderEngagementWithBreakdown(metric.facebook, facebookBreakdown, 'facebook')
                          : (() => {
                              const getColorClass = (metric as any).getColorClass;
                              const colorClass = getColorClass ? getColorClass(metric.facebook) : metric.colorClass;
                              return renderMetricValue(metric.facebook, metric.format, fbUnavailableReason, colorClass);
                            })()
                        }
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
          {/* Engagement Evolution Chart */}
          <div className="pt-4 border-t border-border/30">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Evolução do Engajamento</h3>
              <Badge variant="outline" className="text-xs">comparativo</Badge>
            </div>
            
            {/* Prepare chart data by merging daily data from both platforms */}
            {(() => {
              // Create merged data for the chart
              const igDaily = instagramData.dailyData || [];
              const fbDaily = facebookData.dailyData || [];
              
              // Create a map of dates to values
              const chartData = igDaily.map((ig, index) => ({
                date: ig.date,
                instagram: ig.engagement,
                facebook: fbDaily[index]?.engagement || 0,
                igReach: ig.reach,
                fbReach: fbDaily[index]?.reach || 0,
              }));
              
              const engagementChartConfig: ChartConfig = {
                instagram: {
                  label: "Instagram",
                  color: "hsl(328, 85%, 58%)", // Pink
                },
                facebook: {
                  label: "Facebook",
                  color: "hsl(220, 90%, 56%)", // Blue
                },
              };

              // Calculate averages and trends
              const igAvg = igDaily.length > 0 ? igDaily.reduce((sum, d) => sum + d.engagement, 0) / igDaily.length : 0;
              const fbAvg = fbDaily.length > 0 ? fbDaily.reduce((sum, d) => sum + d.engagement, 0) / fbDaily.length : 0;
              
              // Calculate trend (last 3 days vs first 3 days)
              const getEngagementTrend = (data: DailyOrganicData[]) => {
                if (data.length < 3) return 0;
                const firstThree = data.slice(0, 3).reduce((sum, d) => sum + d.engagement, 0) / 3;
                const lastThree = data.slice(-3).reduce((sum, d) => sum + d.engagement, 0) / 3;
                return firstThree > 0 ? ((lastThree - firstThree) / firstThree) * 100 : 0;
              };
              
              const igTrend = getEngagementTrend(igDaily);
              const fbTrend = getEngagementTrend(fbDaily);

              return (
                <div className="space-y-4">
                  {/* Trend Summary Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-gradient-to-br from-pink-500/5 to-purple-500/5 border border-pink-200/30 dark:border-pink-800/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Instagram className="h-4 w-4 text-pink-500" />
                          <span className="text-sm font-medium">Instagram</span>
                        </div>
                        <Badge 
                          variant="secondary" 
                          className={igTrend >= 0 
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" 
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                          }
                        >
                          {igTrend >= 0 ? "↑" : "↓"} {Math.abs(igTrend).toFixed(1)}%
                        </Badge>
                      </div>
                      <p className="text-lg font-bold mt-1">{igAvg.toFixed(2)}%</p>
                      <p className="text-xs text-muted-foreground">média de engajamento</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500/5 to-blue-600/5 border border-blue-200/30 dark:border-blue-800/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Facebook className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium">Facebook</span>
                        </div>
                        <Badge 
                          variant="secondary" 
                          className={fbTrend >= 0 
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" 
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                          }
                        >
                          {fbTrend >= 0 ? "↑" : "↓"} {Math.abs(fbTrend).toFixed(1)}%
                        </Badge>
                      </div>
                      <p className="text-lg font-bold mt-1">{fbAvg.toFixed(2)}%</p>
                      <p className="text-xs text-muted-foreground">média de engajamento</p>
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="h-[280px] w-full">
                    <ChartContainer config={engagementChartConfig} className="h-full w-full">
                      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                        <XAxis 
                          dataKey="date" 
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                          className="text-muted-foreground"
                        />
                        <YAxis 
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => `${value.toFixed(1)}%`}
                          className="text-muted-foreground"
                          width={50}
                        />
                        <ChartTooltip 
                          content={
                            <ChartTooltipContent 
                              formatter={(value, name) => (
                                <span className="font-semibold">
                                  {typeof value === 'number' ? value.toFixed(2) : value}%
                                </span>
                              )}
                            />
                          }
                        />
                        <Legend 
                          verticalAlign="top" 
                          height={36}
                          formatter={(value) => (
                            <span className="text-sm font-medium">
                              {value === 'instagram' ? 'Instagram' : 'Facebook'}
                            </span>
                          )}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="instagram" 
                          stroke="hsl(328, 85%, 58%)" 
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: "hsl(328, 85%, 58%)" }}
                          activeDot={{ r: 5, fill: "hsl(328, 85%, 58%)" }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="facebook" 
                          stroke="hsl(220, 90%, 56%)" 
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: "hsl(220, 90%, 56%)" }}
                          activeDot={{ r: 5, fill: "hsl(220, 90%, 56%)" }}
                        />
                      </LineChart>
                    </ChartContainer>
                  </div>

                  {/* Winner indicator */}
                  <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted/30">
                    {igAvg > fbAvg ? (
                      <>
                        <Instagram className="h-5 w-5 text-pink-500" />
                        <span className="text-sm">
                          <strong>Instagram</strong> tem engajamento <strong>{((igAvg - fbAvg) / fbAvg * 100).toFixed(0)}% maior</strong> no período
                        </span>
                      </>
                    ) : igAvg < fbAvg ? (
                      <>
                        <Facebook className="h-5 w-5 text-blue-600" />
                        <span className="text-sm">
                          <strong>Facebook</strong> tem engajamento <strong>{((fbAvg - igAvg) / igAvg * 100).toFixed(0)}% maior</strong> no período
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Engajamento igual nas duas plataformas
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Market Benchmarks Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-lg">Benchmarks de Mercado</h4>
              <Badge variant="secondary" className="text-xs">referência</Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      Dados baseados em estudos de <strong>Hootsuite</strong>, <strong>Sprout Social</strong> e <strong>Rival IQ</strong> (2023-2024). 
                      Benchmarks variam por setor e faixa de seguidores.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {(() => {
              const igData = platforms.find(p => p.platform === 'instagram');
              const fbData = platforms.find(p => p.platform === 'facebook');
              
              const igFollowers = igData?.insights?.totalFollowers || 0;
              const fbFollowers = fbData?.insights?.totalFollowers || 0;
              const igEngagement = igData?.insights?.engagementRate || 0;
              const fbEngagement = fbData?.insights?.engagementRate || 0;

              // Benchmarks by follower tier (source: Hootsuite, Sprout Social 2023-2024)
              const instagramBenchmarks = [
                { tier: 'Nano (1K-10K)', min: 1000, max: 10000, rate: 4.0, description: 'Maior proximidade com audiência' },
                { tier: 'Micro (10K-100K)', min: 10000, max: 100000, rate: 2.4, description: 'Bom equilíbrio alcance/engajamento' },
                { tier: 'Médio (100K-500K)', min: 100000, max: 500000, rate: 1.8, description: 'Audiência consolidada' },
                { tier: 'Macro (500K-1M)', min: 500000, max: 1000000, rate: 1.4, description: 'Alta visibilidade' },
                { tier: 'Mega (1M+)', min: 1000000, max: Infinity, rate: 1.1, description: 'Celebridades/marcas globais' },
              ];

              const facebookBenchmarks = [
                { tier: 'Pequeno (<10K)', min: 0, max: 10000, rate: 0.8, description: 'Comunidades engajadas' },
                { tier: 'Médio (10K-100K)', min: 10000, max: 100000, rate: 0.5, description: 'Páginas em crescimento' },
                { tier: 'Grande (100K+)', min: 100000, max: Infinity, rate: 0.3, description: 'Marcas estabelecidas' },
              ];

              const getIgBenchmark = (followers: number) => {
                return instagramBenchmarks.find(b => followers >= b.min && followers < b.max) || instagramBenchmarks[0];
              };

              const getFbBenchmark = (followers: number) => {
                return facebookBenchmarks.find(b => followers >= b.min && followers < b.max) || facebookBenchmarks[0];
              };

              const igBenchmark = getIgBenchmark(igFollowers);
              const fbBenchmark = getFbBenchmark(fbFollowers);

              const getPerformanceLevel = (actual: number, benchmark: number) => {
                const ratio = actual / benchmark;
                if (ratio >= 1.5) return { label: 'Excelente', color: 'text-success', bgColor: 'bg-success/10', icon: '🏆' };
                if (ratio >= 1.0) return { label: 'Acima da média', color: 'text-success', bgColor: 'bg-success/10', icon: '✅' };
                if (ratio >= 0.7) return { label: 'Na média', color: 'text-warning', bgColor: 'bg-warning/10', icon: '📊' };
                return { label: 'Abaixo da média', color: 'text-danger', bgColor: 'bg-danger/10', icon: '⚠️' };
              };

              const igPerformance = getPerformanceLevel(igEngagement, igBenchmark.rate);
              const fbPerformance = getPerformanceLevel(fbEngagement, fbBenchmark.rate);

              return (
                <div className="space-y-4">
                  {/* Your performance vs benchmarks */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Instagram Benchmark Card */}
                    <Card className="border-pink-200/50 dark:border-pink-800/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Instagram className="h-5 w-5 text-pink-500" />
                            <CardTitle className="text-base">Instagram</CardTitle>
                          </div>
                          <Badge className={`${igPerformance.bgColor} ${igPerformance.color} border-0`}>
                            {igPerformance.icon} {igPerformance.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Seu engajamento</span>
                          <span className="text-xl font-bold">{igEngagement.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Benchmark ({igBenchmark.tier})</span>
                          <span className="text-lg font-semibold text-muted-foreground">{igBenchmark.rate}%</span>
                        </div>
                        <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="absolute left-0 top-0 h-full bg-gradient-to-r from-pink-400 to-pink-600 rounded-full transition-all"
                            style={{ width: `${Math.min((igEngagement / (igBenchmark.rate * 2)) * 100, 100)}%` }}
                          />
                          <div 
                            className="absolute top-0 h-full w-0.5 bg-foreground/50"
                            style={{ left: '50%' }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{igBenchmark.description}</p>
                        <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted/30 rounded">
                          <strong>Diferença:</strong> {igEngagement >= igBenchmark.rate ? '+' : ''}{((igEngagement - igBenchmark.rate) / igBenchmark.rate * 100).toFixed(0)}% em relação à média do setor
                        </div>
                      </CardContent>
                    </Card>

                    {/* Facebook Benchmark Card */}
                    <Card className="border-blue-200/50 dark:border-blue-800/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Facebook className="h-5 w-5 text-blue-600" />
                            <CardTitle className="text-base">Facebook</CardTitle>
                          </div>
                          <Badge className={`${fbPerformance.bgColor} ${fbPerformance.color} border-0`}>
                            {fbPerformance.icon} {fbPerformance.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Seu engajamento</span>
                          <span className="text-xl font-bold">{fbEngagement.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Benchmark ({fbBenchmark.tier})</span>
                          <span className="text-lg font-semibold text-muted-foreground">{fbBenchmark.rate}%</span>
                        </div>
                        <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
                            style={{ width: `${Math.min((fbEngagement / (fbBenchmark.rate * 2)) * 100, 100)}%` }}
                          />
                          <div 
                            className="absolute top-0 h-full w-0.5 bg-foreground/50"
                            style={{ left: '50%' }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{fbBenchmark.description}</p>
                        <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted/30 rounded">
                          <strong>Diferença:</strong> {fbEngagement >= fbBenchmark.rate ? '+' : ''}{((fbEngagement - fbBenchmark.rate) / fbBenchmark.rate * 100).toFixed(0)}% em relação à média do setor
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Full Benchmark Reference Table */}
                  <Card className="bg-muted/20">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Tabela de Referência por Faixa de Seguidores</CardTitle>
                        <Badge variant="outline" className="text-xs">Fonte: Hootsuite/Sprout Social 2024</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Instagram Table */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Instagram className="h-4 w-4 text-pink-500" />
                            <span className="font-medium text-sm">Instagram</span>
                          </div>
                          <div className="space-y-2">
                            {instagramBenchmarks.map((benchmark, idx) => (
                              <div 
                                key={idx} 
                                className={`flex items-center justify-between p-2 rounded ${
                                  igFollowers >= benchmark.min && igFollowers < benchmark.max 
                                    ? 'bg-pink-100 dark:bg-pink-900/30 border border-pink-300 dark:border-pink-700' 
                                    : 'bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {igFollowers >= benchmark.min && igFollowers < benchmark.max && (
                                    <Badge className="bg-pink-500 text-white text-xs">Você</Badge>
                                  )}
                                  <span className="text-sm">{benchmark.tier}</span>
                                </div>
                                <span className="font-semibold text-sm">{benchmark.rate}%</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Facebook Table */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Facebook className="h-4 w-4 text-blue-600" />
                            <span className="font-medium text-sm">Facebook</span>
                          </div>
                          <div className="space-y-2">
                            {facebookBenchmarks.map((benchmark, idx) => (
                              <div 
                                key={idx} 
                                className={`flex items-center justify-between p-2 rounded ${
                                  fbFollowers >= benchmark.min && fbFollowers < benchmark.max 
                                    ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700' 
                                    : 'bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {fbFollowers >= benchmark.min && fbFollowers < benchmark.max && (
                                    <Badge className="bg-blue-600 text-white text-xs">Você</Badge>
                                  )}
                                  <span className="text-sm">{benchmark.tier}</span>
                                </div>
                                <span className="font-semibold text-sm">{benchmark.rate}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border text-xs text-muted-foreground">
                        <strong>📊 Sobre os benchmarks:</strong> Estes valores são médias globais baseadas em estudos de mercado. 
                        O engajamento real pode variar significativamente por nicho/indústria:
                        <ul className="mt-2 ml-4 list-disc space-y-1">
                          <li><strong>Educação/ONGs:</strong> geralmente 30-50% acima da média</li>
                          <li><strong>Moda/Beleza:</strong> próximo à média</li>
                          <li><strong>Tecnologia/Finanças:</strong> geralmente 20-40% abaixo da média</li>
                          <li><strong>Alimentação/Bebidas:</strong> geralmente 10-20% acima da média</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
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
        <div className="flex items-center gap-2">
          {cacheAge !== null && cacheAge > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs gap-1">
                    <Clock className="h-3 w-3" />
                    Cache: {cacheAge < 60 ? `${cacheAge}s` : `${Math.floor(cacheAge / 60)}m`}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Dados em cache local (TTL: 5 min)</p>
                  <p className="text-xs text-muted-foreground">Clique em Atualizar para buscar dados novos</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button variant="outline" size="sm" onClick={handleForceRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Consolidated Comparison Card */}
      {renderComparisonCard()}
      
      {/* Content Type Breakdown - Instagram only */}
      {instagramData?.insights.contentBreakdown && (
        <ContentTypeBreakdownComponent 
          breakdown={instagramData.insights.contentBreakdown} 
          periodLabel={getPeriodLabel()} 
        />
      )}

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

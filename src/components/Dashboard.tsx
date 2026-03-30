import { useState, useEffect, useMemo } from "react";
import whatsjudLogo from "@/assets/whatsjud-logo.png";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MetricCard from "./MetricCard";
import DataSourceIndicator from "./DataSourceIndicator";
import { InlineDatabaseSearch } from "./InlineDatabaseSearch";
import GoalBiasIndicator from "./GoalBiasIndicator";
import UnifiedMetaStatus from "./UnifiedMetaStatus";
import ViewsBreakdown from "./ViewsBreakdown";
import SmartInsights from "./SmartInsights";
import MultiAccountSelector from "./MultiAccountSelector";
import { AccountBreakdownTable } from "./AccountBreakdownTable";

import BMConnection from "./BMConnection";
import SegmentAnalysis from "./SegmentAnalysis";
import { RecentProspects } from "./dashboard/RecentProspects";
import StrategyPanel from "./StrategyPanel";
import ActionHistory from "./ActionHistory";
import AlertSettings from "./AlertSettings";
import PeriodComparison from "./PeriodComparison";
import { MetricsEvolutionChart } from "./MetricsEvolutionChart";
import { PlacementMetrics } from "./PlacementMetrics";
import OrganicMetrics from "./OrganicMetrics";
import GoalsManager from "./GoalsManager";
import SpendBreakdown from "./SpendBreakdown";
import InstagramAutomation from "./instagram/InstagramAutomation";
import { UserMenu } from "./auth/UserMenu";
import { TrendingUp, Target, MousePointer, Eye, Play, DollarSign, Users, UserPlus, Phone, CheckCircle, XCircle, Trophy, UserX, Sparkles, LayoutDashboard, Megaphone, Heart, Flag, CalendarDays, Bot, Flame, Calendar, MessageCircle, Filter, Layers, UsersRound, CreditCard } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useMetaAPI, DateRangeOption } from "@/hooks/useMetaAPI";
import { useMetricAlerts } from "@/hooks/useMetricAlerts";
import { useLeads } from "@/hooks/useLeads";
import { useUnifiedMetaConnection, GoalBias } from "@/hooks/useUnifiedMetaConnection";
import { useMultiAccountSelection } from "@/hooks/useMultiAccountSelection";
import { useAggregatedMetrics } from "@/hooks/useAggregatedMetrics";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const [proMode, setProMode] = useState(false);
  const [goalBiases, setGoalBiases] = useState<GoalBias[]>([]);
  const [organicMetricsData, setOrganicMetricsData] = useState<{ impressions: number; reach: number }>({ impressions: 0, reach: 0 });
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [pendingProspectsCount, setPendingProspectsCount] = useState(0);
  const { isAdmin } = useUserRole();
  
  // Read tab from URL params
  const urlTab = searchParams.get('tab') || 'paid';
  const urlSubTab = searchParams.get('subtab') || undefined;
  const [activeMainTab, setActiveMainTab] = useState(urlTab);

  // Sync activeMainTab with URL changes
  useEffect(() => {
    setActiveMainTab(urlTab);
  }, [urlTab]);

  // Fetch unclassified comments count and pending prospects count
  useEffect(() => {
    const fetchUnclassifiedCount = async () => {
      const { count, error } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .is('prospect_classification', null);
      
      if (!error && count !== null) {
        setUnclassifiedCount(count);
      }
    };

    const fetchPendingProspectsCount = async () => {
      const { count, error } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .eq('funnel_stage', 'comment');
      
      if (!error && count !== null) {
        setPendingProspectsCount(count);
      }
    };

    fetchUnclassifiedCount();
    fetchPendingProspectsCount();
    
    // Subscribe to realtime changes
    const channel = supabase
      .channel('dashboard-comments-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instagram_comments' },
        () => {
          fetchUnclassifiedCount();
          fetchPendingProspectsCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  
  const {
    metrics: singleMetrics,
    campaigns: singleCampaigns,
    adSets: singleAdSets,
    creatives: singleCreatives,
    dailyData: singleDailyData,
    placementData: singlePlacementData,
    dateRange,
    changeDateRange,
    isLoading: singleLoading,
    isConnected,
    error,
    config: metaConfig,
    connectToMeta,
    disconnect,
    refreshMetrics: refreshSingleMetrics
  } = useMetaAPI();

  // Multi-account selection and aggregation
  const { activeAccounts, hasMultipleSelected, selectedCount } = useMultiAccountSelection();
  
  const {
    metrics: aggregatedMetrics,
    campaigns: aggregatedCampaigns,
    adSets: aggregatedAdSets,
    creatives: aggregatedCreatives,
    dailyData: aggregatedDailyData,
    placementData: aggregatedPlacementData,
    isLoading: aggregatedLoading,
    refreshData: refreshAggregatedData,
    accountBreakdown
  } = useAggregatedMetrics(dateRange as DateRangeOption);

  // Decide which data to use: aggregated (multi-account) or single account
  const useAggregated = hasMultipleSelected && activeAccounts.length > 1;
  
  const metrics = useMemo(() => 
    useAggregated ? aggregatedMetrics : singleMetrics,
    [useAggregated, aggregatedMetrics, singleMetrics]
  );
  
  const campaigns = useMemo(() => 
    useAggregated ? aggregatedCampaigns : singleCampaigns,
    [useAggregated, aggregatedCampaigns, singleCampaigns]
  );
  
  const adSets = useMemo(() => 
    useAggregated ? aggregatedAdSets : singleAdSets,
    [useAggregated, aggregatedAdSets, singleAdSets]
  );
  
  const creatives = useMemo(() => 
    useAggregated ? aggregatedCreatives : singleCreatives,
    [useAggregated, aggregatedCreatives, singleCreatives]
  );
  
  const dailyData = useMemo(() => 
    useAggregated ? aggregatedDailyData : singleDailyData,
    [useAggregated, aggregatedDailyData, singleDailyData]
  );
  
  const placementData = useMemo(() => 
    useAggregated ? aggregatedPlacementData : singlePlacementData,
    [useAggregated, aggregatedPlacementData, singlePlacementData]
  );
  
  const isLoading = useAggregated ? aggregatedLoading : singleLoading;
  
  const refreshMetrics = useAggregated ? refreshAggregatedData : refreshSingleMetrics;

  // Auto-connect on mount if there's a saved account
  useEffect(() => {
    if (isConnected) return; // Already connected
    
    const saved = localStorage.getItem('meta_saved_accounts');
    if (saved) {
      try {
        const accounts = JSON.parse(saved);
        if (accounts.length > 0) {
          const firstAccount = accounts[0];
          console.log('🔄 [Dashboard] Auto-connecting with saved account:', firstAccount.name);
          connectToMeta({
            accessToken: firstAccount.accessToken,
            accountId: firstAccount.accountId
          });
        }
      } catch (e) {
        console.error('Error auto-connecting:', e);
      }
    }
  }, []); // Run only on mount

  // Debug log para verificar se token está sendo passado para OrganicMetrics
  useEffect(() => {
    console.log('🔧 [Dashboard Debug] Meta config status:', {
      hasAccessToken: !!metaConfig?.accessToken,
      accessTokenLength: metaConfig?.accessToken?.length || 0,
      accountId: metaConfig?.accountId || 'não definido',
      isConnected,
      useAggregated,
      selectedCount
    });
  }, [metaConfig, isConnected, useAggregated, selectedCount]);

  // Fetch organic data when connection or date range changes
  useEffect(() => {
    const fetchOrganicStatus = async () => {
      if (!metaConfig?.accessToken || !isConnected) return;
      
      const periodDays = dateRange === 'today' ? 1 : dateRange === 'yesterday' ? 1 : dateRange === 'last_7d' ? 7 : dateRange === 'last_30d' ? 30 : 7;
      
      try {
        console.log('📊 [Dashboard] Fetching organic insights for status...', { period: periodDays });
        const { data, error } = await cloudFunctions.invoke('fetch-organic-insights', {
          body: { 
            pageId: metaConfig.accountId,
            accessToken: metaConfig.accessToken,
            period: periodDays
          }
        });

        if (error) {
          console.error('❌ [Dashboard] Error fetching organic insights:', error);
          return;
        }

        if (data?.success && data?.platforms?.length > 0) {
          const totalImpressions = data.platforms.reduce((sum: number, p: any) => sum + (p.insights?.impressions || 0), 0);
          const totalReach = data.platforms.reduce((sum: number, p: any) => sum + (p.insights?.reach || 0), 0);
          console.log('✅ [Dashboard] Organic status updated:', { impressions: totalImpressions, reach: totalReach });
          setOrganicMetricsData({ impressions: totalImpressions, reach: totalReach });
        }
      } catch (err) {
        console.error('❌ [Dashboard] Exception fetching organic insights:', err);
      }
    };

    fetchOrganicStatus();
  }, [metaConfig?.accessToken, metaConfig?.accountId, isConnected, dateRange]);

  const { stats: leadStats, loading: leadsLoading } = useLeads();

  const {
    connectionStatus,
    calculateBiases,
    fetchUnifiedMetrics
  } = useUnifiedMetaConnection();

  const {
    getThresholds,
    saveThresholds,
    requestNotificationPermission,
    hasNotificationPermission,
  } = useMetricAlerts(singleMetrics, isConnected);

  // Calculate goal biases when metrics change
  useEffect(() => {
    const savedGoals = localStorage.getItem('marketing_goals');
    if (savedGoals && metrics) {
      const goals = JSON.parse(savedGoals);
      const unifiedMetrics = {
        paid: {
          cpc: metrics.cpc,
          ctr: metrics.ctr,
          cpm: metrics.cpm,
          spend: metrics.spend,
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          conversions: metrics.conversions,
          leads: leadStats.total
        },
        organic: {
          followers: 0,
          newFollowers: 0,
          reach: 0,
          impressions: 0,
          engagement: 0,
          likes: 0,
          comments: 0,
          shares: 0
        },
        biases: []
      };
      const biases = calculateBiases(unifiedMetrics, goals);
      setGoalBiases(biases);
    }
  }, [metrics, leadStats, calculateBiases]);

  const getPerformanceStatus = (value: number, metric: string) => {
    switch (metric) {
      case 'cpc':
        if (value <= 1.5) return 'success';
        if (value <= 3) return 'warning';
        return 'danger';
      case 'ctr':
        if (value >= 2) return 'success';
        if (value >= 1) return 'warning';
        return 'danger';
      case 'cpm':
        if (value <= 20) return 'success';
        if (value <= 30) return 'warning';
        return 'danger';
      case 'conversionRate':
        if (value >= 3) return 'success';
        if (value >= 1) return 'warning';
        return 'danger';
      case 'hookRate':
        if (value >= 30) return 'success';
        if (value >= 20) return 'warning';
        return 'danger';
      default:
        return 'success';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-dashboard p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Clean */}
        <div className="text-center space-y-4 relative">
          {/* User Menu - Top Right */}
          <div className="absolute top-0 right-0">
            <UserMenu />
          </div>
          
          <img src={whatsjudLogo} alt="WhatsJUD" className="h-20 mx-auto" />
          <h1 className="text-4xl md:text-5xl font-semibold text-foreground mb-2">
            WhatsJUD
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Monitore seus benchmarks em tempo real conectado ao Meta Business Manager
          </p>
          
          {/* Mode Toggle */}
          <div className="flex items-center justify-center gap-4 pt-2 flex-wrap">
            <Link to="/leads">
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4 mr-2" />
                Central de Leads
              </Button>
            </Link>
            

            <Link to="/analytics">
              <Button variant="outline" size="sm">
                <TrendingUp className="h-4 w-4 mr-2" />
                Analytics
              </Button>
            </Link>

            <Link to="/finance">
              <Button variant="outline" size="sm" className="border-green-500/50 hover:bg-green-500/10">
                <CreditCard className="h-4 w-4 mr-2 text-green-500" />
                Finanças
              </Button>
            </Link>

            <Link to="/dashboard?tab=automation&subtab=comments">
              <Button variant="outline" size="sm" className="border-primary/50 hover:bg-primary/10 relative">
                <MessageCircle className="h-4 w-4 mr-2 text-primary" />
                Comentários
                {unclassifiedCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-2 -right-2 h-5 min-w-5 flex items-center justify-center text-xs px-1.5"
                  >
                    {unclassifiedCount > 99 ? '99+' : unclassifiedCount}
                  </Badge>
                )}
              </Button>
            </Link>

            <Link to="/dashboard?tab=automation&subtab=funnel">
              <Button variant="outline" size="sm" className="border-orange-500/50 hover:bg-orange-500/10 relative">
                <Filter className="h-4 w-4 mr-2 text-orange-500" />
                Funil
                {pendingProspectsCount > 0 && (
                  <Badge 
                    className="absolute -top-2 -right-2 h-5 min-w-5 flex items-center justify-center text-xs px-1.5 bg-orange-500 hover:bg-orange-500"
                  >
                    {pendingProspectsCount > 99 ? '99+' : pendingProspectsCount}
                  </Badge>
                )}
              </Button>
            </Link>

            <Link to="/dashboard?tab=automation&subtab=automation">
              <Button variant="outline" size="sm" className="border-purple-500/50 hover:bg-purple-500/10">
                <Bot className="h-4 w-4 mr-2 text-purple-500" />
                Automação IA
              </Button>
            </Link>

            {isAdmin && (
              <Link to="/team">
                <Button variant="outline" size="sm" className="border-emerald-500/50 hover:bg-emerald-500/10">
                  <UsersRound className="h-4 w-4 mr-2 text-emerald-500" />
                  Equipe
                </Button>
              </Link>
            )}
            
            <MultiAccountSelector compact />
            
            <div className="flex items-center gap-2 bg-muted/50 rounded-full px-4 py-2 border border-border/50">
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="pro-mode" className="text-sm font-medium cursor-pointer">
                {proMode ? 'Modo Pro' : 'Modo Simples'}
              </Label>
              <Switch
                id="pro-mode"
                checked={proMode}
                onCheckedChange={setProMode}
              />
              <Sparkles className={`h-4 w-4 ${proMode ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
          </div>

          <InlineDatabaseSearch />
        </div>

        {/* Pipeline de Leads - Resumo */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Central de Leads
                </CardTitle>
                <DataSourceIndicator 
                  isRealData={leadStats.total > 0} 
                  source="Banco de Dados"
                  compact
                />
              </div>
              <Link to="/leads">
                <Button variant="outline" size="sm">
                  Ver todos
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {leadsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                Carregando leads...
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-1">
                    <UserPlus className="h-4 w-4 text-blue-600" />
                    <span className="text-xs text-blue-600 font-medium">Em análise</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{leadStats.new}</p>
                </div>
                
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-2 mb-1">
                    <Phone className="h-4 w-4 text-yellow-600" />
                    <span className="text-xs text-yellow-600 font-medium">Contatado</span>
                  </div>
                  <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{leadStats.contacted}</p>
                </div>
                
                <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-xs text-green-600 font-medium">Qualificado</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">{leadStats.qualified}</p>
                </div>
                
                <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-4 w-4 text-gray-500" />
                    <span className="text-xs text-gray-500 font-medium">Desqualificado</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{leadStats.notQualified}</p>
                </div>
                
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs text-emerald-600 font-medium">Convertido</span>
                  </div>
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{leadStats.converted}</p>
                </div>
                
                <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 mb-1">
                    <UserX className="h-4 w-4 text-red-600" />
                    <span className="text-xs text-red-600 font-medium">Perdido</span>
                  </div>
                  <p className="text-2xl font-bold text-red-700 dark:text-red-400">{leadStats.lost}</p>
                </div>
              </div>
            )}
            
            {/* Stats Summary */}
            {!leadsLoading && leadStats.total > 0 && (
              <div className="mt-4 pt-4 border-t border-border/50 flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Total:</span>
                  <Badge variant="secondary">{leadStats.total} leads</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Taxa de conversão:</span>
                  <Badge variant={leadStats.conversionRate > 10 ? "default" : "secondary"} className={leadStats.conversionRate > 10 ? "bg-green-500" : ""}>
                    {leadStats.conversionRate.toFixed(1)}%
                  </Badge>
                </div>
                {(leadStats.totalRevenue ?? 0) > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Receita:</span>
                    <Badge className="bg-emerald-500">R$ {(leadStats.totalRevenue ?? 0).toLocaleString('pt-BR')}</Badge>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Goal Biases - Motivational Indicators */}
        {goalBiases.length > 0 && (
          <Card className="border-border/50 border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                Vieses de Atingimento
                <Badge variant="outline" className="ml-2">{goalBiases.length} meta{goalBiases.length !== 1 ? 's' : ''}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <GoalBiasIndicator biases={goalBiases} maxItems={3} />
            </CardContent>
          </Card>
        )}

        {/* Recent Prospects - Quick Actions */}
        <RecentProspects />

        {/* Connection Status - SEMPRE NO TOPO */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BMConnection 
            isConnected={isConnected}
            isLoading={isLoading}
            error={error}
            onConnect={connectToMeta}
            onDisconnect={disconnect}
            onRefresh={refreshMetrics}
          />
          
          {/* Unified Status Indicator */}
          <UnifiedMetaStatus 
            status={{
              paid: isConnected,
              organic: organicMetricsData.impressions > 0,
              unified: isConnected && organicMetricsData.impressions > 0,
              lastSync: isConnected ? new Date() : undefined
            }}
            onRefresh={refreshMetrics}
            isLoading={isLoading}
          />
        </div>

        {/* Period Selector - LOGO ABAIXO DA CONEXÃO */}
        {isConnected && (
          <Card className="border-border/50">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Período dos Dados</p>
                    <p className="text-xs text-muted-foreground">
                      Selecione o período para visualizar as métricas
                    </p>
                  </div>
                </div>
                <Select value={dateRange} onValueChange={changeDateRange}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Selecione o período" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Hoje</SelectItem>
                    <SelectItem value="yesterday">Ontem</SelectItem>
                    <SelectItem value="last_7d">Últimos 7 dias</SelectItem>
                    <SelectItem value="last_15d">Últimos 15 dias</SelectItem>
                    <SelectItem value="last_30d">Últimos 30 dias</SelectItem>
                    <SelectItem value="last_60d">Últimos 60 dias</SelectItem>
                    <SelectItem value="last_90d">Últimos 90 dias</SelectItem>
                    <SelectItem value="this_month">Este mês</SelectItem>
                    <SelectItem value="last_month">Mês passado</SelectItem>
                    <SelectItem value="this_quarter">Este trimestre</SelectItem>
                    <SelectItem value="this_semester">Este semestre</SelectItem>
                    <SelectItem value="this_year">Este ano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Views Breakdown & Smart Insights - ABAIXO DO PERÍODO */}
        {isConnected && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ViewsBreakdown
              paidImpressions={metrics?.impressions ?? 0}
              paidReach={0}
              organicImpressions={organicMetricsData?.impressions ?? 0}
              organicReach={organicMetricsData?.reach ?? 0}
              period={dateRange === 'today' ? 'Hoje' : dateRange === 'yesterday' ? 'Ontem' : dateRange === 'last_7d' ? 'Últimos 7 dias' : dateRange === 'last_30d' ? 'Últimos 30 dias' : 'Período selecionado'}
            />
            <SmartInsights
              organicImpressions={organicMetricsData?.impressions ?? 0}
              paidImpressions={metrics?.impressions ?? 0}
              organicEngagement={0}
              paidEngagement={metrics?.ctr ?? 0}
              adSpend={metrics.spend}
              period={dateRange === 'today' ? 'Hoje' : dateRange === 'yesterday' ? 'Ontem' : dateRange === 'last_7d' ? 'Últimos 7 dias' : dateRange === 'last_30d' ? 'Últimos 30 dias' : 'Período selecionado'}
            />
          </div>
        )}

        {/* Tabs: Tráfego Pago / Público Orgânico / Metas */}
        <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="w-full">
          <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-4">
            <TabsTrigger value="paid" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Anúncios
            </TabsTrigger>
            <TabsTrigger value="organic" className="gap-2">
              <Heart className="h-4 w-4" />
              Orgânico
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-2">
              <Bot className="h-4 w-4" />
              Automação
            </TabsTrigger>
            <TabsTrigger value="goals" className="gap-2">
              <Flag className="h-4 w-4" />
              Metas
            </TabsTrigger>
          </TabsList>

          {/* Tab: Tráfego Pago */}
          <TabsContent value="paid" className="space-y-8 mt-6">
            {/* Multi-Account Indicator */}
            {useAggregated && (
              <>
                <Card className="border-primary/50 bg-primary/5">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-primary" />
                        <span className="font-medium text-primary">Dados Combinados</span>
                        <Badge variant="secondary">{selectedCount} contas</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Métricas agregadas de: {activeAccounts.map(a => a.name).join(', ')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Account Breakdown Table */}
                <AccountBreakdownTable 
                  accountBreakdown={accountBreakdown}
                  activeAccounts={activeAccounts}
                  aggregatedMetrics={aggregatedMetrics}
                />
              </>
            )}
            
            {/* Data Source Indicator */}
            <div className="flex items-center justify-between">
              <DataSourceIndicator 
                isRealData={isConnected || useAggregated} 
                source={useAggregated ? `Meta Ads (${selectedCount} contas)` : "Meta Ads API"}
              />
              <DataSourceIndicator 
                isRealData={isConnected || useAggregated} 
                source="Meta Ads"
                compact
              />
            </div>
            {/* Alert Settings - PRO ONLY */}
            {proMode && (
              <AlertSettings
                getThresholds={getThresholds}
                saveThresholds={saveThresholds}
                requestNotificationPermission={requestNotificationPermission}
                hasNotificationPermission={hasNotificationPermission}
              />
            )}

            {/* Metrics Grid - ALWAYS VISIBLE but simplified in Simple mode */}
            <div className={`grid grid-cols-1 md:grid-cols-2 ${proMode ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-6`}>
              <MetricCard
                title="CPC - Custo por Clique"
                value={`R$ ${metrics.cpc.toFixed(2)}`}
                icon={MousePointer}
                status={getPerformanceStatus(metrics.cpc, 'cpc')}
                benchmark="Até R$ 1,50 (bom) | R$ 3,00+ (ruim)"
                isConnected={isConnected}
              />
              
              <MetricCard
                title="CTR - Taxa de Cliques"
                value={`${metrics.ctr.toFixed(1)}%`}
                icon={Target}
                status={getPerformanceStatus(metrics.ctr, 'ctr')}
                benchmark="2%+ (bom) | 1% (ruim)"
                isConnected={isConnected}
              />
              
              <MetricCard
                title="Taxa de Conversão"
                value={`${metrics.conversionRate.toFixed(1)}%`}
                icon={TrendingUp}
                status={getPerformanceStatus(metrics.conversionRate, 'conversionRate')}
                benchmark="3%+ E-com | 10-20% Leads"
                isConnected={isConnected}
              />
              
              {/* Spend Breakdown - Replaces simple MetricCard */}
              <div className="md:col-span-2 lg:col-span-1">
                <SpendBreakdown
                  campaigns={campaigns}
                  dailyData={dailyData}
                  totalSpend={metrics.spend}
                  isConnected={isConnected}
                />
              </div>
              
              {/* PRO ONLY Metrics */}
              {proMode && (
                <>
                  <MetricCard
                    title="CPM - Custo por Mil"
                    value={`R$ ${metrics.cpm.toFixed(2)}`}
                    icon={Eye}
                    status={getPerformanceStatus(metrics.cpm, 'cpm')}
                    benchmark="R$ 5-20 (bom) | R$ 30+ (ruim)"
                    isConnected={isConnected}
                  />
                  
                  <MetricCard
                    title="Taxa de Gancho (3s)"
                    value={`${metrics.hookRate.toFixed(0)}%`}
                    icon={Play}
                    status={getPerformanceStatus(metrics.hookRate, 'hookRate')}
                    benchmark="30%+ (bom) | 20% (ruim)"
                    isConnected={isConnected}
                  />
                </>
              )}
            </div>

            {/* Period Comparison - PRO ONLY */}
            {proMode && (
              <PeriodComparison currentMetrics={metrics} isConnected={isConnected} />
            )}

            {/* Metrics Evolution Chart - PRO ONLY */}
            {proMode && <MetricsEvolutionChart data={dailyData} isLoading={isLoading} metaConfig={metaConfig} />}

            {/* Placement Metrics - PRO ONLY */}
            {proMode && <PlacementMetrics placementData={placementData} />}

            {/* Segment Analysis - ALWAYS VISIBLE */}
            <SegmentAnalysis 
              campaigns={campaigns} 
              adSets={adSets}
              creatives={creatives} 
              dateRange={dateRange}
              onDateRangeChange={changeDateRange}
              isLoading={isLoading}
              onRefresh={refreshMetrics}
            />

            {/* Strategy Panel - PRO ONLY */}
            {proMode && (
              <StrategyPanel
                campaigns={campaigns}
                adSets={adSets}
                creatives={creatives}
                totalSpend={metrics.spend}
                totalConversions={campaigns.reduce((acc, c) => acc + c.conversions, 0)}
              />
            )}

            {/* Action History - PRO ONLY */}
            {proMode && <ActionHistory />}
          </TabsContent>

          {/* Tab: Público Orgânico */}
          <TabsContent value="organic" className="mt-6">
            <OrganicMetrics 
              isConnected={isConnected}
              accessToken={metaConfig?.accessToken}
              pageId={metaConfig?.accountId}
              onMetricsChange={setOrganicMetricsData}
              externalPeriod={dateRange}
            />
          </TabsContent>

          {/* Tab: Automação Instagram */}
          <TabsContent value="automation" className="mt-6">
            <InstagramAutomation isConnected={isConnected} initialTab={urlSubTab} />
          </TabsContent>

          {/* Tab: Metas e Prazos */}
          <TabsContent value="goals" className="mt-6">
            <GoalsManager 
              currentMetrics={{
                conversions: metrics.conversions,
                revenue: leadStats.totalRevenue,
                leads: leadStats.total,
                cpc: metrics.cpc,
                ctr: metrics.ctr,
                spend: metrics.spend,
              }}
              autoSync={isConnected}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MetricCard from "./MetricCard";

import BMConnection from "./BMConnection";
import SegmentAnalysis from "./SegmentAnalysis";
import StrategyPanel from "./StrategyPanel";
import ActionHistory from "./ActionHistory";
import AlertSettings from "./AlertSettings";
import PeriodComparison from "./PeriodComparison";
import { MetricsChart } from "./MetricsChart";
import { PlacementMetrics } from "./PlacementMetrics";
import OrganicMetrics from "./OrganicMetrics";
import GoalsManager from "./GoalsManager";
import { TrendingUp, Target, MousePointer, Eye, Play, DollarSign, Users, UserPlus, Phone, CheckCircle, XCircle, Trophy, UserX, Sparkles, LayoutDashboard, Megaphone, Heart, Flag } from "lucide-react";
import { useMetaAPI } from "@/hooks/useMetaAPI";
import { useMetricAlerts } from "@/hooks/useMetricAlerts";
import { useLeads } from "@/hooks/useLeads";
import { Link } from "react-router-dom";

const Dashboard = () => {
  const [proMode, setProMode] = useState(false);
  
  const { 
    metrics, 
    campaigns, 
    adSets,
    creatives,
    dailyData,
    placementData,
    dateRange, 
    changeDateRange, 
    isLoading,
    isConnected,
    error,
    connectToMeta,
    disconnect,
    refreshMetrics
  } = useMetaAPI();

  const { stats: leadStats, loading: leadsLoading } = useLeads();

  const {
    getThresholds,
    saveThresholds,
    requestNotificationPermission,
    hasNotificationPermission,
  } = useMetricAlerts(metrics, isConnected);

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
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-semibold text-foreground mb-2">
            Dashboard de Marketing Digital
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Monitore seus benchmarks em tempo real conectado ao Meta Business Manager
          </p>
          
          {/* Mode Toggle */}
          <div className="flex items-center justify-center gap-4 pt-2">
            <Link to="/leads">
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4 mr-2" />
                Central de Leads
              </Button>
            </Link>
            
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
        </div>

        {/* Pipeline de Leads - Resumo */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Central de Leads
              </CardTitle>
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
                {leadStats.totalRevenue > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Receita:</span>
                    <Badge className="bg-emerald-500">R$ {leadStats.totalRevenue.toLocaleString('pt-BR')}</Badge>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Connection Status */}
        <BMConnection 
          isConnected={isConnected}
          isLoading={isLoading}
          error={error}
          onConnect={connectToMeta}
          onDisconnect={disconnect}
          onRefresh={refreshMetrics}
        />

        {/* Tabs: Tráfego Pago / Público Orgânico / Metas */}
        <Tabs defaultValue="paid" className="w-full">
          <TabsList className="grid w-full max-w-lg mx-auto grid-cols-3">
            <TabsTrigger value="paid" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Tráfego Pago
            </TabsTrigger>
            <TabsTrigger value="organic" className="gap-2">
              <Heart className="h-4 w-4" />
              Orgânico
            </TabsTrigger>
            <TabsTrigger value="goals" className="gap-2">
              <Flag className="h-4 w-4" />
              Metas
            </TabsTrigger>
          </TabsList>

          {/* Tab: Tráfego Pago */}
          <TabsContent value="paid" className="space-y-8 mt-6">
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
              
              <MetricCard
                title="Gasto Total"
                value={`R$ ${metrics.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                icon={DollarSign}
                status="success"
                benchmark="Gasto acumulado no período"
                isConnected={isConnected}
              />
              
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
            {proMode && <MetricsChart data={dailyData} isLoading={isLoading} />}

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
            <OrganicMetrics isConnected={isConnected} />
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
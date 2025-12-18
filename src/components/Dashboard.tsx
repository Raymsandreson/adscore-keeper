import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import MetricCard from "./MetricCard";
import BenchmarkTable from "./BenchmarkTable";
import BMConnection from "./BMConnection";
import SegmentAnalysis from "./SegmentAnalysis";
import StrategyPanel from "./StrategyPanel";
import ActionHistory from "./ActionHistory";
import { MetricsChart } from "./MetricsChart";
import { TrendingUp, Target, MousePointer, Eye, Play, DollarSign, Users } from "lucide-react";
import { useMetaAPI } from "@/hooks/useMetaAPI";
import { Link } from "react-router-dom";

const Dashboard = () => {
  const { 
    metrics, 
    campaigns, 
    adSets,
    creatives,
    dailyData,
    dateRange, 
    changeDateRange, 
    isLoading,
    isConnected,
    error,
    connectToMeta,
    disconnect,
    refreshMetrics
  } = useMetaAPI();

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
          <Link to="/leads">
            <Button variant="outline" className="mt-2">
              <Users className="h-4 w-4 mr-2" />
              Central de Leads (otimização)
            </Button>
          </Link>
        </div>

        {/* Connection Status */}
        <BMConnection 
          isConnected={isConnected}
          isLoading={isLoading}
          error={error}
          onConnect={connectToMeta}
          onDisconnect={disconnect}
          onRefresh={refreshMetrics}
        />

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            title="CPM - Custo por Mil"
            value={`R$ ${metrics.cpm.toFixed(2)}`}
            icon={Eye}
            status={getPerformanceStatus(metrics.cpm, 'cpm')}
            benchmark="R$ 5-20 (bom) | R$ 30+ (ruim)"
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
            title="Taxa de Gancho (3s)"
            value={`${metrics.hookRate.toFixed(0)}%`}
            icon={Play}
            status={getPerformanceStatus(metrics.hookRate, 'hookRate')}
            benchmark="30%+ (bom) | 20% (ruim)"
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
        </div>

        {/* Benchmark Reference Table */}
        <BenchmarkTable />

        {/* Metrics Evolution Chart */}
        <MetricsChart data={dailyData} isLoading={isLoading} />

        {/* Segment Analysis */}
        <SegmentAnalysis 
          campaigns={campaigns} 
          adSets={adSets}
          creatives={creatives} 
          dateRange={dateRange}
          onDateRangeChange={changeDateRange}
          isLoading={isLoading}
          onRefresh={refreshMetrics}
        />

        {/* Strategy Panel - Estrategista de Escala */}
        <StrategyPanel
          campaigns={campaigns}
          adSets={adSets}
          creatives={creatives}
          totalSpend={metrics.spend}
          totalConversions={campaigns.reduce((acc, c) => acc + c.conversions, 0)}
        />

        {/* Action History */}
        <ActionHistory />
      </div>
    </div>
  );
};

export default Dashboard;
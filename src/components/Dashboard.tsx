import { useState } from "react";
import { Card } from "@/components/ui/card";
import MetricCard from "./MetricCard";
import BenchmarkTable from "./BenchmarkTable";
import BMConnection from "./BMConnection";
import { TrendingUp, Target, MousePointer, Eye, Play, DollarSign } from "lucide-react";
import { useMetaAPI } from "@/hooks/useMetaAPI";

const Dashboard = () => {
  const [isConnected, setIsConnected] = useState(false);
  const { metrics } = useMetaAPI();

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
    <div className="min-h-screen bg-gradient-dashboard p-4 md:p-8 overflow-hidden relative">
      {/* Partículas de fundo animadas */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 w-2 h-2 bg-primary/20 rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
        <div className="absolute top-20 right-20 w-1 h-1 bg-accent-bright/30 rounded-full animate-bounce" style={{animationDelay: '1s'}}></div>
        <div className="absolute bottom-20 left-1/4 w-1.5 h-1.5 bg-neon-purple/25 rounded-full animate-bounce" style={{animationDelay: '2s'}}></div>
        <div className="absolute bottom-32 right-1/3 w-1 h-1 bg-success/20 rounded-full animate-bounce" style={{animationDelay: '1.5s'}}></div>
        <div className="absolute top-1/3 left-1/3 w-1 h-1 bg-warning/25 rounded-full animate-bounce" style={{animationDelay: '0.5s'}}></div>
      </div>

      <div className="max-w-7xl mx-auto space-y-8 relative z-10">
        {/* Header com animação */}
        <div className="text-center space-y-4 animate-fade-in-up">
          <h1 className="text-4xl md:text-6xl font-bold gradient-text mb-4 tracking-tight">
            Dashboard de Marketing
          </h1>
          <p className="text-muted-foreground text-lg md:text-xl animate-slide-in-right animation-delay-300 max-w-3xl mx-auto">
            🚀 Monitore seus benchmarks em tempo real conectado ao Meta Business Manager
          </p>
          <div className="w-24 h-1 bg-gradient-primary mx-auto rounded-full animate-bounce-in animation-delay-500 shadow-glow"></div>
        </div>

        {/* Connection Status */}
        <BMConnection 
          onConnectionChange={setIsConnected}
        />

        {/* Metrics Grid com animações escalonadas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Cada MetricCard receberá a classe metric-card automaticamente */}
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
            benchmark="Gasto acumulado hoje"
            isConnected={isConnected}
          />
        </div>

        {/* Benchmark Reference Table */}
        <BenchmarkTable />
      </div>
    </div>
  );
};

export default Dashboard;
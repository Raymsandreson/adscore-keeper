import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlacementInsight } from '@/hooks/useMetaAPI';
import { 
  LayoutGrid, 
  Film, 
  Play, 
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Eye,
  MousePointer,
  Target,
  BarChart3,
  Columns
} from 'lucide-react';

interface PlacementMetricsProps {
  placementData: PlacementInsight[];
}

const placementIcons: Record<string, React.ReactNode> = {
  feed: <LayoutGrid className="h-4 w-4" />,
  story: <Film className="h-4 w-4" />,
  reels: <Play className="h-4 w-4" />,
  right_column: <Columns className="h-4 w-4" />,
  marketplace: <LayoutGrid className="h-4 w-4" />,
  search: <Target className="h-4 w-4" />,
  instant_article: <LayoutGrid className="h-4 w-4" />,
  other: <BarChart3 className="h-4 w-4" />
};

const placementColors: Record<string, string> = {
  feed: 'bg-blue-500',
  story: 'bg-purple-500',
  reels: 'bg-pink-500',
  right_column: 'bg-gray-500',
  marketplace: 'bg-green-500',
  search: 'bg-orange-500',
  instant_article: 'bg-cyan-500',
  other: 'bg-slate-500'
};

export const PlacementMetrics = ({ placementData }: PlacementMetricsProps) => {
  const totalSpend = placementData.reduce((sum, p) => sum + p.spend, 0);
  const totalImpressions = placementData.reduce((sum, p) => sum + p.impressions, 0);
  const totalClicks = placementData.reduce((sum, p) => sum + p.clicks, 0);
  const totalConversions = placementData.reduce((sum, p) => sum + p.conversions, 0);

  // Find best and worst performers
  const sortedByCTR = [...placementData].sort((a, b) => b.ctr - a.ctr);
  const sortedByCPC = [...placementData].sort((a, b) => a.cpc - b.cpc);
  const sortedByConversion = [...placementData].sort((a, b) => b.conversionRate - a.conversionRate);

  const bestCTR = sortedByCTR[0];
  const worstCTR = sortedByCTR[sortedByCTR.length - 1];
  const bestCPC = sortedByCPC[0];
  const bestConversion = sortedByConversion[0];

  const getPerformanceBadge = (value: number, metric: 'ctr' | 'cpc' | 'conversion') => {
    const thresholds = {
      ctr: { good: 2.5, warning: 1.5 },
      cpc: { good: 1.5, warning: 2.5 },
      conversion: { good: 3.5, warning: 2 }
    };

    const isGood = metric === 'cpc' 
      ? value <= thresholds[metric].good 
      : value >= thresholds[metric].good;
    const isWarning = metric === 'cpc'
      ? value <= thresholds[metric].warning
      : value >= thresholds[metric].warning;

    if (isGood) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Ótimo</Badge>;
    }
    if (isWarning) {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Regular</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Atenção</Badge>;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatNumber = (value: number | undefined | null) => {
    return new Intl.NumberFormat('pt-BR').format(value ?? 0);
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Métricas por Posicionamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                <span className="text-sm text-muted-foreground">Melhor CTR</span>
              </div>
              <p className="text-lg font-bold">{bestCTR?.placementLabel || '-'}</p>
              <p className="text-sm text-blue-400">{bestCTR?.ctr.toFixed(2)}%</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-green-400" />
                <span className="text-sm text-muted-foreground">Menor CPC</span>
              </div>
              <p className="text-lg font-bold">{bestCPC?.placementLabel || '-'}</p>
              <p className="text-sm text-green-400">{formatCurrency(bestCPC?.cpc || 0)}</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-purple-400" />
                <span className="text-sm text-muted-foreground">Melhor Conversão</span>
              </div>
              <p className="text-lg font-bold">{bestConversion?.placementLabel || '-'}</p>
              <p className="text-sm text-purple-400">{bestConversion?.conversionRate.toFixed(2)}%</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-orange-400" />
                <span className="text-sm text-muted-foreground">Menor CTR</span>
              </div>
              <p className="text-lg font-bold">{worstCTR?.placementLabel || '-'}</p>
              <p className="text-sm text-orange-400">{worstCTR?.ctr.toFixed(2)}%</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="comparison">Comparativo</TabsTrigger>
            <TabsTrigger value="recommendations">Recomendações</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            {placementData.map((placement) => {
              const spendPercentage = totalSpend > 0 ? (placement.spend / totalSpend) * 100 : 0;
              
              return (
                <Card key={placement.placement} className="bg-card/30 border-border/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${placementColors[placement.placement]}/20`}>
                          {placementIcons[placement.placement]}
                        </div>
                        <div>
                          <h4 className="font-semibold">{placement.placementLabel}</h4>
                          <p className="text-sm text-muted-foreground">
                            {spendPercentage.toFixed(1)}% do investimento
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(placement.spend)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatNumber(placement.impressions)} impressões
                        </p>
                      </div>
                    </div>

                    <Progress value={spendPercentage} className="h-2 mb-4" />

                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">CTR</p>
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-semibold">{placement.ctr.toFixed(2)}%</span>
                          {getPerformanceBadge(placement.ctr, 'ctr')}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">CPC</p>
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-semibold">{formatCurrency(placement.cpc)}</span>
                          {getPerformanceBadge(placement.cpc, 'cpc')}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">CPM</p>
                        <span className="font-semibold">{formatCurrency(placement.cpm)}</span>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Conv.</p>
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-semibold">{placement.conversionRate.toFixed(2)}%</span>
                          {getPerformanceBadge(placement.conversionRate, 'conversion')}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="comparison" className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-3">Posicionamento</th>
                    <th className="text-right p-3">Investimento</th>
                    <th className="text-right p-3">Impressões</th>
                    <th className="text-right p-3">Cliques</th>
                    <th className="text-right p-3">CTR</th>
                    <th className="text-right p-3">CPC</th>
                    <th className="text-right p-3">CPM</th>
                    <th className="text-right p-3">Conversões</th>
                    <th className="text-right p-3">Taxa Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {placementData.map((placement) => (
                    <tr key={placement.placement} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded ${placementColors[placement.placement]}/20`}>
                            {placementIcons[placement.placement]}
                          </div>
                          {placement.placementLabel}
                        </div>
                      </td>
                      <td className="text-right p-3 font-medium">{formatCurrency(placement.spend)}</td>
                      <td className="text-right p-3">{formatNumber(placement.impressions)}</td>
                      <td className="text-right p-3">{formatNumber(placement.clicks)}</td>
                      <td className="text-right p-3">
                        <span className={placement.ctr >= 2.5 ? 'text-green-400' : placement.ctr >= 1.5 ? 'text-yellow-400' : 'text-red-400'}>
                          {placement.ctr.toFixed(2)}%
                        </span>
                      </td>
                      <td className="text-right p-3">
                        <span className={placement.cpc <= 1.5 ? 'text-green-400' : placement.cpc <= 2.5 ? 'text-yellow-400' : 'text-red-400'}>
                          {formatCurrency(placement.cpc)}
                        </span>
                      </td>
                      <td className="text-right p-3">{formatCurrency(placement.cpm)}</td>
                      <td className="text-right p-3">{formatNumber(placement.conversions)}</td>
                      <td className="text-right p-3">
                        <span className={placement.conversionRate >= 3.5 ? 'text-green-400' : placement.conversionRate >= 2 ? 'text-yellow-400' : 'text-red-400'}>
                          {placement.conversionRate.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border/50 bg-muted/10">
                  <tr>
                    <td className="p-3 font-bold">Total</td>
                    <td className="text-right p-3 font-bold">{formatCurrency(totalSpend)}</td>
                    <td className="text-right p-3 font-bold">{formatNumber(totalImpressions)}</td>
                    <td className="text-right p-3 font-bold">{formatNumber(totalClicks)}</td>
                    <td className="text-right p-3 font-bold">
                      {totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0}%
                    </td>
                    <td className="text-right p-3 font-bold">
                      {formatCurrency(totalClicks > 0 ? totalSpend / totalClicks : 0)}
                    </td>
                    <td className="text-right p-3 font-bold">
                      {formatCurrency(totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0)}
                    </td>
                    <td className="text-right p-3 font-bold">{formatNumber(totalConversions)}</td>
                    <td className="text-right p-3 font-bold">
                      {totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : 0}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="recommendations" className="mt-4 space-y-4">
            {/* Recommendations based on data */}
            {bestCTR && bestCTR.ctr > (sortedByCTR[1]?.ctr || 0) * 1.3 && (
              <Card className="bg-green-500/10 border-green-500/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-green-400">Escale {bestCTR.placementLabel}</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Este posicionamento tem CTR {((bestCTR.ctr / (sortedByCTR[1]?.ctr || 1)) * 100 - 100).toFixed(0)}% maior que o segundo melhor. 
                        Considere aumentar o investimento neste formato para maximizar engajamento.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {bestConversion && (
              <Card className="bg-purple-500/10 border-purple-500/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Target className="h-5 w-5 text-purple-400 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-purple-400">Foco em Conversões: {bestConversion.placementLabel}</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Taxa de conversão de {bestConversion.conversionRate.toFixed(2)}%. 
                        Para campanhas focadas em resultados, priorize este posicionamento.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {worstCTR && worstCTR.ctr < 1.5 && worstCTR.spend > totalSpend * 0.1 && (
              <Card className="bg-orange-500/10 border-orange-500/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <TrendingDown className="h-5 w-5 text-orange-400 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-orange-400">Revise {worstCTR.placementLabel}</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        CTR de apenas {worstCTR.ctr.toFixed(2)}% com {((worstCTR.spend / totalSpend) * 100).toFixed(1)}% do investimento. 
                        Considere reduzir o orçamento ou ajustar os criativos para este formato.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {placementData.find(p => p.placement === 'reels') && (
              <Card className="bg-pink-500/10 border-pink-500/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Play className="h-5 w-5 text-pink-400 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-pink-400">Dica: Reels em Crescimento</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        O formato Reels tem mostrado crescimento orgânico significativo. 
                        Invista em conteúdo nativo para este formato para melhorar performance.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-blue-500/10 border-blue-500/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Eye className="h-5 w-5 text-blue-400 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-blue-400">Diversificação de Posicionamentos</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {placementData.length >= 4 
                        ? 'Boa diversificação! Você está presente em múltiplos posicionamentos, o que ajuda a alcançar diferentes públicos.'
                        : 'Considere testar mais posicionamentos para diversificar seu alcance e encontrar novas oportunidades.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

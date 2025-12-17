import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb, TrendingDown, TrendingUp, Target, Megaphone, X, Calendar, Loader2, Users } from "lucide-react";
import { CampaignInsight } from "@/services/metaAPI";
import { DateRangeOption } from "@/hooks/useMetaAPI";
import { CampaignControls } from "./CampaignControls";

interface AIsuggestion {
  type: 'critical' | 'warning' | 'opportunity';
  metric: string;
  suggestion: string;
  impact: string;
}

interface SegmentAnalysisProps {
  campaigns: CampaignInsight[];
  adSets: CampaignInsight[];
  creatives: CampaignInsight[];
  dateRange: DateRangeOption;
  onDateRangeChange: (range: DateRangeOption) => void;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const SegmentAnalysis = ({ campaigns, adSets, creatives, dateRange, onDateRangeChange, isLoading, onRefresh }: SegmentAnalysisProps) => {
  const [selectedItem, setSelectedItem] = useState<CampaignInsight | null>(null);

  const generateAISuggestions = (item: CampaignInsight): AIsuggestion[] => {
    const suggestions: AIsuggestion[] = [];
    const isCampaign = item.type === 'campaign';

    // Análise de CPC
    if (item.cpc > 2.5) {
      suggestions.push({
        type: 'critical',
        metric: 'CPC Alto',
        suggestion: isCampaign 
          ? `O CPC de R$${item.cpc.toFixed(2)} está acima do ideal. Revise a segmentação, teste públicos menores e mais qualificados, ou ajuste os lances para "menor custo".`
          : `Este criativo tem CPC elevado (R$${item.cpc.toFixed(2)}). Teste variações com CTAs mais claros, cores contrastantes ou formatos diferentes como carrossel.`,
        impact: 'Redução estimada de 25-40% no CPC'
      });
    }

    // Análise de CTR
    if (item.ctr < 1.5) {
      suggestions.push({
        type: 'critical',
        metric: 'CTR Baixo',
        suggestion: isCampaign
          ? `CTR de ${item.ctr.toFixed(2)}% indica baixo engajamento. Revise os criativos da campanha, teste novos hooks nos primeiros 3 segundos e headlines mais impactantes.`
          : `CTR muito baixo (${item.ctr.toFixed(2)}%). O criativo não está atraindo cliques. Teste: nova thumbnail, texto mais direto, ou oferta mais clara no início.`,
        impact: 'Aumento esperado de 80-150% no CTR'
      });
    } else if (item.ctr < 2.0) {
      suggestions.push({
        type: 'warning',
        metric: 'CTR Moderado',
        suggestion: isCampaign
          ? `CTR de ${item.ctr.toFixed(2)}% está na média. Para melhorar, teste headlines com números/urgência e criativos com provas sociais.`
          : `CTR de ${item.ctr.toFixed(2)}% pode melhorar. Adicione elementos de urgência, depoimentos ou benefícios mais claros.`,
        impact: 'Potencial aumento de 30-50% no CTR'
      });
    }

    // Análise de Taxa de Conversão
    if (item.conversionRate < 2.0) {
      suggestions.push({
        type: 'critical',
        metric: 'Conversão Baixa',
        suggestion: isCampaign
          ? `Taxa de conversão de ${item.conversionRate.toFixed(2)}% indica problema no funil. Verifique: landing page carregando rápido? Formulário simplificado? Oferta clara?`
          : `Conversão baixa (${item.conversionRate.toFixed(2)}%). O criativo atrai mas não converte. Alinhe melhor a promessa do anúncio com a landing page.`,
        impact: 'Potencial aumento de 50-100% nas conversões'
      });
    } else if (item.conversionRate < 3.0) {
      suggestions.push({
        type: 'warning',
        metric: 'Conversão Média',
        suggestion: `Taxa de ${item.conversionRate.toFixed(2)}% está ok mas pode melhorar. Teste: mais urgência, garantias, depoimentos na LP, ou simplifique o checkout.`,
        impact: 'Aumento esperado de 20-40% nas conversões'
      });
    }

    // Análise de CPM
    if (item.cpm > 30) {
      suggestions.push({
        type: 'warning',
        metric: 'CPM Elevado',
        suggestion: isCampaign
          ? `CPM de R$${item.cpm.toFixed(2)} está alto. Teste públicos menos competitivos, horários alternativos, ou amplie levemente a segmentação.`
          : `CPM alto no criativo. O formato pode ser mais caro (vídeo longo). Teste versões mais curtas ou imagens estáticas.`,
        impact: 'Economia de 15-30% no CPM'
      });
    }

    // Oportunidade de escala
    if (item.ctr > 2.5 && item.conversionRate > 3.5 && item.cpc < 2.0) {
      suggestions.push({
        type: 'opportunity',
        metric: 'Escalar',
        suggestion: isCampaign
          ? `Performance excelente! Aumente o orçamento em 20-30% gradualmente. Crie lookalikes dos compradores desta campanha.`
          : `Criativo top performer! Duplique para testar em outros públicos. Use como referência para novos criativos.`,
        impact: 'Potencial de 2-3x mais resultados'
      });
    }

    // Análise de ROI/Eficiência
    if (item.spend > 500 && item.conversions < 5) {
      suggestions.push({
        type: 'critical',
        metric: 'ROI Negativo',
        suggestion: isCampaign
          ? `Gasto de R$${item.spend.toFixed(0)} com apenas ${item.conversions} conversões. Pause e reavalie segmentação e criativos antes de continuar.`
          : `Este criativo gastou R$${item.spend.toFixed(0)} com baixo retorno. Considere pausar e testar novas abordagens.`,
        impact: 'Evitar mais perdas de budget'
      });
    }

    // Se performance boa mas pode melhorar
    if (item.ctr > 2.0 && item.conversionRate > 2.5 && item.conversionRate < 4.0) {
      suggestions.push({
        type: 'opportunity',
        metric: 'Otimizar LP',
        suggestion: `Bom CTR mas conversão pode melhorar. Foque na landing page: teste headlines, reduza fricção no formulário, adicione mais provas sociais.`,
        impact: 'Aumento de 25-50% nas conversões'
      });
    }

    return suggestions.length > 0 ? suggestions : [{
      type: 'opportunity',
      metric: 'Monitorar',
      suggestion: 'Performance dentro do esperado. Continue monitorando e colete mais dados para insights mais precisos.',
      impact: 'Manter estabilidade'
    }];
  };

  const getStatusBadge = (value: number, metric: 'cpc' | 'ctr' | 'conversion') => {
    let status: 'success' | 'warning' | 'danger';
    
    switch (metric) {
      case 'cpc':
        status = value <= 2.0 ? 'success' : value <= 3.0 ? 'warning' : 'danger';
        break;
      case 'ctr':
        status = value >= 2.5 ? 'success' : value >= 1.5 ? 'warning' : 'danger';
        break;
      case 'conversion':
        status = value >= 3.5 ? 'success' : value >= 2.0 ? 'warning' : 'danger';
        break;
    }

    const colors = {
      success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      danger: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };

    return colors[status];
  };

  const getEntityType = (item: CampaignInsight): 'campaign' | 'adset' | 'ad' => {
    if (item.type === 'campaign') return 'campaign';
    if (item.type === 'adset') return 'adset';
    return 'ad';
  };

  const ItemCard = ({ item }: { item: CampaignInsight }) => (
    <Card 
      className="hover:shadow-md transition-all border-border/50 hover:border-primary/30"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {item.type === 'campaign' ? (
              <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            ) : item.type === 'adset' ? (
              <Users className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            ) : (
              <Megaphone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            )}
            <CardTitle className="text-sm font-medium leading-tight truncate">{item.name}</CardTitle>
          </div>
          <CampaignControls
            entityId={item.id}
            entityType={getEntityType(item)}
            entityName={item.name}
            currentStatus={item.status as 'ACTIVE' | 'PAUSED' || 'ACTIVE'}
            currentBudget={item.spend}
            onActionComplete={onRefresh}
          />
        </div>
        {item.status && (
          <Badge 
            variant={item.status === 'ACTIVE' ? 'default' : 'secondary'}
            className="text-xs w-fit"
          >
            {item.status === 'ACTIVE' ? 'Ativo' : 'Pausado'}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">CPC:</span>
            <Badge className={getStatusBadge(item.cpc, 'cpc')}>
              R$ {item.cpc.toFixed(2)}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">CTR:</span>
            <Badge className={getStatusBadge(item.ctr, 'ctr')}>
              {item.ctr.toFixed(2)}%
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Conv:</span>
            <Badge className={getStatusBadge(item.conversionRate, 'conversion')}>
              {item.conversionRate.toFixed(1)}%
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Gasto:</span>
            <span className="font-medium text-foreground">R$ {item.spend.toFixed(0)}</span>
          </div>
        </div>
        <div className="pt-1 border-t border-border/50">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{item.impressions.toLocaleString()} impr.</span>
            <span>{item.clicks.toLocaleString()} cliques</span>
            <span>{item.conversions} conv.</span>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full text-xs"
          onClick={() => setSelectedItem(item)}
        >
          <Lightbulb className="h-3 w-3 mr-1" />
          Ver Sugestões IA
        </Button>
      </CardContent>
    </Card>
  );

  const SuggestionPanel = ({ item }: { item: CampaignInsight }) => {
    const suggestions = generateAISuggestions(item);
    
    return (
      <Card className="border-primary/20 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Sugestões de IA</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{item.name}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggestions.map((suggestion, index) => (
            <div 
              key={index}
              className={`p-3 rounded-lg border ${
                suggestion.type === 'critical' 
                  ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30' 
                  : suggestion.type === 'warning'
                  ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30'
                  : 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className={`p-1.5 rounded-full ${
                  suggestion.type === 'critical' ? 'bg-red-100 dark:bg-red-900' : 
                  suggestion.type === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900' : 
                  'bg-green-100 dark:bg-green-900'
                }`}>
                  {suggestion.type === 'opportunity' ? (
                    <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <TrendingDown className={`h-3.5 w-3.5 ${
                      suggestion.type === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'
                    }`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={
                      suggestion.type === 'critical' ? 'destructive' : 
                      suggestion.type === 'warning' ? 'secondary' : 'default'
                    } className="text-xs">
                      {suggestion.metric}
                    </Badge>
                    <span className={`text-xs font-medium ${
                      suggestion.type === 'critical' ? 'text-red-600 dark:text-red-400' : 
                      suggestion.type === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 
                      'text-green-600 dark:text-green-400'
                    }`}>
                      {suggestion.type === 'critical' ? 'AÇÃO URGENTE' : 
                       suggestion.type === 'warning' ? 'ATENÇÃO' : 'OPORTUNIDADE'}
                    </span>
                  </div>
                  <p className="text-sm text-foreground mb-2">{suggestion.suggestion}</p>
                  <p className="text-xs text-muted-foreground font-medium">{suggestion.impact}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              Análise por Segmento
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Selecione uma campanha ou criativo para ver sugestões de otimização da IA
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={dateRange} onValueChange={(value) => onDateRangeChange(value as DateRangeOption)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="last_7d">Últimos 7 dias</SelectItem>
                <SelectItem value="last_30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="campaigns" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Campanhas ({campaigns.length})
            </TabsTrigger>
            <TabsTrigger value="adsets" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Conjuntos ({adSets.length})
            </TabsTrigger>
            <TabsTrigger value="creatives" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Criativos ({creatives.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaigns.map((campaign) => (
                <ItemCard key={campaign.id} item={campaign} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="adsets" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adSets.map((adSet) => (
                <ItemCard key={adSet.id} item={adSet} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="creatives" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatives.map((creative) => (
                <ItemCard key={creative.id} item={creative} />
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {selectedItem && (
          <div className="mt-6">
            <SuggestionPanel item={selectedItem} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SegmentAnalysis;
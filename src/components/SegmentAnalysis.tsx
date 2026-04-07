import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lightbulb, TrendingDown, TrendingUp, Target, Megaphone, X, Calendar as CalendarIcon, Loader2, Users, Pause, Play, Settings2, Sparkles, UserPlus, Phone, CheckCircle, XCircle, Trophy, UserX } from "lucide-react";
import { AdSetGeoDisplay } from "./AdSetGeoDisplay";
import { CampaignInsight } from "@/services/metaAPI";
import { DateRangeOption } from "@/hooks/useMetaAPI";
import { CampaignControls } from "./CampaignControls";
import { useCampaignManager } from "@/hooks/useCampaignManager";
import CampaignAIAssistant from "./CampaignAIAssistant";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useLeads, Lead } from "@/hooks/useLeads";

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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState<CampaignInsight | null>(null);
  const [aiAssistantItem, setAiAssistantItem] = useState<CampaignInsight | null>(null);
  const [recentlyChanged, setRecentlyChanged] = useState<{ id: string; action: 'paused' | 'activated' } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const { updateStatus } = useCampaignManager();
  const { leads } = useLeads();

  // Helper function to get lead stats for a specific entity
  const getLeadStatsForEntity = (entityType: 'campaign' | 'adset' | 'ad', entityId: string) => {
    let filteredLeads: Lead[] = [];
    
    if (entityType === 'campaign') {
      filteredLeads = leads.filter(l => l.campaign_id === entityId);
    } else if (entityType === 'adset') {
      filteredLeads = leads.filter(l => l.adset_id === entityId);
    } else {
      filteredLeads = leads.filter(l => l.creative_id === entityId);
    }

    return {
      total: filteredLeads.length,
      new: filteredLeads.filter(l => l.status === 'new').length,
      contacted: filteredLeads.filter(l => l.status === 'contacted').length,
      qualified: filteredLeads.filter(l => l.status === 'qualified').length,
      notQualified: filteredLeads.filter(l => l.status === 'not_qualified').length,
      converted: filteredLeads.filter(l => l.status === 'converted').length,
      lost: filteredLeads.filter(l => l.status === 'lost').length,
    };
  };

  const filterByStatus = (items: CampaignInsight[]) => {
    if (statusFilter === 'all') return items;
    return items.filter(item => {
      const isActive = item.status === 'ACTIVE';
      return statusFilter === 'active' ? isActive : !isActive;
    });
  };

  const filteredCampaigns = filterByStatus(campaigns);
  const filteredAdSets = filterByStatus(adSets);
  const filteredCreatives = filterByStatus(creatives);

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

  const getRecommendation = (item: CampaignInsight): { action: 'pause' | 'optimize' | 'scale' | 'monitor', label: string, variant: 'destructive' | 'secondary' | 'default', urgent: boolean } => {
    // Pausar: CTR muito baixo ou ROI negativo
    if (item.ctr < 1.0 || (item.spend > 300 && item.conversions < 2)) {
      return { action: 'pause', label: 'Pausar', variant: 'destructive', urgent: true };
    }
    // Escalar: Ótima performance
    if (item.ctr > 2.5 && item.conversionRate > 3.5 && item.cpc < 2.0) {
      return { action: 'scale', label: 'Escalar', variant: 'default', urgent: false };
    }
    // Otimizar: Performance média
    if (item.ctr < 2.0 || item.conversionRate < 3.0) {
      return { action: 'optimize', label: 'Otimizar', variant: 'secondary', urgent: false };
    }
    // Manter
    return { action: 'monitor', label: 'Manter', variant: 'default', urgent: false };
  };

  const handleDirectAction = async (item: CampaignInsight, action: 'pause' | 'activate') => {
    if (action === 'pause') {
      setConfirmPause(item);
      return;
    }
    setActionLoading(item.id);
    const entityType = getEntityType(item);
    const result = await updateStatus(item.id, entityType, 'ACTIVE', item.name);
    setActionLoading(null);
    if (result.success) {
      setRecentlyChanged({ id: item.id, action: 'activated' });
      setTimeout(() => setRecentlyChanged(null), 2000);
      toast({
        title: "✅ Ativado com sucesso",
        description: `"${item.name}" agora está ativo.`,
      });
      onRefresh?.();
    } else {
      toast({
        title: "Erro ao ativar",
        description: "Não foi possível ativar. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmPause = async () => {
    if (!confirmPause) return;
    setActionLoading(confirmPause.id);
    const entityType = getEntityType(confirmPause);
    const result = await updateStatus(confirmPause.id, entityType, 'PAUSED', confirmPause.name);
    const itemName = confirmPause.name;
    const itemId = confirmPause.id;
    setActionLoading(null);
    setConfirmPause(null);
    if (result.success) {
      setRecentlyChanged({ id: itemId, action: 'paused' });
      setTimeout(() => setRecentlyChanged(null), 2000);
      toast({
        title: "⏸️ Pausado com sucesso",
        description: `"${itemName}" agora está pausado.`,
      });
      onRefresh?.();
    } else {
      toast({
        title: "Erro ao pausar",
        description: "Não foi possível pausar. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const ItemCard = ({ item }: { item: CampaignInsight }) => {
    const recommendation = getRecommendation(item);
    const isActive = item.status === 'ACTIVE';
    const isLoadingThis = actionLoading === item.id;
    const wasJustChanged = recentlyChanged?.id === item.id;
    const changeAction = recentlyChanged?.action;
    const entityType = getEntityType(item);
    const leadStats = getLeadStatsForEntity(entityType, item.id);
    
    return (
      <Card 
        className={`hover:shadow-md transition-all duration-500 border-border/50 hover:border-primary/30 ${
          recommendation.urgent ? 'border-destructive/50 bg-destructive/5' : ''
        } ${wasJustChanged && changeAction === 'paused' 
          ? 'animate-scale-in ring-2 ring-amber-500 bg-amber-50/50 dark:bg-amber-950/30' 
          : ''
        } ${wasJustChanged && changeAction === 'activated' 
          ? 'animate-scale-in ring-2 ring-green-500 bg-green-50/50 dark:bg-green-950/30' 
          : ''
        }`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {item.type === 'campaign' ? (
                  <><Target className="h-3 w-3 mr-1" />Campanha</>
                ) : item.type === 'adset' ? (
                  <><Users className="h-3 w-3 mr-1" />Conjunto</>
                ) : (
                  <><Megaphone className="h-3 w-3 mr-1" />Criativo</>
                )}
              </Badge>
              <Badge variant={recommendation.variant} className="text-xs">
                {recommendation.action === 'pause' && <Pause className="h-3 w-3 mr-1" />}
                {recommendation.action === 'scale' && <TrendingUp className="h-3 w-3 mr-1" />}
                {recommendation.action === 'optimize' && <Settings2 className="h-3 w-3 mr-1" />}
                {recommendation.label.toUpperCase()}
              </Badge>
              {recommendation.urgent && (
                <Badge variant="destructive" className="text-xs">⚠ URGENTE</Badge>
              )}
              {wasJustChanged && (
                <Badge 
                  className={`text-xs animate-scale-in ${
                    changeAction === 'paused' 
                      ? 'bg-amber-500 text-white' 
                      : 'bg-green-500 text-white'
                  }`}
                >
                  {changeAction === 'paused' ? '⏸️ Recém pausado' : '▶️ Recém ativado'}
                </Badge>
              )}
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
          <div className="flex items-center gap-2 mt-2">
            <CardTitle className="text-sm font-medium leading-tight">{item.name}</CardTitle>
          </div>
          <Badge 
            variant="outline" 
            className={`text-xs mt-1 ${
              isActive 
                ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700' 
                : 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600'
            }`}
          >
            {isActive ? '🟢 Ativo' : '⏸️ Pausado'}
          </Badge>
          {item.type === 'adset' && (
            <div className="mt-1.5">
              <AdSetGeoDisplay adSetId={item.id} />
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {recommendation.action === 'pause' && 'CTR muito baixo. Queimando budget sem engajamento.'}
            {recommendation.action === 'scale' && 'Performance excelente! Considere aumentar investimento.'}
            {recommendation.action === 'optimize' && 'Performance abaixo do ideal. Testar variações.'}
            {recommendation.action === 'monitor' && 'Performance estável. Continue monitorando.'}
          </p>
          
          <div className="grid grid-cols-3 gap-2 text-xs text-center">
            <div>
              <p className="text-muted-foreground">CTR</p>
              <p className={`font-semibold ${item.ctr < 1.5 ? 'text-destructive' : item.ctr > 2.5 ? 'text-green-600' : 'text-foreground'}`}>
                {item.ctr.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Conv.</p>
              <p className={`font-semibold ${item.conversionRate < 2 ? 'text-destructive' : item.conversionRate > 3.5 ? 'text-green-600' : 'text-foreground'}`}>
                {item.conversionRate.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Gasto</p>
              <p className="font-semibold">R${item.spend.toFixed(0)}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 text-xs text-center pt-2 border-t border-border/50">
            <div>
              <p className="text-muted-foreground">Impressões</p>
              <p className="font-semibold">{(item.impressions ?? 0).toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Conversões</p>
              <p className={`font-semibold ${(item.conversions ?? 0) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {item.conversions ?? 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">CPA</p>
              <p className="font-semibold">R${(item.conversions ?? 0) > 0 ? ((item.spend ?? 0) / (item.conversions ?? 1)).toFixed(0) : '0'}</p>
            </div>
          </div>

          {/* Lead Pipeline Summary */}
          {leadStats.total > 0 && (
            <div className="pt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Users className="h-3 w-3" />
                Pipeline de Leads ({leadStats.total})
              </p>
              <div className="grid grid-cols-6 gap-1 text-xs text-center">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-1" title="Em análise">
                  <UserPlus className="h-3 w-3 mx-auto text-blue-600 mb-0.5" />
                  <p className="font-semibold text-blue-700 dark:text-blue-400">{leadStats.new}</p>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded p-1" title="Contatado">
                  <Phone className="h-3 w-3 mx-auto text-yellow-600 mb-0.5" />
                  <p className="font-semibold text-yellow-700 dark:text-yellow-400">{leadStats.contacted}</p>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 rounded p-1" title="Qualificado">
                  <CheckCircle className="h-3 w-3 mx-auto text-green-600 mb-0.5" />
                  <p className="font-semibold text-green-700 dark:text-green-400">{leadStats.qualified}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800/30 rounded p-1" title="Desqualificado">
                  <XCircle className="h-3 w-3 mx-auto text-gray-500 mb-0.5" />
                  <p className="font-semibold text-gray-600 dark:text-gray-400">{leadStats.notQualified}</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded p-1" title="Convertido">
                  <Trophy className="h-3 w-3 mx-auto text-emerald-600 mb-0.5" />
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400">{leadStats.converted}</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 rounded p-1" title="Perdido">
                  <UserX className="h-3 w-3 mx-auto text-red-600 mb-0.5" />
                  <p className="font-semibold text-red-700 dark:text-red-400">{leadStats.lost}</p>
                </div>
              </div>
            </div>
          )}

          {/* Direct Action Button */}
          {recommendation.action === 'pause' && isActive && (
            <Button 
              variant="destructive" 
              size="sm" 
              className="w-full"
              onClick={() => handleDirectAction(item, 'pause')}
              disabled={isLoadingThis}
            >
              {isLoadingThis ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
              Pausar Agora
            </Button>
          )}
          
          {!isActive && (
            <Button 
              variant="default" 
              size="sm" 
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => handleDirectAction(item, 'activate')}
              disabled={isLoadingThis}
            >
              {isLoadingThis ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              Ativar
            </Button>
          )}

          {recommendation.action === 'optimize' && isActive && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full border-amber-500 text-amber-600 hover:bg-amber-50"
              onClick={() => setSelectedItem(item)}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Otimizar
            </Button>
          )}

          {recommendation.action === 'scale' && isActive && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full border-green-500 text-green-600 hover:bg-green-50"
              onClick={() => setSelectedItem(item)}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Escalar
            </Button>
          )}

          {recommendation.action === 'monitor' && isActive && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full text-muted-foreground"
              onClick={() => setSelectedItem(item)}
            >
              <Lightbulb className="h-4 w-4 mr-2" />
              Ver Sugestões
            </Button>
          )}

          {/* AI Assistant Button */}
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full border-primary/50 text-primary hover:bg-primary/10 mt-2"
            onClick={() => setAiAssistantItem(item)}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Assistente IA
          </Button>
        </CardContent>
      </Card>
    );
  };

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
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | 'active' | 'paused')}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">🟢 Ativos</SelectItem>
                <SelectItem value="paused">⏸️ Pausados</SelectItem>
              </SelectContent>
            </Select>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            <Select value={dateRange} onValueChange={(value) => onDateRangeChange(value as DateRangeOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
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
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="campaigns" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Campanhas ({filteredCampaigns.length})
            </TabsTrigger>
            <TabsTrigger value="adsets" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Conjuntos ({filteredAdSets.length})
            </TabsTrigger>
            <TabsTrigger value="creatives" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Criativos ({filteredCreatives.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCampaigns.map((campaign) => (
                <ItemCard key={campaign.id} item={campaign} />
              ))}
              {filteredCampaigns.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full text-center py-8">
                  Nenhuma campanha {statusFilter === 'active' ? 'ativa' : statusFilter === 'paused' ? 'pausada' : ''} encontrada.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="adsets" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAdSets.map((adSet) => (
                <ItemCard key={adSet.id} item={adSet} />
              ))}
              {filteredAdSets.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full text-center py-8">
                  Nenhum conjunto {statusFilter === 'active' ? 'ativo' : statusFilter === 'paused' ? 'pausado' : ''} encontrado.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="creatives" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCreatives.map((creative) => (
                <ItemCard key={creative.id} item={creative} />
              ))}
              {filteredCreatives.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full text-center py-8">
                  Nenhum criativo {statusFilter === 'active' ? 'ativo' : statusFilter === 'paused' ? 'pausado' : ''} encontrado.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {selectedItem && (
          <div className="mt-6">
            <SuggestionPanel item={selectedItem} />
          </div>
        )}

        {aiAssistantItem && (
          <div className="mt-6">
            <CampaignAIAssistant 
              item={aiAssistantItem} 
              onClose={() => setAiAssistantItem(null)} 
            />
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!confirmPause} onOpenChange={() => setConfirmPause(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pausa</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja pausar "{confirmPause?.name}"? 
              Esta ação irá parar a veiculação de anúncios imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmPause}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading === confirmPause?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Pausar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default SegmentAnalysis;
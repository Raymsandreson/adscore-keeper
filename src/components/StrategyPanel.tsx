import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, 
  Target, 
  TrendingUp, 
  Zap, 
  DollarSign, 
  Users, 
  BarChart3, 
  CheckCircle2, 
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Rocket,
  Layers,
  RefreshCcw,
  PlusCircle,
  ArrowRight,
  Sparkles,
  Pause,
  Play,
  Scale,
  TrendingDown,
  CircleDollarSign,
  ExternalLink
} from "lucide-react";
import { CampaignInsight } from "@/services/metaAPI";

// Constantes para critérios de análise
const ANALYSIS_CRITERIA = {
  minImpressions: 5000, // Mínimo de impressões para decidir pausar
  minDaysActive: 3, // Mínimo de dias ativo para analisar
  minSpendForDecision: 100, // Gasto mínimo antes de decisão
};

interface StrategyPanelProps {
  campaigns: CampaignInsight[];
  adSets: CampaignInsight[];
  creatives: CampaignInsight[];
  totalSpend: number;
  totalConversions: number;
  convertedLeadsCount?: number; // Leads realmente convertidos (do CRM)
  costPerConvertedLead?: number; // Custo por lead convertido real
}

interface LTVData {
  averageLTV: number;
  totalRevenue: number;
  convertedLeads: number;
}

interface ConversionFeedback {
  leadId: string;
  converted: boolean;
  value: number;
}

const StrategyPanel = ({ campaigns, adSets, creatives, totalSpend, totalConversions, convertedLeadsCount, costPerConvertedLead }: StrategyPanelProps) => {
  const { toast } = useToast();
  const [ltvData, setLtvData] = useState<LTVData>({ averageLTV: 0, totalRevenue: 0, convertedLeads: 0 });
  const [newLTV, setNewLTV] = useState("");
  const [newLeadValue, setNewLeadValue] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState<number>(0);
  const [budgetInput, setBudgetInput] = useState("");

  // Calcular métricas gerais
  const avgCTR = campaigns.length > 0 
    ? campaigns.reduce((acc, c) => acc + c.ctr, 0) / campaigns.length 
    : 0;
  const avgCPC = campaigns.length > 0 
    ? campaigns.reduce((acc, c) => acc + c.cpc, 0) / campaigns.length 
    : 0;
  const avgConversion = campaigns.length > 0 
    ? campaigns.reduce((acc, c) => acc + c.conversionRate, 0) / campaigns.length 
    : 0;

  // Determinar fase de escala
  const getScalePhase = () => {
    if (totalSpend < 500) return { phase: "Teste", level: 1 };
    if (totalSpend < 2000) return { phase: "Validação", level: 2 };
    if (totalSpend < 10000) return { phase: "Escala Inicial", level: 3 };
    if (totalSpend < 50000) return { phase: "Escala Agressiva", level: 4 };
    return { phase: "Operação Madura", level: 5 };
  };

  const scalePhase = getScalePhase();

  // Calcular quantidade ideal de criativos baseado na fase
  const getCreativeRecommendations = () => {
    const currentCreatives = creatives.length;
    const winnersCount = creatives.filter(c => c.ctr > 2.0 && c.conversionRate > 3.0).length;
    
    const recommendations = {
      testingPhase: {
        minCreatives: 5,
        idealCreatives: 8,
        testingCycles: "2 por semana",
        budgetPerTest: "R$ 50-100"
      },
      validationPhase: {
        minCreatives: 8,
        idealCreatives: 15,
        testingCycles: "3-4 por semana",
        budgetPerTest: "R$ 100-200"
      },
      scalePhase: {
        minCreatives: 15,
        idealCreatives: 25,
        testingCycles: "5-10 por semana",
        budgetPerTest: "R$ 200-500"
      },
      maturePhase: {
        minCreatives: 25,
        idealCreatives: 50,
        testingCycles: "10-20 por semana",
        budgetPerTest: "R$ 500-1000"
      }
    };

    let current;
    if (scalePhase.level <= 1) current = recommendations.testingPhase;
    else if (scalePhase.level <= 2) current = recommendations.validationPhase;
    else if (scalePhase.level <= 3) current = recommendations.scalePhase;
    else current = recommendations.maturePhase;

    return {
      ...current,
      currentCreatives,
      winnersCount,
      deficit: Math.max(0, current.minCreatives - currentCreatives),
      winnerRatio: currentCreatives > 0 ? ((winnersCount / currentCreatives) * 100).toFixed(1) : 0
    };
  };

  const creativeRecs = getCreativeRecommendations();

  // Gerar estratégia de escala
  const generateScaleStrategy = () => {
    const strategies = [];

    // Estratégia baseada em performance
    if (avgCTR < 1.5) {
      strategies.push({
        priority: "CRÍTICO",
        area: "Criativos",
        action: "Pausar escala até melhorar CTR",
        details: "CTR abaixo de 1.5% indica problema nos criativos. Não escale antes de resolver.",
        steps: [
          "Teste 5 novos hooks nos primeiros 3 segundos",
          "Experimente formatos diferentes (UGC, carrossel, estático)",
          "Revise a promessa vs entrega do anúncio"
        ]
      });
    }

    if (avgConversion < 2.0) {
      strategies.push({
        priority: "CRÍTICO",
        area: "Funil",
        action: "Otimizar landing page antes de escalar",
        details: "Conversão baixa queima budget. Corrija o funil primeiro.",
        steps: [
          "Teste headline com benefício principal",
          "Reduza campos do formulário para 3-4",
          "Adicione prova social acima da dobra",
          "Garanta carregamento < 3 segundos"
        ]
      });
    }

    if (avgCTR > 2.0 && avgConversion > 2.5) {
      strategies.push({
        priority: "OPORTUNIDADE",
        area: "Escala Horizontal",
        action: "Expandir para novos públicos",
        details: "Métricas saudáveis. Hora de escalar horizontalmente.",
        steps: [
          "Criar Lookalike 1%, 2% e 3% dos compradores",
          "Testar interesses relacionados ao produto",
          "Expandir faixa etária em 5 anos",
          "Testar outras regiões geográficas"
        ]
      });
    }

    if (totalSpend > 1000 && winnersCount >= 2) {
      strategies.push({
        priority: "RECOMENDADO",
        area: "Escala Vertical",
        action: "Aumentar orçamento gradualmente",
        details: "Com criativos vencedores validados, aumente budget.",
        steps: [
          "Aumente 20-30% a cada 3 dias",
          "Monitore CPA por 48h após cada aumento",
          "Se CPA subir >20%, volte ao orçamento anterior",
          "Nunca dobre orçamento de uma vez"
        ]
      });
    }

    // Estratégias gerais sempre incluídas
    strategies.push({
      priority: "CONTÍNUO",
      area: "Testes A/B",
      action: "Manter pipeline de criativos",
      details: `Você precisa de ${creativeRecs.idealCreatives} criativos ativos. Tem ${creativeRecs.currentCreatives}.`,
      steps: [
        `Criar ${Math.max(3, creativeRecs.deficit)} novos criativos esta semana`,
        "Testar: 2 UGC, 2 estáticos, 2 vídeos editados",
        "Budget de teste: " + creativeRecs.budgetPerTest + " por criativo",
        "Promover vencedores após 500-1000 impressões"
      ]
    });

    return strategies;
  };

  const winnersCount = creatives.filter(c => c.ctr > 2.0 && c.conversionRate > 3.0).length;
  const strategies = generateScaleStrategy();

  // Feedback de conversões
  const handleAddLTV = () => {
    const value = parseFloat(newLTV);
    if (!isNaN(value) && value > 0) {
      setLtvData(prev => ({
        averageLTV: prev.convertedLeads > 0 
          ? (prev.totalRevenue + value) / (prev.convertedLeads + 1)
          : value,
        totalRevenue: prev.totalRevenue + value,
        convertedLeads: prev.convertedLeads + 1
      }));
      setNewLTV("");
    }
  };

  // Calcular ROAS real
  const realROAS = totalSpend > 0 && ltvData.totalRevenue > 0 
    ? (ltvData.totalRevenue / totalSpend).toFixed(2) 
    : "—";

  // Sugestões de feedback para Facebook
  const getFacebookFeedbackSuggestions = () => {
    const suggestions = [];
    
    if (ltvData.convertedLeads > 0) {
      suggestions.push({
        type: "CAPI",
        title: "Enviar eventos de conversão",
        description: "Informe ao Facebook quais leads converteram para otimizar a entrega.",
        action: "Configure eventos Purchase ou Lead com valor real"
      });
    }

    suggestions.push({
      type: "Públicos",
      title: "Criar público de compradores",
      description: "Upload lista de compradores para criar Lookalikes de alta qualidade.",
      action: "Exportar emails/telefones dos convertidos"
    });

    suggestions.push({
      type: "Exclusão",
      title: "Excluir leads frios",
      description: "Leads que não converteram após 30 dias devem ser excluídos.",
      action: "Criar público de exclusão no Gerenciador"
    });

    return suggestions;
  };

  // Gerar recomendações de investimento para cada item
  const getInvestmentRecommendation = (item: CampaignInsight) => {
    const cpaEstimate = item.conversions > 0 ? item.spend / item.conversions : item.spend;
    const targetCPA = ltvData.averageLTV > 0 ? ltvData.averageLTV * 0.3 : 50; // 30% do LTV ou R$50 padrão
    
    // Usar custo por lead convertido real se disponível
    const realCostPerLead = costPerConvertedLead || cpaEstimate;
    
    // Classificação de performance
    let status: 'scale' | 'maintain' | 'optimize' | 'pause' = 'maintain';
    let budgetAction: string;
    let budgetAmount: string;
    let reason: string;
    let urgency: 'high' | 'medium' | 'low' = 'medium';

    // NOVOS CRITÉRIOS: Verificar impressões e tempo mínimo antes de pausar
    const hasMinimumData = item.impressions >= ANALYSIS_CRITERIA.minImpressions;
    const hasMinimumSpend = item.spend >= ANALYSIS_CRITERIA.minSpendForDecision;

    // Regras de decisão baseadas em métricas
    if (item.ctr >= 2.0 && item.conversionRate >= 3.0 && item.cpc <= 2.0) {
      // Top performer - escalar
      status = 'scale';
      budgetAction = 'Aumentar investimento';
      budgetAmount = `+20-30% a cada 3 dias (de R$${item.spend.toFixed(0)} para R$${(item.spend * 1.25).toFixed(0)})`;
      reason = 'Performance excelente em todas as métricas. Escalar gradualmente.';
      urgency = 'high';
    } else if (item.ctr >= 1.5 && item.conversionRate >= 2.0) {
      // Bom performer - manter e otimizar
      status = 'maintain';
      budgetAction = 'Manter investimento';
      budgetAmount = `R$${item.spend.toFixed(0)} (atual)`;
      reason = 'Performance boa. Manter budget e monitorar por mais 48h.';
      urgency = 'low';
    } else if (item.impressions < ANALYSIS_CRITERIA.minImpressions) {
      // NOVO CRITÉRIO: Pouco dado - aguardar até atingir mínimo de impressões
      status = 'maintain';
      budgetAction = 'Aguardar dados';
      const impressionsNeeded = ANALYSIS_CRITERIA.minImpressions - item.impressions;
      budgetAmount = `Manter R$${item.spend.toFixed(0)} até ${ANALYSIS_CRITERIA.minImpressions.toLocaleString('pt-BR')}+ impressões`;
      reason = `Apenas ${item.impressions.toLocaleString('pt-BR')} impressões. Faltam ${impressionsNeeded.toLocaleString('pt-BR')} para análise confiável (mín. ${ANALYSIS_CRITERIA.minImpressions.toLocaleString('pt-BR')}).`;
      urgency = 'low';
    } else if (!hasMinimumData || !hasMinimumSpend) {
      // Dados insuficientes para decisão de pausar
      status = 'maintain';
      budgetAction = 'Continuar monitorando';
      budgetAmount = `R$${item.spend.toFixed(0)} (atual)`;
      reason = `Dados insuficientes. Aguarde mín. ${ANALYSIS_CRITERIA.minImpressions.toLocaleString('pt-BR')} impressões e R$${ANALYSIS_CRITERIA.minSpendForDecision} de gasto.`;
      urgency = 'low';
    } else if (item.ctr < 1.0 && hasMinimumData && hasMinimumSpend) {
      // CTR muito baixo COM dados suficientes - pausar
      status = 'pause';
      budgetAction = 'PAUSAR';
      budgetAmount = 'R$0 - Parar imediatamente';
      reason = `CTR de ${item.ctr.toFixed(2)}% muito baixo após ${item.impressions.toLocaleString('pt-BR')} impressões. Dados suficientes para decisão.`;
      urgency = 'high';
    } else if (item.conversionRate < 1.0 && hasMinimumData && hasMinimumSpend) {
      // Conversão muito baixa COM dados suficientes - pausar
      status = 'pause';
      budgetAction = 'PAUSAR';
      budgetAmount = 'R$0 - Parar imediatamente';
      reason = `Conversão de ${item.conversionRate.toFixed(2)}% muito baixa com ${item.impressions.toLocaleString('pt-BR')} impressões. Não está gerando resultados.`;
      urgency = 'high';
    } else if (item.ctr < 1.5 || item.conversionRate < 2.0) {
      // Performance abaixo - otimizar ou reduzir
      status = 'optimize';
      budgetAction = 'Reduzir ou otimizar';
      budgetAmount = `Reduzir 50% para R$${(item.spend * 0.5).toFixed(0)} e testar variações`;
      reason = 'Performance abaixo do ideal. Testar novas variações antes de escalar.';
      urgency = 'medium';
    }

    // Calcular limites de gasto recomendados
    const maxDailyBudget = targetCPA * 3; // 3x CPA alvo por dia
    const stopLossAmount = targetCPA * 2; // Parar após gastar 2x CPA sem conversão

    return {
      status,
      budgetAction,
      budgetAmount,
      reason,
      urgency,
      metrics: {
        cpaEstimate,
        targetCPA,
        maxDailyBudget,
        stopLossAmount,
        realCostPerLead,
      },
      criteria: {
        minImpressions: ANALYSIS_CRITERIA.minImpressions,
        currentImpressions: item.impressions,
        hasMinimumData,
        hasMinimumSpend,
      }
    };
  };

  // Agrupar todos os itens com recomendações
  const getAllInvestmentRecommendations = () => {
    const allItems = [
      ...campaigns.map(c => ({ ...c, category: 'Campanha' as const })),
      ...adSets.map(a => ({ ...a, category: 'Conjunto' as const })),
      ...creatives.map(cr => ({ ...cr, category: 'Criativo' as const }))
    ];

    return allItems.map(item => ({
      item,
      recommendation: getInvestmentRecommendation(item)
    })).sort((a, b) => {
      // Ordenar por urgência (pause primeiro, scale último)
      const order = { pause: 0, optimize: 1, maintain: 2, scale: 3 };
      return order[a.recommendation.status] - order[b.recommendation.status];
    });
  };

  const investmentRecs = getAllInvestmentRecommendations();

  const fbSuggestions = getFacebookFeedbackSuggestions();

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <CardTitle>Estrategista de Escala</CardTitle>
          </div>
          <Badge variant="outline" className="flex items-center gap-1">
            <Rocket className="h-3 w-3" />
            Fase: {scalePhase.phase}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Recomendações baseadas em como grandes operações escalam
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="budget" className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-4">
            <TabsTrigger value="budget" className="text-xs">
              <CircleDollarSign className="h-3 w-3 mr-1" />
              Investimento
            </TabsTrigger>
            <TabsTrigger value="creatives" className="text-xs">
              <Layers className="h-3 w-3 mr-1" />
              Criativos
            </TabsTrigger>
            <TabsTrigger value="scale" className="text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              Escala
            </TabsTrigger>
            <TabsTrigger value="ltv" className="text-xs">
              <DollarSign className="h-3 w-3 mr-1" />
              Faturamento
            </TabsTrigger>
            <TabsTrigger value="feedback" className="text-xs">
              <RefreshCcw className="h-3 w-3 mr-1" />
              Facebook
            </TabsTrigger>
          </TabsList>

          {/* Aba de Investimento - Recomendações de Investimento */}
          <TabsContent value="budget" className="space-y-4">
            {/* Explicação para leigos */}
            <Card className="bg-blue-50/50 dark:bg-blue-950/30 border-blue-500/30">
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-400">
                  <AlertCircle className="h-4 w-4" />
                  O que é esta aba?
                </h4>
                <p className="text-sm text-muted-foreground">
                  Aqui você vê <strong>quanto dinheiro investir</strong> em cada anúncio, campanha ou conjunto. 
                  O sistema analisa o desempenho de cada um e diz se você deve: 
                  <span className="text-red-600 font-medium"> pausar</span> (parar de gastar), 
                  <span className="text-yellow-600 font-medium"> otimizar</span> (ajustar), 
                  <span className="text-blue-600 font-medium"> manter</span> (deixar como está) ou 
                  <span className="text-green-600 font-medium"> escalar</span> (investir mais).
                </p>
              </CardContent>
            </Card>

            {/* Input de Orçamento Mensal */}
            <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30">
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <CircleDollarSign className="h-4 w-4 text-primary" />
                  Orçamento Mensal de Tráfego
                </h4>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <Label htmlFor="budget-input" className="text-sm mb-2 block">
                      Qual seu orçamento mensal para tráfego pago?
                    </Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                        <Input
                          id="budget-input"
                          type="number"
                          placeholder="5000"
                          value={budgetInput}
                          onChange={(e) => setBudgetInput(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <Button 
                        onClick={() => {
                          const value = parseFloat(budgetInput);
                          if (value > 0) setMonthlyBudget(value);
                        }}
                        disabled={!budgetInput}
                      >
                        Calcular Distribuição
                      </Button>
                    </div>
                  </div>
                  {monthlyBudget > 0 && (
                    <div className="sm:text-right">
                      <div className="text-sm text-muted-foreground">Orçamento definido</div>
                      <div className="text-2xl font-bold text-primary">
                        R$ {monthlyBudget.toLocaleString('pt-BR')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ≈ R$ {(monthlyBudget / 30).toFixed(0)}/dia
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Distribuição Sugerida de Budget */}
            {monthlyBudget > 0 && (
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Distribuição Sugerida do Orçamento
                  </h4>
                  
                  {(() => {
                    const scaleItems = investmentRecs.filter(r => r.recommendation.status === 'scale');
                    const maintainItems = investmentRecs.filter(r => r.recommendation.status === 'maintain');
                    const optimizeItems = investmentRecs.filter(r => r.recommendation.status === 'optimize');
                    
                    const totalScaleWeight = scaleItems.length * 3;
                    const totalMaintainWeight = maintainItems.length * 2;
                    const totalOptimizeWeight = optimizeItems.length * 1;
                    const totalWeight = totalScaleWeight + totalMaintainWeight + totalOptimizeWeight || 1;
                    
                    const scaleAllocation = (totalScaleWeight / totalWeight) * monthlyBudget * 0.7;
                    const maintainAllocation = (totalMaintainWeight / totalWeight) * monthlyBudget * 0.7;
                    const optimizeAllocation = (totalOptimizeWeight / totalWeight) * monthlyBudget * 0.7;
                    const testingReserve = monthlyBudget * 0.3;

                    return (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-lg bg-green-100 dark:bg-green-950/50">
                            <div className="text-xs text-green-700 dark:text-green-400">Para Escalar ({scaleItems.length} itens)</div>
                            <div className="text-lg font-bold text-green-600">R$ {scaleAllocation.toFixed(0)}</div>
                            <div className="text-xs text-muted-foreground">{scaleItems.length > 0 ? `≈ R$ ${(scaleAllocation / scaleItems.length).toFixed(0)}/cada` : '-'}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-950/50">
                            <div className="text-xs text-blue-700 dark:text-blue-400">Para Manter ({maintainItems.length} itens)</div>
                            <div className="text-lg font-bold text-blue-600">R$ {maintainAllocation.toFixed(0)}</div>
                            <div className="text-xs text-muted-foreground">{maintainItems.length > 0 ? `≈ R$ ${(maintainAllocation / maintainItems.length).toFixed(0)}/cada` : '-'}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-yellow-100 dark:bg-yellow-950/50">
                            <div className="text-xs text-yellow-700 dark:text-yellow-400">Para Otimizar ({optimizeItems.length} itens)</div>
                            <div className="text-lg font-bold text-yellow-600">R$ {optimizeAllocation.toFixed(0)}</div>
                            <div className="text-xs text-muted-foreground">{optimizeItems.length > 0 ? `≈ R$ ${(optimizeAllocation / optimizeItems.length).toFixed(0)}/cada` : '-'}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-950/50">
                            <div className="text-xs text-purple-700 dark:text-purple-400">Reserva p/ Testes</div>
                            <div className="text-lg font-bold text-purple-600">R$ {testingReserve.toFixed(0)}</div>
                            <div className="text-xs text-muted-foreground">30% do budget</div>
                          </div>
                        </div>

                        <div className="text-sm text-muted-foreground bg-background/50 p-3 rounded">
                          <strong>💡 Estratégia sugerida:</strong>
                          <ul className="mt-2 space-y-1 ml-4">
                            {scaleItems.length > 0 && (
                              <li>• Aloque R$ {(scaleAllocation / scaleItems.length).toFixed(0)}/mês para cada item que deve escalar</li>
                            )}
                            {maintainItems.length > 0 && (
                              <li>• Mantenha R$ {(maintainAllocation / maintainItems.length).toFixed(0)}/mês nos itens estáveis</li>
                            )}
                            {optimizeItems.length > 0 && (
                              <li>• Limite R$ {(optimizeAllocation / optimizeItems.length).toFixed(0)}/mês para itens em otimização</li>
                            )}
                            <li>• Use os R$ {testingReserve.toFixed(0)} de reserva para testar novos criativos ({(testingReserve / 100).toFixed(0)} testes de R$100)</li>
                          </ul>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-red-500/30 bg-red-50/30 dark:bg-red-950/20">
                <CardContent className="pt-4 text-center">
                  <Pause className="h-5 w-5 text-red-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-red-600">
                    {investmentRecs.filter(r => r.recommendation.status === 'pause').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Pausar</div>
                </CardContent>
              </Card>
              <Card className="border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/20">
                <CardContent className="pt-4 text-center">
                  <Scale className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-yellow-600">
                    {investmentRecs.filter(r => r.recommendation.status === 'optimize').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Otimizar</div>
                </CardContent>
              </Card>
              <Card className="border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/20">
                <CardContent className="pt-4 text-center">
                  <Target className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-blue-600">
                    {investmentRecs.filter(r => r.recommendation.status === 'maintain').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Manter</div>
                </CardContent>
              </Card>
              <Card className="border-green-500/30 bg-green-50/30 dark:bg-green-950/20">
                <CardContent className="pt-4 text-center">
                  <Rocket className="h-5 w-5 text-green-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-green-600">
                    {investmentRecs.filter(r => r.recommendation.status === 'scale').length}
                  </div>
                  <div className="text-xs text-muted-foreground">Escalar</div>
                </CardContent>
              </Card>
            </div>

            {/* Regras de Budget */}
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Regras de Investimento (Grandes Operações)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <strong>PAUSAR quando:</strong>
                    </div>
                    <ul className="ml-5 text-muted-foreground space-y-1">
                      <li>• CTR {"<"} 1% após 500+ impressões</li>
                      <li>• Conversão {"<"} 1% após R$200 gastos</li>
                      <li>• CPA {">"} 2x do CPA alvo</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <strong>ESCALAR quando:</strong>
                    </div>
                    <ul className="ml-5 text-muted-foreground space-y-1">
                      <li>• CTR {"≥"} 2% E Conversão {"≥"} 3%</li>
                      <li>• CPA {"≤"} 30% do LTV</li>
                      <li>• Após 48h de dados consistentes</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Lista de Recomendações */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Recomendações por Item</h4>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <HelpCircle className="h-3 w-3" />
                  Clique nos botões para executar a ação
                </div>
              </div>
              {investmentRecs.map(({ item, recommendation }, index) => (
                <Card 
                  key={index}
                  className={`${
                    recommendation.status === 'pause' ? 'border-red-500/50 bg-red-50/30 dark:bg-red-950/20' :
                    recommendation.status === 'optimize' ? 'border-yellow-500/50 bg-yellow-50/30 dark:bg-yellow-950/20' :
                    recommendation.status === 'scale' ? 'border-green-500/50 bg-green-50/30 dark:bg-green-950/20' :
                    'border-border'
                  }`}
                >
                  <CardContent className="pt-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {item.category === 'Campanha' ? '📢 Campanha' : 
                               item.category === 'Conjunto' ? '👥 Conjunto' : '🎨 Criativo'}
                            </Badge>
                            <Badge 
                              variant={
                                recommendation.status === 'pause' ? 'destructive' :
                                recommendation.status === 'scale' ? 'default' : 'secondary'
                              }
                              className="flex items-center gap-1"
                            >
                              {recommendation.status === 'pause' && <Pause className="h-3 w-3" />}
                              {recommendation.status === 'scale' && <TrendingUp className="h-3 w-3" />}
                              {recommendation.status === 'optimize' && <Scale className="h-3 w-3" />}
                              {recommendation.status === 'maintain' && <Target className="h-3 w-3" />}
                              {recommendation.status === 'pause' ? 'PAUSAR' :
                               recommendation.status === 'scale' ? 'ESCALAR' :
                               recommendation.status === 'optimize' ? 'OTIMIZAR' : 'MANTER'}
                            </Badge>
                            {recommendation.urgency === 'high' && (
                              <Badge variant="destructive" className="text-xs animate-pulse">⚠️ URGENTE</Badge>
                            )}
                          </div>
                          <h5 className="font-medium">{item.name}</h5>
                          <p className="text-sm text-muted-foreground mt-1">{recommendation.reason}</p>
                          
                          <div className="mt-3 p-2 bg-background/50 rounded text-sm">
                            <strong>💡 O que fazer:</strong> {recommendation.budgetAmount}
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
                            <div className="text-center p-2 bg-background/30 rounded">
                              <div className="text-muted-foreground">CTR</div>
                              <div className="text-xs text-muted-foreground">(% que clicou)</div>
                              <div className={`font-medium ${item.ctr >= 2 ? 'text-green-600' : item.ctr >= 1.5 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {item.ctr.toFixed(2)}%
                              </div>
                            </div>
                            <div className="text-center p-2 bg-background/30 rounded">
                              <div className="text-muted-foreground">Conv.</div>
                              <div className="text-xs text-muted-foreground">(% que virou lead)</div>
                              <div className={`font-medium ${item.conversionRate >= 3 ? 'text-green-600' : item.conversionRate >= 2 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {item.conversionRate.toFixed(2)}%
                              </div>
                            </div>
                            <div className="text-center p-2 bg-background/30 rounded">
                              <div className="text-muted-foreground">Gasto</div>
                              <div className="text-xs text-muted-foreground">(investido)</div>
                              <div className="font-medium">R${item.spend.toFixed(0)}</div>
                            </div>
                            <div className="text-center p-2 bg-background/30 rounded">
                              <div className="text-muted-foreground">CPA</div>
                              <div className="text-xs text-muted-foreground">(custo/lead)</div>
                              <div className="font-medium">
                                R${recommendation.metrics.cpaEstimate.toFixed(0)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Botões de Ação */}
                      <div className="flex gap-2 pt-2 border-t border-border/50">
                        {recommendation.status === 'pause' && (
                          <Button 
                            size="sm" 
                            variant="destructive"
                            className="flex-1"
                            onClick={() => {
                              window.open(`https://business.facebook.com/adsmanager/manage/ads?act=${item.id}`, '_blank');
                              toast({
                                title: "📋 Ação: PAUSAR",
                                description: `Abra o Gerenciador de Anúncios e pause "${item.name}". Economize seu dinheiro!`,
                              });
                            }}
                          >
                            <Pause className="h-4 w-4 mr-2" />
                            Pausar Agora
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Button>
                        )}
                        {recommendation.status === 'scale' && (
                          <Button 
                            size="sm" 
                            className="flex-1 bg-green-600 hover:bg-green-700"
                            onClick={() => {
                              window.open(`https://business.facebook.com/adsmanager/manage/ads?act=${item.id}`, '_blank');
                              toast({
                                title: "🚀 Ação: ESCALAR",
                                description: `Abra o Gerenciador de Anúncios e aumente o orçamento de "${item.name}" em 20-30%`,
                              });
                            }}
                          >
                            <TrendingUp className="h-4 w-4 mr-2" />
                            Aumentar Investimento
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Button>
                        )}
                        {recommendation.status === 'optimize' && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="flex-1 border-yellow-500 text-yellow-700 hover:bg-yellow-50"
                            onClick={() => {
                              window.open(`https://business.facebook.com/adsmanager/manage/ads?act=${item.id}`, '_blank');
                              toast({
                                title: "⚙️ Ação: OTIMIZAR",
                                description: `Teste novos públicos ou criativos para "${item.name}"`,
                              });
                            }}
                          >
                            <Scale className="h-4 w-4 mr-2" />
                            Otimizar
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Button>
                        )}
                        {recommendation.status === 'maintain' && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="flex-1"
                            onClick={() => {
                              toast({
                                title: "✅ Tudo certo!",
                                description: `"${item.name}" está performando bem. Continue monitorando.`,
                              });
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Manter como está
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Stop Loss - Explicação para leigos */}
            <Card className="bg-red-50/50 dark:bg-red-950/30 border-red-500/30">
              <CardContent className="pt-4">
                <h4 className="font-semibold flex items-center gap-2 mb-2 text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  🛑 Quando PARAR de Gastar (Stop Loss)
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Stop Loss = limite de prejuízo. É como um alarme que avisa quando você deve parar de investir para não perder mais dinheiro.
                </p>
                <div className="space-y-3 text-sm">
                  <div className="p-2 bg-background/50 rounded">
                    <div className="flex items-start gap-2">
                      <TrendingDown className="h-4 w-4 text-red-500 mt-0.5" />
                      <div>
                        <strong>🎨 Criativo (anúncio):</strong>
                        <p className="text-muted-foreground text-xs mt-1">
                          Se gastou R${ltvData.averageLTV > 0 ? (ltvData.averageLTV * 0.6).toFixed(0) : '100'} e não teve nenhum lead → PAUSE. 
                          O anúncio não está funcionando.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="p-2 bg-background/50 rounded">
                    <div className="flex items-start gap-2">
                      <TrendingDown className="h-4 w-4 text-red-500 mt-0.5" />
                      <div>
                        <strong>👥 Conjunto (público):</strong>
                        <p className="text-muted-foreground text-xs mt-1">
                          Se o custo por lead subiu mais de 50% por 2 dias seguidos → PAUSE. 
                          O público está saturado.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="p-2 bg-background/50 rounded">
                    <div className="flex items-start gap-2">
                      <TrendingDown className="h-4 w-4 text-red-500 mt-0.5" />
                      <div>
                        <strong>📢 Campanha:</strong>
                        <p className="text-muted-foreground text-xs mt-1">
                          Se está gastando mais do que está faturando (ROAS {"<"} 1) → REDUZA 50% do investimento. 
                          Você está perdendo dinheiro.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba de Criativos */}
          <TabsContent value="creatives" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-primary/20">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Criativos Ativos</span>
                    <Badge variant={creativeRecs.currentCreatives >= creativeRecs.minCreatives ? "default" : "destructive"}>
                      {creativeRecs.currentCreatives} / {creativeRecs.idealCreatives}
                    </Badge>
                  </div>
                  <div className="text-2xl font-bold">{creativeRecs.currentCreatives}</div>
                  {creativeRecs.deficit > 0 && (
                    <p className="text-xs text-destructive mt-1">
                      Faltam {creativeRecs.deficit} criativos para o mínimo
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-green-500/20">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Vencedores</span>
                    <Sparkles className="h-4 w-4 text-green-500" />
                  </div>
                  <div className="text-2xl font-bold text-green-600">{winnersCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Taxa: {creativeRecs.winnerRatio}% (meta: 20%+)
                  </p>
                </CardContent>
              </Card>

              <Card className="border-blue-500/20">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Budget/Teste</span>
                    <Zap className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="text-lg font-bold">{creativeRecs.budgetPerTest}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ciclos: {creativeRecs.testingCycles}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-semibold flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-primary" />
                  Framework de Testes (Grandes Operações)
                </h4>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <strong>Regra 3-2-2:</strong> 3 variações de hook, 2 de copy, 2 de CTA
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <strong>Teste por 48-72h</strong> antes de decidir vencedor
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <strong>Mínimo 500 impressões</strong> por criativo para dados significativos
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <strong>70% budget em vencedores,</strong> 30% em testes
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <div>
                      <strong>Itere sobre vencedores:</strong> não reinvente, melhore o que funciona
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3">📋 Checklist Semanal</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Criar {Math.max(3, creativeRecs.deficit)} novos criativos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Pausar criativos com CTR {"<"} 1%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Duplicar vencedores em novos conjuntos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Testar 1 novo formato (UGC, carrossel, etc)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba de Escala */}
          <TabsContent value="scale" className="space-y-4">
            {strategies.map((strategy, index) => (
              <Card 
                key={index} 
                className={`${
                  strategy.priority === "CRÍTICO" ? "border-red-500/50 bg-red-50/50 dark:bg-red-950/20" :
                  strategy.priority === "OPORTUNIDADE" ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20" :
                  "border-border"
                }`}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={
                        strategy.priority === "CRÍTICO" ? "destructive" :
                        strategy.priority === "OPORTUNIDADE" ? "default" : "secondary"
                      }>
                        {strategy.priority}
                      </Badge>
                      <span className="font-semibold">{strategy.area}</span>
                    </div>
                    {strategy.priority === "CRÍTICO" && <AlertTriangle className="h-5 w-5 text-red-500" />}
                    {strategy.priority === "OPORTUNIDADE" && <TrendingUp className="h-5 w-5 text-green-500" />}
                  </div>
                  <h4 className="font-medium text-lg mb-2">{strategy.action}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{strategy.details}</p>
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Passos:</span>
                    {strategy.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <ArrowRight className="h-4 w-4 text-primary mt-0.5" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-semibold flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Regras de Ouro para Escala (Meta Ads)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong className="text-primary">Escala Vertical:</strong>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      <li>• Aumente 20-30% a cada 3-4 dias</li>
                      <li>• Nunca dobre de uma vez</li>
                      <li>• Monitore CPA por 48h após aumento</li>
                    </ul>
                  </div>
                  <div>
                    <strong className="text-primary">Escala Horizontal:</strong>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      <li>• Duplique para novos públicos</li>
                      <li>• Teste Lookalikes 1%, 2%, 3%</li>
                      <li>• Expanda geo gradualmente</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba de LTV */}
          <TabsContent value="ltv" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">Gasto Total</div>
                  <div className="text-2xl font-bold">R$ {totalSpend.toFixed(0)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">Leads Convertidos</div>
                  <div className="text-2xl font-bold text-green-600">{ltvData.convertedLeads}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">Receita Total</div>
                  <div className="text-2xl font-bold text-primary">R$ {ltvData.totalRevenue.toFixed(0)}</div>
                </CardContent>
              </Card>
              <Card className={`${parseFloat(realROAS) >= 2 ? "border-green-500/50" : parseFloat(realROAS) >= 1 ? "border-yellow-500/50" : "border-red-500/50"}`}>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">ROAS Real</div>
                  <div className={`text-2xl font-bold ${
                    parseFloat(realROAS) >= 2 ? "text-green-600" : 
                    parseFloat(realROAS) >= 1 ? "text-yellow-600" : "text-red-600"
                  }`}>
                    {realROAS}x
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <PlusCircle className="h-4 w-4 text-primary" />
                  Registrar Conversão (LTV)
                </h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Informe o valor de cada venda para calcular o ROAS real e otimizar recomendações
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="ltv-value" className="text-xs">Valor da Venda (R$)</Label>
                    <Input
                      id="ltv-value"
                      type="number"
                      placeholder="Ex: 297"
                      value={newLTV}
                      onChange={(e) => setNewLTV(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleAddLTV}>
                      <PlusCircle className="h-4 w-4 mr-1" />
                      Adicionar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {ltvData.convertedLeads > 0 && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-4">
                  <h4 className="font-semibold mb-3">📊 Análise de LTV</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>LTV Médio:</span>
                      <strong>R$ {ltvData.averageLTV.toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>CAC (Custo por Aquisição):</span>
                      <strong>R$ {ltvData.convertedLeads > 0 ? (totalSpend / ltvData.convertedLeads).toFixed(2) : "—"}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>LTV/CAC Ratio:</span>
                      <strong className={`${
                        ltvData.averageLTV / (totalSpend / ltvData.convertedLeads) >= 3 ? "text-green-600" : "text-yellow-600"
                      }`}>
                        {ltvData.convertedLeads > 0 ? (ltvData.averageLTV / (totalSpend / ltvData.convertedLeads)).toFixed(2) : "—"}x
                      </strong>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Meta: LTV/CAC {"≥"} 3x para operação saudável
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Aba de Feedback Facebook */}
          <TabsContent value="feedback" className="space-y-4">
            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-500/30">
              <CardContent className="pt-4">
                <h4 className="font-semibold flex items-center gap-2 mb-3">
                  <RefreshCcw className="h-4 w-4 text-blue-500" />
                  Por que informar conversões ao Facebook?
                </h4>
                <p className="text-sm text-muted-foreground">
                  O algoritmo do Meta otimiza para quem <strong>parece</strong> converter. 
                  Quando você informa quais leads realmente compraram, ele aprende a encontrar 
                  pessoas similares, melhorando drasticamente a qualidade dos leads.
                </p>
              </CardContent>
            </Card>

            {fbSuggestions.map((suggestion, index) => (
              <Card key={index}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <Badge variant="outline" className="mb-2">{suggestion.type}</Badge>
                      <h5 className="font-medium">{suggestion.title}</h5>
                      <p className="text-sm text-muted-foreground mt-1">{suggestion.description}</p>
                      <div className="mt-2 p-2 bg-muted rounded text-xs">
                        <strong>Ação:</strong> {suggestion.action}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3">📋 Checklist de Feedback</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Configurar Conversions API (CAPI) no servidor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Enviar eventos de Purchase com valor real</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Criar público customizado de compradores</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Gerar Lookalike 1% dos compradores</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border rounded" />
                    <span>Excluir leads não-convertidos após 30 dias</span>
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

export default StrategyPanel;

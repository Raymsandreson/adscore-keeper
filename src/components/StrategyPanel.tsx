import { useState } from "react";
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
  Rocket,
  Layers,
  RefreshCcw,
  PlusCircle,
  ArrowRight,
  Sparkles
} from "lucide-react";
import { CampaignInsight } from "@/services/metaAPI";

interface StrategyPanelProps {
  campaigns: CampaignInsight[];
  adSets: CampaignInsight[];
  creatives: CampaignInsight[];
  totalSpend: number;
  totalConversions: number;
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

const StrategyPanel = ({ campaigns, adSets, creatives, totalSpend, totalConversions }: StrategyPanelProps) => {
  const [ltvData, setLtvData] = useState<LTVData>({ averageLTV: 0, totalRevenue: 0, convertedLeads: 0 });
  const [newLTV, setNewLTV] = useState("");
  const [newLeadValue, setNewLeadValue] = useState("");

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

  const strategies = generateScaleStrategy();
  const winnersCount = creatives.filter(c => c.ctr > 2.0 && c.conversionRate > 3.0).length;

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
        <Tabs defaultValue="creatives" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
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
              LTV/ROAS
            </TabsTrigger>
            <TabsTrigger value="feedback" className="text-xs">
              <RefreshCcw className="h-3 w-3 mr-1" />
              Feedback FB
            </TabsTrigger>
          </TabsList>

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

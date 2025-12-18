import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  MousePointerClick,
  FileText,
  MessageCircle,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Calculator,
  RefreshCcw
} from 'lucide-react';
import { useAnalysisCriteria, AbandonmentData } from '@/hooks/useAnalysisCriteria';
import { toast } from 'sonner';

interface AbandonmentTrackerProps {
  totalClicks?: number; // Cliques do Meta Ads
  totalSpend?: number;
}

const STORAGE_KEY = 'abandonment_tracking_data';

const AbandonmentTracker = ({ totalClicks = 0, totalSpend = 0 }: AbandonmentTrackerProps) => {
  const { criteria, calculateAbandonmentRates, estimateActualLeads } = useAnalysisCriteria();
  
  const [data, setData] = useState<AbandonmentData>({
    totalClicks: totalClicks,
    formStarts: 0,
    formCompletions: 0,
    whatsappClicks: 0,
    whatsappMessagesReceived: 0,
    period: 'last_7d',
  });

  // Carregar dados salvos
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setData(prev => ({ ...prev, ...JSON.parse(stored) }));
      }
    } catch (e) {
      console.error('Error loading abandonment data:', e);
    }
  }, []);

  // Atualizar totalClicks quando vier do Meta
  useEffect(() => {
    if (totalClicks > 0) {
      setData(prev => ({ ...prev, totalClicks }));
    }
  }, [totalClicks]);

  const handleChange = (field: keyof AbandonmentData, value: number) => {
    const updated = { ...data, [field]: value };
    setData(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleReset = () => {
    const reset: AbandonmentData = {
      totalClicks: 0,
      formStarts: 0,
      formCompletions: 0,
      whatsappClicks: 0,
      whatsappMessagesReceived: 0,
      period: 'last_7d',
    };
    setData(reset);
    localStorage.removeItem(STORAGE_KEY);
    toast.info('Dados de abandono resetados');
  };

  const rates = calculateAbandonmentRates(data);
  
  // Estimativas baseadas nos cliques do Meta
  const estimatedFormLeads = estimateActualLeads(data.totalClicks, false);
  const estimatedWhatsAppLeads = estimateActualLeads(data.totalClicks, true);
  
  // Calcular CPL estimado
  const estimatedCPL = data.totalClicks > 0 && totalSpend > 0
    ? totalSpend / ((data.formCompletions + data.whatsappMessagesReceived) || estimatedFormLeads || 1)
    : 0;

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'good': return 'text-green-500';
      case 'warning': return 'text-yellow-500';
      case 'bad': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  };

  const getPerformanceBadge = (performance: string) => {
    switch (performance) {
      case 'good': return <Badge className="bg-green-500">Bom</Badge>;
      case 'warning': return <Badge className="bg-yellow-500">Atenção</Badge>;
      case 'bad': return <Badge variant="destructive">Problema</Badge>;
      default: return null;
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <MousePointerClick className="h-5 w-5 text-primary" />
              Taxas de Abandono do Funil
            </h3>
            <p className="text-sm text-muted-foreground">
              Rastreie quantos cliques viram leads reais
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RefreshCcw className="h-4 w-4 mr-1" />
            Resetar
          </Button>
        </div>

        {/* Input de Dados */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Dados do Funil
              <Tooltip>
                <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Insira os números do seu funil para calcular taxas de abandono. 
                  Você pode pegar esses dados do Meta Ads e do seu sistema de atendimento.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalClicks" className="text-xs">Total de Cliques</Label>
                <Input
                  id="totalClicks"
                  type="number"
                  value={data.totalClicks}
                  onChange={(e) => handleChange('totalClicks', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="formStarts" className="text-xs">Iniciaram Form</Label>
                <Input
                  id="formStarts"
                  type="number"
                  value={data.formStarts}
                  onChange={(e) => handleChange('formStarts', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="formCompletions" className="text-xs">Completaram Form</Label>
                <Input
                  id="formCompletions"
                  type="number"
                  value={data.formCompletions}
                  onChange={(e) => handleChange('formCompletions', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappClicks" className="text-xs">Cliques WhatsApp</Label>
                <Input
                  id="whatsappClicks"
                  type="number"
                  value={data.whatsappClicks}
                  onChange={(e) => handleChange('whatsappClicks', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappMessagesReceived" className="text-xs">Mensagens Recebidas</Label>
                <Input
                  id="whatsappMessagesReceived"
                  type="number"
                  value={data.whatsappMessagesReceived}
                  onChange={(e) => handleChange('whatsappMessagesReceived', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resultados */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Formulários */}
          <Card className={`border-2 ${rates.formPerformance === 'bad' ? 'border-red-500/50' : rates.formPerformance === 'warning' ? 'border-yellow-500/50' : 'border-green-500/50'}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Formulários
                </span>
                {getPerformanceBadge(rates.formPerformance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Taxa de Conclusão</span>
                  <span className={`font-bold ${getPerformanceColor(rates.formPerformance)}`}>
                    {rates.formCompletionRate.toFixed(1)}%
                  </span>
                </div>
                <Progress 
                  value={rates.formCompletionRate} 
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Meta: {criteria.targetFormCompletionRate}%</span>
                  <span>{data.formCompletions} de {data.formStarts} completaram</span>
                </div>
              </div>

              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-sm">Taxa de Abandono</span>
                </div>
                <div className="text-2xl font-bold text-red-500">
                  {rates.formAbandonmentRate.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.formStarts - data.formCompletions} pessoas abandonaram o formulário
                </p>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <Card className={`border-2 ${rates.whatsappPerformance === 'bad' ? 'border-red-500/50' : rates.whatsappPerformance === 'warning' ? 'border-yellow-500/50' : 'border-green-500/50'}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </span>
                {getPerformanceBadge(rates.whatsappPerformance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Taxa de Resposta</span>
                  <span className={`font-bold ${getPerformanceColor(rates.whatsappPerformance)}`}>
                    {rates.whatsappResponseRate.toFixed(1)}%
                  </span>
                </div>
                <Progress 
                  value={rates.whatsappResponseRate} 
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Meta: {criteria.targetWhatsAppResponseRate}%</span>
                  <span>{data.whatsappMessagesReceived} de {data.whatsappClicks} responderam</span>
                </div>
              </div>

              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-sm">Taxa de Abandono</span>
                </div>
                <div className="text-2xl font-bold text-red-500">
                  {rates.whatsappAbandonmentRate.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.whatsappClicks - data.whatsappMessagesReceived} pessoas clicaram mas não enviaram mensagem
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Resumo e Recomendações */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resumo do Funil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Cliques Totais</div>
                <div className="text-xl font-bold">{data.totalClicks}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Leads Gerados</div>
                <div className="text-xl font-bold text-green-500">
                  {data.formCompletions + data.whatsappMessagesReceived}
                </div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Clique → Lead</div>
                <div className="text-xl font-bold text-primary">
                  {rates.overallClickToLeadRate.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">CPL Estimado</div>
                <div className="text-xl font-bold text-primary">
                  R$ {estimatedCPL.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Recomendações */}
            {rates.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Recomendações:</h4>
                <div className="space-y-2">
                  {rates.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-muted/30 rounded-lg text-sm">
                      {rates.formPerformance === 'good' && rates.whatsappPerformance === 'good' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                      )}
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Estimativas baseadas no benchmark */}
            <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
              <h4 className="font-medium text-sm text-blue-700 dark:text-blue-400 mb-2">
                💡 Estimativa baseada nos seus critérios
              </h4>
              <p className="text-sm text-muted-foreground">
                Com <strong>{data.totalClicks} cliques</strong> e suas taxas de abandono configuradas:
              </p>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <span className="text-xs text-muted-foreground">Via Formulário:</span>
                  <span className="font-bold text-primary ml-2">~{estimatedFormLeads} leads</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Via WhatsApp:</span>
                  <span className="font-bold text-primary ml-2">~{estimatedWhatsAppLeads} leads</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
};

export default AbandonmentTracker;

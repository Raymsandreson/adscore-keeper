import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Settings, 
  RotateCcw, 
  Save, 
  HelpCircle,
  Eye,
  TrendingDown,
  Users,
  Clock,
  Target,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { useAnalysisCriteria, AnalysisCriteria } from '@/hooks/useAnalysisCriteria';
import { toast } from 'sonner';

interface AnalysisCriteriaSettingsProps {
  currentDailyLeads?: number;
}

const AnalysisCriteriaSettings = ({ currentDailyLeads = 0 }: AnalysisCriteriaSettingsProps) => {
  const { criteria, saveCriteria, resetToDefaults, checkTeamCapacity, getMaxDailyLeads, DEFAULT_CRITERIA } = useAnalysisCriteria();
  const [editedCriteria, setEditedCriteria] = useState<AnalysisCriteria>(criteria);
  const [hasChanges, setHasChanges] = useState(false);

  // Sincronizar editedCriteria quando criteria carrega do localStorage
  useEffect(() => {
    setEditedCriteria(criteria);
  }, [criteria]);

  const handleChange = (field: keyof AnalysisCriteria, value: string, isFloat: boolean = false) => {
    // Permitir campo vazio durante edição
    if (value === '') {
      setEditedCriteria(prev => ({ ...prev, [field]: 0 }));
      setHasChanges(true);
      return;
    }
    
    // Validar entrada numérica
    const numValue = isFloat ? parseFloat(value) : parseInt(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setEditedCriteria(prev => ({ ...prev, [field]: numValue }));
      setHasChanges(true);
    }
  };

  const handleSave = () => {
    saveCriteria(editedCriteria);
    setHasChanges(false);
    toast.success('Critérios salvos com sucesso!');
  };

  const handleReset = () => {
    setEditedCriteria(DEFAULT_CRITERIA);
    resetToDefaults();
    setHasChanges(false);
    toast.info('Critérios restaurados para o padrão');
  };

  const teamCapacity = checkTeamCapacity(currentDailyLeads);
  const savedMaxDailyLeads = getMaxDailyLeads();
  
  // Calcular capacidade com valores editados (não salvos) para preview em tempo real
  const editedMaxDailyLeads = Math.floor((8 * 60) / editedCriteria.avgLeadHandlingTime) * editedCriteria.teamSize;

  const getCapacityColor = (status: string) => {
    switch (status) {
      case 'overloaded': return 'text-red-500';
      case 'high': return 'text-yellow-500';
      case 'healthy': return 'text-green-500';
      case 'underutilized': return 'text-blue-500';
      default: return 'text-muted-foreground';
    }
  };

  const getCapacityBadge = (status: string) => {
    switch (status) {
      case 'overloaded': return <Badge variant="destructive">Sobrecarregado</Badge>;
      case 'high': return <Badge className="bg-yellow-500">Alto</Badge>;
      case 'healthy': return <Badge className="bg-green-500">Saudável</Badge>;
      case 'underutilized': return <Badge variant="secondary">Subutilizado</Badge>;
      default: return null;
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Critérios de Análise</h3>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Restaurar Padrão
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
              <Save className="h-4 w-4 mr-1" />
              Salvar
            </Button>
          </div>
        </div>

        {/* Team Capacity Status */}
        <Card className={`border-2 ${teamCapacity.status === 'overloaded' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : 'border-border'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Capacidade da Equipe Comercial
              {getCapacityBadge(teamCapacity.status)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Leads hoje: {currentDailyLeads}</span>
              <span className="text-sm text-muted-foreground">Capacidade máx: {savedMaxDailyLeads}/dia</span>
            </div>
            
            {/* Progress bar */}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                  teamCapacity.status === 'overloaded' ? 'bg-red-500' :
                  teamCapacity.status === 'high' ? 'bg-yellow-500' :
                  teamCapacity.status === 'healthy' ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.min(teamCapacity.usagePercent, 100)}%` }}
              />
            </div>
            
            <div className="flex items-start gap-2 text-sm">
              {teamCapacity.status === 'overloaded' ? (
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
              )}
              <div>
                <p className={getCapacityColor(teamCapacity.status)}>{teamCapacity.message}</p>
                <p className="text-muted-foreground">{teamCapacity.recommendation}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Critérios Mínimos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Critérios Mínimos para Análise
              </CardTitle>
              <CardDescription>
                Dados mínimos necessários antes de recomendar pausar uma campanha
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="minImpressions">Impressões Mínimas</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Número mínimo de impressões antes de considerar pausar. Mais impressões = decisão mais confiável.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="minImpressions"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.minImpressions || ''}
                  onChange={(e) => handleChange('minImpressions', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="minDaysActive">Dias Mínimos Ativo</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Tempo mínimo que a campanha deve rodar antes de avaliar. O algoritmo do Meta precisa de tempo para otimizar.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="minDaysActive"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.minDaysActive || ''}
                  onChange={(e) => handleChange('minDaysActive', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="minSpendForDecision">Gasto Mínimo (R$)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Gasto mínimo antes de tomar decisão de pausar. Evita decisões precipitadas.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="minSpendForDecision"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.minSpendForDecision || ''}
                  onChange={(e) => handleChange('minSpendForDecision', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Limiares de Performance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                Limiares de Performance
              </CardTitle>
              <CardDescription>
                Métricas abaixo desses valores indicam problemas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="minCTR">CTR Mínimo (%)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Taxa de cliques mínima aceitável. Abaixo disso, os criativos precisam de ajuste.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="minCTR"
                  type="text"
                  inputMode="decimal"
                  value={editedCriteria.minCTR || ''}
                  onChange={(e) => handleChange('minCTR', e.target.value, true)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="minConversionRate">Conversão Mínima (%)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Taxa de conversão mínima. Abaixo disso, o funil ou público precisam de ajuste.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="minConversionRate"
                  type="text"
                  inputMode="decimal"
                  value={editedCriteria.minConversionRate || ''}
                  onChange={(e) => handleChange('minConversionRate', e.target.value, true)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="maxCPC">CPC Máximo (R$)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Custo por clique máximo aceitável. Acima disso, a campanha está cara demais.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxCPC"
                  type="text"
                  inputMode="decimal"
                  value={editedCriteria.maxCPC || ''}
                  onChange={(e) => handleChange('maxCPC', e.target.value, true)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Detecção de Saturação */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Detecção de Saturação
              </CardTitle>
              <CardDescription>
                Identifica quando um público/criativo parou de performar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="saturationDropThreshold">Queda para Saturação (%)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Percentual de queda nas métricas para considerar que o público saturou. Ex: 30% significa que se o CTR cair 30%, é sinal de saturação.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="saturationDropThreshold"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.saturationDropThreshold || ''}
                  onChange={(e) => handleChange('saturationDropThreshold', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="saturationPeriodDays">Período de Comparação (dias)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Compara performance atual com X dias atrás para detectar queda.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="saturationPeriodDays"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.saturationPeriodDays || ''}
                  onChange={(e) => handleChange('saturationPeriodDays', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Capacidade da Equipe */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Capacidade de Atendimento
              </CardTitle>
              <CardDescription>
                Configure a capacidade da equipe comercial para atender leads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="teamSize">Tamanho da Equipe</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Número de pessoas na equipe comercial que atendem leads.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="teamSize"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.teamSize || ''}
                  onChange={(e) => handleChange('teamSize', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="avgLeadHandlingTime">Tempo Médio por Lead (min)</Label>
                  <Tooltip>
                    <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Tempo médio que um vendedor leva para atender um lead (contato inicial + follow-up).
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="avgLeadHandlingTime"
                  type="text"
                  inputMode="numeric"
                  value={editedCriteria.avgLeadHandlingTime || ''}
                  onChange={(e) => handleChange('avgLeadHandlingTime', e.target.value)}
                />
              </div>

              <Separator />

              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium">Capacidade Calculada</div>
                <div className="text-2xl font-bold text-primary">{editedMaxDailyLeads} leads/dia</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Com {editedCriteria.teamSize} pessoa(s) e {editedCriteria.avgLeadHandlingTime} min por lead
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Taxas de Abandono */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Taxas de Abandono do Funil
              </CardTitle>
              <CardDescription>
                Configure as metas e taxas esperadas de abandono em formulários e WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Formulários */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    📋 Formulários de Lead
                  </h4>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="expectedFormAbandonmentRate">Taxa de Abandono Esperada (%)</Label>
                      <Tooltip>
                        <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Benchmark: 70% dos usuários abandonam formulários antes de completar. Use para estimar leads reais.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="expectedFormAbandonmentRate"
                      type="text"
                      inputMode="numeric"
                      value={editedCriteria.expectedFormAbandonmentRate || ''}
                      onChange={(e) => handleChange('expectedFormAbandonmentRate', e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="targetFormCompletionRate">Meta de Conclusão (%)</Label>
                      <Tooltip>
                        <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Sua meta de taxa de conclusão de formulário. Acima de 40% é excelente.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="targetFormCompletionRate"
                      type="text"
                      inputMode="numeric"
                      value={editedCriteria.targetFormCompletionRate || ''}
                      onChange={(e) => handleChange('targetFormCompletionRate', e.target.value)}
                    />
                  </div>

                  <div className="p-3 bg-muted/30 rounded-lg text-sm">
                    <p className="text-muted-foreground">
                      Estimativa: de cada <strong>100 cliques</strong>, espere 
                      <strong className="text-primary"> ~{100 - editedCriteria.expectedFormAbandonmentRate} leads</strong>
                    </p>
                  </div>
                </div>

                {/* WhatsApp */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    💬 WhatsApp
                  </h4>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="expectedWhatsAppAbandonmentRate">Taxa de Abandono Esperada (%)</Label>
                      <Tooltip>
                        <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Percentual de pessoas que clicam no WhatsApp mas não enviam mensagem. Benchmark: 30-50%.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="expectedWhatsAppAbandonmentRate"
                      type="text"
                      inputMode="numeric"
                      value={editedCriteria.expectedWhatsAppAbandonmentRate || ''}
                      onChange={(e) => handleChange('expectedWhatsAppAbandonmentRate', e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="targetWhatsAppResponseRate">Meta de Resposta (%)</Label>
                      <Tooltip>
                        <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Sua meta de taxa de resposta no WhatsApp. Acima de 70% é excelente.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="targetWhatsAppResponseRate"
                      type="text"
                      inputMode="numeric"
                      value={editedCriteria.targetWhatsAppResponseRate || ''}
                      onChange={(e) => handleChange('targetWhatsAppResponseRate', e.target.value)}
                    />
                  </div>

                  <div className="p-3 bg-muted/30 rounded-lg text-sm">
                    <p className="text-muted-foreground">
                      Estimativa: de cada <strong>100 cliques</strong>, espere 
                      <strong className="text-primary"> ~{100 - editedCriteria.expectedWhatsAppAbandonmentRate} mensagens</strong>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default AnalysisCriteriaSettings;

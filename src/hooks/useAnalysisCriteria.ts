import { useState, useEffect, useCallback } from 'react';

export interface AnalysisCriteria {
  // Critérios mínimos para análise
  minImpressions: number;
  minDaysActive: number;
  minSpendForDecision: number;
  
  // Limiares de performance
  minCTR: number;
  minConversionRate: number;
  maxCPC: number;
  
  // Detecção de saturação
  saturationDropThreshold: number; // % de queda para considerar saturado
  saturationPeriodDays: number; // Período para comparar (ex: 7 dias)
  
  // Capacidade da equipe comercial
  teamDailyLeadCapacity: number; // Quantos leads a equipe consegue atender por dia
  teamSize: number; // Tamanho da equipe
  avgLeadHandlingTime: number; // Tempo médio para atender um lead (minutos)
  workHoursPerDay: number; // Horas de trabalho por dia

  // Taxas de abandono do funil
  expectedFormAbandonmentRate: number; // % esperado de abandono no formulário
  expectedWhatsAppAbandonmentRate: number; // % esperado de abandono no WhatsApp (clica mas não envia msg)
  targetFormCompletionRate: number; // Meta de taxa de conclusão do formulário
  targetWhatsAppResponseRate: number; // Meta de taxa de resposta no WhatsApp
}

// Dados de abandono rastreados
export interface AbandonmentData {
  totalClicks: number;
  formStarts: number;
  formCompletions: number;
  whatsappClicks: number;
  whatsappMessagesReceived: number;
  period: 'today' | 'last_7d' | 'last_30d';
}

const STORAGE_KEY = 'analysis_criteria';
const ABANDONMENT_STORAGE_KEY = 'abandonment_data';

const DEFAULT_CRITERIA: AnalysisCriteria = {
  minImpressions: 5000,
  minDaysActive: 3,
  minSpendForDecision: 100,
  
  minCTR: 1.0,
  minConversionRate: 2.0,
  maxCPC: 3.0,
  
  saturationDropThreshold: 30, // 30% de queda
  saturationPeriodDays: 7,
  
  teamDailyLeadCapacity: 20,
  teamSize: 1,
  avgLeadHandlingTime: 30,
  workHoursPerDay: 8,

  // Taxas de abandono padrão baseadas em benchmarks do mercado
  expectedFormAbandonmentRate: 70, // 70% abandonam formulários
  expectedWhatsAppAbandonmentRate: 40, // 40% clicam mas não enviam mensagem
  targetFormCompletionRate: 40, // Meta: 40% completam
  targetWhatsAppResponseRate: 70, // Meta: 70% enviam mensagem
};

const DEFAULT_ABANDONMENT: AbandonmentData = {
  totalClicks: 0,
  formStarts: 0,
  formCompletions: 0,
  whatsappClicks: 0,
  whatsappMessagesReceived: 0,
  period: 'last_7d',
};

export const useAnalysisCriteria = () => {
  const [criteria, setCriteria] = useState<AnalysisCriteria>(DEFAULT_CRITERIA);
  const [isLoading, setIsLoading] = useState(true);

  // Carregar do localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCriteria({ ...DEFAULT_CRITERIA, ...parsed });
      }
    } catch (e) {
      console.error('Error loading analysis criteria:', e);
    }
    setIsLoading(false);
  }, []);

  // Salvar no localStorage
  const saveCriteria = useCallback((newCriteria: Partial<AnalysisCriteria>) => {
    const updated = { ...criteria, ...newCriteria };
    setCriteria(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [criteria]);

  // Resetar para padrão
  const resetToDefaults = useCallback(() => {
    setCriteria(DEFAULT_CRITERIA);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CRITERIA));
  }, []);

  // Calcular capacidade diária máxima de leads
  const getMaxDailyLeads = useCallback(() => {
    const minutesPerDay = criteria.workHoursPerDay * 60;
    const leadsPerPerson = Math.floor(minutesPerDay / criteria.avgLeadHandlingTime);
    return leadsPerPerson * criteria.teamSize;
  }, [criteria.avgLeadHandlingTime, criteria.teamSize, criteria.workHoursPerDay]);

  // Verificar se equipe está sobrecarregada
  const checkTeamCapacity = useCallback((currentDailyLeads: number) => {
    const maxCapacity = getMaxDailyLeads();
    const usagePercent = (currentDailyLeads / maxCapacity) * 100;
    
    if (usagePercent >= 100) {
      return {
        status: 'overloaded' as const,
        message: 'Equipe sobrecarregada! Leads podem estar sendo perdidos.',
        usagePercent,
        recommendation: 'Reduza investimento ou aumente a equipe.',
      };
    } else if (usagePercent >= 80) {
      return {
        status: 'high' as const,
        message: 'Capacidade quase no limite.',
        usagePercent,
        recommendation: 'Monitore de perto e prepare para escalar equipe.',
      };
    } else if (usagePercent >= 50) {
      return {
        status: 'healthy' as const,
        message: 'Capacidade saudável.',
        usagePercent,
        recommendation: 'Pode escalar investimento com segurança.',
      };
    } else {
      return {
        status: 'underutilized' as const,
        message: 'Equipe subutilizada.',
        usagePercent,
        recommendation: 'Aumente investimento para gerar mais leads.',
      };
    }
  }, [getMaxDailyLeads]);

  // Detectar saturação de público
  const detectSaturation = useCallback((
    currentMetrics: { ctr: number; cpc: number; conversionRate: number },
    previousMetrics: { ctr: number; cpc: number; conversionRate: number } | null
  ) => {
    if (!previousMetrics) {
      return { isSaturated: false, indicators: [] };
    }

    const indicators: string[] = [];
    const threshold = criteria.saturationDropThreshold / 100;

    // Verificar queda no CTR
    if (previousMetrics.ctr > 0) {
      const ctrDrop = (previousMetrics.ctr - currentMetrics.ctr) / previousMetrics.ctr;
      if (ctrDrop >= threshold) {
        indicators.push(`CTR caiu ${(ctrDrop * 100).toFixed(1)}%`);
      }
    }

    // Verificar aumento no CPC
    if (previousMetrics.cpc > 0) {
      const cpcIncrease = (currentMetrics.cpc - previousMetrics.cpc) / previousMetrics.cpc;
      if (cpcIncrease >= threshold) {
        indicators.push(`CPC aumentou ${(cpcIncrease * 100).toFixed(1)}%`);
      }
    }

    // Verificar queda na conversão
    if (previousMetrics.conversionRate > 0) {
      const convDrop = (previousMetrics.conversionRate - currentMetrics.conversionRate) / previousMetrics.conversionRate;
      if (convDrop >= threshold) {
        indicators.push(`Conversão caiu ${(convDrop * 100).toFixed(1)}%`);
      }
    }

    return {
      isSaturated: indicators.length >= 2, // Saturação se 2+ indicadores
      indicators,
      recommendation: indicators.length >= 2 
        ? 'Público possivelmente saturado. Considere testar novos públicos ou criativos.'
        : undefined,
    };
  }, [criteria.saturationDropThreshold]);

  // Calcular taxas de abandono
  const calculateAbandonmentRates = useCallback((data: AbandonmentData) => {
    const formAbandonmentRate = data.formStarts > 0 
      ? ((data.formStarts - data.formCompletions) / data.formStarts) * 100 
      : 0;
    
    const formCompletionRate = data.formStarts > 0 
      ? (data.formCompletions / data.formStarts) * 100 
      : 0;

    const whatsappAbandonmentRate = data.whatsappClicks > 0 
      ? ((data.whatsappClicks - data.whatsappMessagesReceived) / data.whatsappClicks) * 100 
      : 0;
    
    const whatsappResponseRate = data.whatsappClicks > 0 
      ? (data.whatsappMessagesReceived / data.whatsappClicks) * 100 
      : 0;

    const overallClickToLeadRate = data.totalClicks > 0 
      ? ((data.formCompletions + data.whatsappMessagesReceived) / data.totalClicks) * 100 
      : 0;

    // Comparar com metas
    const formPerformance = formCompletionRate >= criteria.targetFormCompletionRate 
      ? 'good' 
      : formCompletionRate >= criteria.targetFormCompletionRate * 0.7 
        ? 'warning' 
        : 'bad';

    const whatsappPerformance = whatsappResponseRate >= criteria.targetWhatsAppResponseRate 
      ? 'good' 
      : whatsappResponseRate >= criteria.targetWhatsAppResponseRate * 0.7 
        ? 'warning' 
        : 'bad';

    return {
      formAbandonmentRate,
      formCompletionRate,
      whatsappAbandonmentRate,
      whatsappResponseRate,
      overallClickToLeadRate,
      formPerformance,
      whatsappPerformance,
      recommendations: generateAbandonmentRecommendations(
        formCompletionRate, 
        whatsappResponseRate,
        criteria.targetFormCompletionRate,
        criteria.targetWhatsAppResponseRate
      ),
    };
  }, [criteria.targetFormCompletionRate, criteria.targetWhatsAppResponseRate]);

  // Gerar recomendações baseadas nas taxas
  const generateAbandonmentRecommendations = (
    formRate: number, 
    whatsappRate: number,
    targetForm: number,
    targetWhatsapp: number
  ): string[] => {
    const recommendations: string[] = [];

    if (formRate < targetForm * 0.5) {
      recommendations.push('Taxa de conclusão de formulário muito baixa. Simplifique o formulário (menos campos).');
      recommendations.push('Revise o copy do formulário e adicione indicadores de progresso.');
    } else if (formRate < targetForm) {
      recommendations.push('Considere reduzir campos do formulário ou dividir em fases.');
    }

    if (whatsappRate < targetWhatsapp * 0.5) {
      recommendations.push('Muitos cliques no WhatsApp sem mensagem. Verifique se o link está funcionando.');
      recommendations.push('Adicione uma mensagem pré-preenchida para facilitar o primeiro contato.');
    } else if (whatsappRate < targetWhatsapp) {
      recommendations.push('Melhore o CTA que leva ao WhatsApp - seja mais específico sobre o que o usuário vai receber.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Taxas de conversão dentro da meta! Continue monitorando.');
    }

    return recommendations;
  };

  // Estimar leads reais baseado em cliques e taxa de abandono
  const estimateActualLeads = useCallback((
    totalClicks: number, 
    isWhatsApp: boolean = false
  ) => {
    const abandonmentRate = isWhatsApp 
      ? criteria.expectedWhatsAppAbandonmentRate 
      : criteria.expectedFormAbandonmentRate;
    
    const conversionRate = (100 - abandonmentRate) / 100;
    return Math.floor(totalClicks * conversionRate);
  }, [criteria.expectedFormAbandonmentRate, criteria.expectedWhatsAppAbandonmentRate]);

  return {
    criteria,
    saveCriteria,
    resetToDefaults,
    isLoading,
    getMaxDailyLeads,
    checkTeamCapacity,
    detectSaturation,
    calculateAbandonmentRates,
    estimateActualLeads,
    DEFAULT_CRITERIA,
    DEFAULT_ABANDONMENT,
  };
};

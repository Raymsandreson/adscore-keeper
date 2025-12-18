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
}

const STORAGE_KEY = 'analysis_criteria';

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
    const hoursPerDay = 8;
    const minutesPerDay = hoursPerDay * 60;
    const leadsPerPerson = Math.floor(minutesPerDay / criteria.avgLeadHandlingTime);
    return leadsPerPerson * criteria.teamSize;
  }, [criteria.avgLeadHandlingTime, criteria.teamSize]);

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

  return {
    criteria,
    saveCriteria,
    resetToDefaults,
    isLoading,
    getMaxDailyLeads,
    checkTeamCapacity,
    detectSaturation,
    DEFAULT_CRITERIA,
  };
};

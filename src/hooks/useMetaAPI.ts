import { useState, useEffect, useCallback } from 'react';

export interface MetaAPIConfig {
  accessToken: string;
  accountId: string;
}

export interface MetricData {
  cpc: number;
  ctr: number;
  cpm: number;
  conversionRate: number;
  hookRate: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export const useMetaAPI = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState<MetricData>({
    cpc: 0,
    ctr: 0,
    cpm: 0,
    conversionRate: 0,
    hookRate: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simular dados realísticos baseados nos benchmarks
  const generateRealisticMetrics = useCallback((): MetricData => {
    const impressions = Math.floor(Math.random() * 50000) + 10000;
    const clicks = Math.floor(impressions * (Math.random() * 0.03 + 0.01)); // 1-4% CTR
    const conversions = Math.floor(clicks * (Math.random() * 0.05 + 0.01)); // 1-6% conversion
    const spend = clicks * (Math.random() * 2 + 0.8); // R$ 0.80 - R$ 2.80 CPC
    
    return {
      cpc: spend / clicks,
      ctr: (clicks / impressions) * 100,
      cpm: (spend / impressions) * 1000,
      conversionRate: (conversions / clicks) * 100,
      hookRate: Math.random() * 40 + 15, // 15-55% hook rate
      spend: spend,
      impressions,
      clicks,
      conversions
    };
  }, []);

  const connectToMeta = useCallback(async (config: MetaAPIConfig): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      // Simular validação da API
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Validação básica do token e account ID
      if (!config.accessToken.startsWith('EAAG') || !config.accountId.startsWith('act_')) {
        throw new Error('Formato inválido do Access Token ou Account ID');
      }

      // Gerar métricas iniciais realísticas
      setMetrics(generateRealisticMetrics());
      setIsConnected(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setIsConnected(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [generateRealisticMetrics]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setMetrics({
      cpc: 0,
      ctr: 0,
      cpm: 0,
      conversionRate: 0,
      hookRate: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0
    });
    setError(null);
  }, []);

  // Atualizar métricas em tempo real quando conectado
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      setMetrics(prev => {
        // Variações pequenas e realísticas
        const variance = (Math.random() - 0.5) * 0.1;
        
        return {
          cpc: Math.max(0.1, prev.cpc * (1 + variance)),
          ctr: Math.max(0.1, prev.ctr * (1 + variance * 0.5)),
          cpm: Math.max(1, prev.cpm * (1 + variance)),
          conversionRate: Math.max(0.1, prev.conversionRate * (1 + variance * 0.3)),
          hookRate: Math.max(5, Math.min(60, prev.hookRate + (Math.random() - 0.5) * 2)),
          spend: prev.spend + Math.random() * 15,
          impressions: prev.impressions + Math.floor(Math.random() * 1000),
          clicks: prev.clicks + Math.floor(Math.random() * 50),
          conversions: prev.conversions + Math.floor(Math.random() * 3)
        };
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    isConnected,
    metrics,
    isLoading,
    error,
    connectToMeta,
    disconnect
  };
};
import { useState, useEffect, useCallback } from 'react';
import { metaAPIService, MetaAPIConfig, AdInsights, CampaignInsight } from '@/services/metaAPI';

export type DateRangeOption = 'today' | 'last_7d' | 'last_30d';

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
  const [dateRange, setDateRange] = useState<DateRangeOption>('last_7d');
  const [metrics, setMetrics] = useState<MetricData>({
    cpc: 2.15,
    ctr: 2.8,
    cpm: 24.30,
    conversionRate: 3.2,
    hookRate: 15.7,
    spend: 8750.00,
    impressions: 360120,
    clicks: 10084,
    conversions: 323
  });
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([]);
  const [creatives, setCreatives] = useState<CampaignInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MetaAPIConfig | null>(null);

  const fetchData = useCallback(async (apiConfig: MetaAPIConfig, range: DateRangeOption) => {
    const [insightData, campaignData, creativeData] = await Promise.all([
      metaAPIService.getAdInsights(apiConfig, range),
      metaAPIService.getCampaignInsights(apiConfig, range),
      metaAPIService.getAdCreativeInsights(apiConfig, range)
    ]);
    return { insightData, campaignData, creativeData };
  }, []);

  const connectToMeta = useCallback(async (apiConfig: MetaAPIConfig): Promise<boolean> => {
    console.log('🚀 Iniciando conexão com Meta API...');
    setIsLoading(true);
    setError(null);

    try {
      if (!apiConfig.accessToken.trim() || !apiConfig.accountId.trim()) {
        throw new Error('Access Token e Account ID são obrigatórios');
      }

      const isTokenValid = await metaAPIService.validateToken(apiConfig.accessToken);
      if (!isTokenValid) {
        throw new Error('Access Token inválido');
      }

      const isAccountValid = await metaAPIService.validateAccount(apiConfig.accessToken, apiConfig.accountId);
      if (!isAccountValid) {
        throw new Error('Account ID inválido ou conta inativa');
      }

      const { insightData, campaignData, creativeData } = await fetchData(apiConfig, dateRange);
      
      setConfig(apiConfig);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setCreatives(creativeData);
      setIsConnected(true);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      setIsConnected(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [dateRange, fetchData]);

  const changeDateRange = useCallback(async (newRange: DateRangeOption) => {
    setDateRange(newRange);
    if (!config || !isConnected) return;
    
    setIsLoading(true);
    try {
      const { insightData, campaignData, creativeData } = await fetchData(config, newRange);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setCreatives(creativeData);
    } catch (err) {
      console.error('Error changing date range:', err);
    } finally {
      setIsLoading(false);
    }
  }, [config, isConnected, fetchData]);

  const refreshMetrics = useCallback(async () => {
    if (!config || !isConnected) return;

    try {
      const { insightData, campaignData, creativeData } = await fetchData(config, dateRange);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setCreatives(creativeData);
    } catch (err) {
      console.error('Error refreshing metrics:', err);
    }
  }, [config, isConnected, dateRange, fetchData]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setConfig(null);
    setMetrics({
      cpc: 2.15, ctr: 2.8, cpm: 24.30, conversionRate: 3.2,
      hookRate: 15.7, spend: 8750.00, impressions: 360120, clicks: 10084, conversions: 323
    });
    setCampaigns([]);
    setCreatives([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isConnected || !config) return;
    const interval = setInterval(refreshMetrics, 30000);
    return () => clearInterval(interval);
  }, [isConnected, config, refreshMetrics]);

  return {
    isConnected,
    metrics,
    campaigns,
    creatives,
    isLoading,
    error,
    dateRange,
    connectToMeta,
    disconnect,
    refreshMetrics,
    changeDateRange
  };
};
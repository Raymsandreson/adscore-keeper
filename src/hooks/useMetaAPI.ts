import { useState, useEffect, useCallback, useRef } from 'react';
import { metaAPIService, MetaAPIConfig, AdInsights, CampaignInsight, DailyInsight, PlacementInsight } from '@/services/metaAPI';
import { supabase } from '@/integrations/supabase/client';

export type DateRangeOption = 
  | 'today' 
  | 'yesterday'
  | 'last_7d' 
  | 'last_15d'
  | 'last_30d' 
  | 'last_60d'
  | 'last_90d'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_semester'
  | 'this_year'
  | 'custom';

export interface CustomDateRange {
  since: string;
  until: string;
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

export type { CampaignInsight, DailyInsight, PlacementInsight };

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
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([
    { id: 'camp_1', name: 'Campanha - Tráfego Frio', type: 'campaign', cpc: 2.35, ctr: 1.8, cpm: 28.50, conversionRate: 2.1, spend: 1250, impressions: 43850, clicks: 789, conversions: 17 },
    { id: 'camp_2', name: 'Campanha - Remarketing', type: 'campaign', cpc: 1.25, ctr: 3.5, cpm: 12.90, conversionRate: 5.2, spend: 890, impressions: 68992, clicks: 2415, conversions: 125 },
    { id: 'camp_3', name: 'Campanha - Lookalike 1%', type: 'campaign', cpc: 1.95, ctr: 2.8, cpm: 18.40, conversionRate: 4.1, spend: 2100, impressions: 114130, clicks: 3195, conversions: 131 },
  ]);
  const [adSets, setAdSets] = useState<CampaignInsight[]>([
    { id: 'adset_1', name: 'Conjunto - Público Frio 25-45', type: 'adset', cpc: 2.10, ctr: 2.0, cpm: 22.00, conversionRate: 2.8, spend: 850, impressions: 38636, clicks: 773, conversions: 22 },
    { id: 'adset_2', name: 'Conjunto - Remarketing 7d', type: 'adset', cpc: 1.15, ctr: 3.8, cpm: 11.50, conversionRate: 5.5, spend: 650, impressions: 56522, clicks: 2148, conversions: 118 },
    { id: 'adset_3', name: 'Conjunto - Lookalike Compradores', type: 'adset', cpc: 1.85, ctr: 2.9, cpm: 17.80, conversionRate: 4.3, spend: 1200, impressions: 67416, clicks: 1955, conversions: 84 },
  ]);
  const [creatives, setCreatives] = useState<CampaignInsight[]>([
    { id: 'ad_1', name: 'Vídeo Promocional - Black Friday', type: 'creative', cpc: 2.35, ctr: 1.8, cpm: 28.50, conversionRate: 2.1, spend: 1250, impressions: 43850, clicks: 789, conversions: 17 },
    { id: 'ad_2', name: 'Carrossel de Produtos', type: 'creative', cpc: 1.89, ctr: 2.4, cpm: 22.10, conversionRate: 3.2, spend: 980, impressions: 44350, clicks: 1065, conversions: 34 },
    { id: 'ad_3', name: 'Vídeo Testemunhal', type: 'creative', cpc: 1.65, ctr: 3.1, cpm: 19.80, conversionRate: 4.8, spend: 2150, impressions: 108590, clicks: 3366, conversions: 162 },
  ]);
  const [dailyData, setDailyData] = useState<DailyInsight[]>([]);
  const [placementData, setPlacementData] = useState<PlacementInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MetaAPIConfig | null>(null);

  const fetchData = useCallback(async (apiConfig: MetaAPIConfig, range: DateRangeOption) => {
    const [insightData, campaignData, adSetData, creativeData, dailyInsights, placementInsights] = await Promise.all([
      metaAPIService.getAdInsights(apiConfig, range),
      metaAPIService.getCampaignInsights(apiConfig, range),
      metaAPIService.getAdSetInsights(apiConfig, range),
      metaAPIService.getAdCreativeInsights(apiConfig, range),
      metaAPIService.getDailyInsights(apiConfig, range),
      metaAPIService.getPlacementInsights(apiConfig, range)
    ]);
    return { insightData, campaignData, adSetData, creativeData, dailyInsights, placementInsights };
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

      const accountValidation = await metaAPIService.validateAccount(apiConfig.accessToken, apiConfig.accountId);
      if (!accountValidation.valid) {
        throw new Error(accountValidation.error || 'Account ID inválido ou conta inativa');
      }

      const { insightData, campaignData, adSetData, creativeData, dailyInsights, placementInsights } = await fetchData(apiConfig, dateRange);
      
      setConfig(apiConfig);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setAdSets(adSetData);
      setCreatives(creativeData);
      setDailyData(dailyInsights);
      setPlacementData(placementInsights);
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
      const { insightData, campaignData, adSetData, creativeData, dailyInsights, placementInsights } = await fetchData(config, newRange);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setAdSets(adSetData);
      setCreatives(creativeData);
      setDailyData(dailyInsights);
      setPlacementData(placementInsights);
    } catch (err) {
      console.error('Error changing date range:', err);
    } finally {
      setIsLoading(false);
    }
  }, [config, isConnected, fetchData]);

  const refreshMetrics = useCallback(async () => {
    if (!config || !isConnected) return;

    try {
      const { insightData, campaignData, adSetData, creativeData, dailyInsights, placementInsights } = await fetchData(config, dateRange);
      setMetrics(insightData);
      setCampaigns(campaignData);
      setAdSets(adSetData);
      setCreatives(creativeData);
      setDailyData(dailyInsights);
      setPlacementData(placementInsights);
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
    setAdSets([]);
    setCreatives([]);
    setDailyData([]);
    setPlacementData([]);
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
    adSets,
    creatives,
    dailyData,
    placementData,
    isLoading,
    error,
    dateRange,
    config, // Export config to allow passing accessToken to OrganicMetrics
    connectToMeta,
    disconnect,
    refreshMetrics,
    changeDateRange
  };
};
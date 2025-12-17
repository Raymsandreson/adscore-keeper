import { useState, useEffect, useCallback } from 'react';
import { metaAPIService, MetaAPIConfig, AdInsights, CampaignInsight } from '@/services/metaAPI';

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

  const connectToMeta = useCallback(async (apiConfig: MetaAPIConfig): Promise<boolean> => {
    console.log('🚀 Iniciando conexão com Meta API...', { accessToken: apiConfig.accessToken.substring(0, 10) + '...', accountId: apiConfig.accountId });
    setIsLoading(true);
    setError(null);

    try {
      if (!apiConfig.accessToken.trim() || !apiConfig.accountId.trim()) {
        throw new Error('Access Token e Account ID são obrigatórios');
      }

      console.log('🔑 Validando token...');
      const isTokenValid = await metaAPIService.validateToken(apiConfig.accessToken);
      if (!isTokenValid) {
        throw new Error('Access Token inválido. Verifique se tem as permissões: ads_read, ads_management, business_management');
      }

      console.log('🏢 Validando conta...');
      const isAccountValid = await metaAPIService.validateAccount(apiConfig.accessToken, apiConfig.accountId);
      if (!isAccountValid) {
        throw new Error('Account ID inválido ou conta inativa. Use o formato: act_123456789');
      }

      console.log('📊 Buscando dados iniciais...');
      const [initialData, campaignData, creativeData] = await Promise.all([
        metaAPIService.getAdInsights(apiConfig),
        metaAPIService.getCampaignInsights(apiConfig),
        metaAPIService.getAdCreativeInsights(apiConfig)
      ]);
      
      setConfig(apiConfig);
      setMetrics(initialData);
      setCampaigns(campaignData);
      setCreatives(creativeData);
      setIsConnected(true);
      console.log('✅ Conexão estabelecida com sucesso!');
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido na conexão';
      console.error('❌ Erro na conexão:', errorMessage);
      setError(errorMessage);
      setIsConnected(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    if (!config || !isConnected) return;

    try {
      const [updatedData, campaignData, creativeData] = await Promise.all([
        metaAPIService.getAdInsights(config),
        metaAPIService.getCampaignInsights(config),
        metaAPIService.getAdCreativeInsights(config)
      ]);
      setMetrics(updatedData);
      setCampaigns(campaignData);
      setCreatives(creativeData);
    } catch (err) {
      console.error('Error refreshing metrics:', err);
    }
  }, [config, isConnected]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setConfig(null);
    setMetrics({
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
    connectToMeta,
    disconnect,
    refreshMetrics
  };
};
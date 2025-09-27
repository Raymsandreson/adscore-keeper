import { useState, useEffect, useCallback } from 'react';
import { metaAPIService, MetaAPIConfig, AdInsights } from '@/services/metaAPI';

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
  const [config, setConfig] = useState<MetaAPIConfig | null>(null);

  const connectToMeta = useCallback(async (apiConfig: MetaAPIConfig): Promise<boolean> => {
    console.log('🚀 Iniciando conexão com Meta API...', { accessToken: apiConfig.accessToken.substring(0, 10) + '...', accountId: apiConfig.accountId });
    setIsLoading(true);
    setError(null);

    try {
      // Validar formato básico
      if (!apiConfig.accessToken.trim() || !apiConfig.accountId.trim()) {
        throw new Error('Access Token e Account ID são obrigatórios');
      }

      // Validar token
      console.log('🔑 Validando token...');
      const isTokenValid = await metaAPIService.validateToken(apiConfig.accessToken);
      if (!isTokenValid) {
        throw new Error('Access Token inválido. Verifique se tem as permissões: ads_read, ads_management, business_management');
      }

      // Validar conta
      console.log('🏢 Validando conta...');
      const isAccountValid = await metaAPIService.validateAccount(apiConfig.accessToken, apiConfig.accountId);
      if (!isAccountValid) {
        throw new Error('Account ID inválido ou conta inativa. Use o formato: act_123456789');
      }

      // Buscar dados iniciais
      console.log('📊 Buscando dados iniciais...');
      const initialData = await metaAPIService.getAdInsights(apiConfig);
      
      setConfig(apiConfig);
      setMetrics(initialData);
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
      const updatedData = await metaAPIService.getAdInsights(config);
      setMetrics(updatedData);
    } catch (err) {
      console.error('Error refreshing metrics:', err);
    }
  }, [config, isConnected]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setConfig(null);
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
    if (!isConnected || !config) return;

    // Buscar dados reais a cada 30 segundos
    const interval = setInterval(refreshMetrics, 30000);

    return () => clearInterval(interval);
  }, [isConnected, config, refreshMetrics]);

  return {
    isConnected,
    metrics,
    isLoading,
    error,
    connectToMeta,
    disconnect,
    refreshMetrics
  };
};
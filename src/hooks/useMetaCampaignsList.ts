import { useQuery } from '@tanstack/react-query';
import { cloudFunctions } from '@/lib/functionRouter';
import { getMetaCredentials } from '@/utils/metaCredentials';

export interface MetaCampaignOption {
  campaign_id: string;
  campaign_name: string;
  status: string;
}

/**
 * Lista as campanhas da conta Meta conectada (id/nome/status apenas).
 *
 * Usa o fast-path do `list-meta-ads`: sem `includeInsights`/`includeDestinationPhone`
 * a função faz UMA chamada ao Graph API para todo o lote, em vez de 5+ por campanha
 * (que estourava o timeout). Serve para seletores, não para métricas.
 */
export function useMetaCampaignsList(enabled = true) {
  return useQuery({
    queryKey: ['meta-campaigns-list'],
    enabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<MetaCampaignOption[]> => {
      const { accessToken, adAccountId } = await getMetaCredentials();
      if (!accessToken || !adAccountId) return [];

      const formattedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const { data, error } = await cloudFunctions.invoke('list-meta-ads', {
        body: {
          accessToken,
          adAccountId: formattedAccountId,
          limit: 100,
          status: ['ACTIVE', 'PAUSED'],
        },
      });
      if (error) throw error;
      // token expirado/erro de negócio volta como { success: false, ... } com status 200
      if (data && (data as any).success === false) {
        throw new Error((data as any).error || 'Falha ao listar campanhas do Meta');
      }

      return ((data as any)?.campaigns || [])
        .filter((c: any) => c?.campaign_id && c?.campaign_name)
        .map((c: any) => ({
          campaign_id: String(c.campaign_id),
          campaign_name: String(c.campaign_name),
          status: String(c.status || 'UNKNOWN'),
        })) as MetaCampaignOption[];
    },
  });
}

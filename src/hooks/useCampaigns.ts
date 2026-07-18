import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'closed';

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  board_id: string | null;
  stage_id: string | null;
  investment_total: number;
  meta_ad_account_id: string | null;
  meta_campaign_id: string | null;
  product_service_id: string | null;
  nucleus_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  deleted_at: string | null;
  details: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CampaignMetrics {
  campaign_id: string;
  name: string;
  status: CampaignStatus;
  investment_total: number;
  leads_count: number;
  cases_count: number;
  processes_count: number;
  honorarios_total: number;
  cac: number;
  roi: number | null;
  ltv_por_lead: number;
}

const client = db as any;

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await client
        .from('campaigns')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['campaigns', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await client
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as Campaign | null;
    },
  });
}

export function useCampaignMetrics(campaignId?: string) {
  return useQuery({
    queryKey: ['campaign_metrics', campaignId ?? 'all'],
    staleTime: 30_000,
    queryFn: async () => {
      let q = client.from('vw_campaign_metrics').select('*');
      if (campaignId) q = q.eq('campaign_id', campaignId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CampaignMetrics[];
    },
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Campaign>) => {
      const { data, error } = await client.from('campaigns').insert(payload).select().single();
      if (error) throw error;
      return data as Campaign;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha criada');
    },
    onError: (e: any) => toast.error(`Erro ao criar: ${e.message}`),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Campaign> & { id: string }) => {
      const { data, error } = await client.from('campaigns').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data as Campaign;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaigns', vars.id] });
      qc.invalidateQueries({ queryKey: ['campaign_metrics'] });
      toast.success('Campanha atualizada');
    },
    onError: (e: any) => toast.error(`Erro ao atualizar: ${e.message}`),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client
        .from('campaigns')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campanha arquivada');
    },
  });
}

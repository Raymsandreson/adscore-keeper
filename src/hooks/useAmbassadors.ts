import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface Ambassador {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  is_active: boolean;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AmbassadorMemberLink {
  id: string;
  ambassador_id: string;
  member_user_id: string;
  is_active: boolean;
  created_at: string;
}

export interface AmbassadorCampaign {
  id: string;
  name: string;
  description: string | null;
  member_user_id: string | null;
  period_start: string;
  period_end: string;
  metric_key: string;
  target_value: number;
  reward_value: number;
  min_threshold_percent: number;
  accelerator_multiplier: number | null;
  cap_percent: number | null;
  is_active: boolean;
  created_at: string;
}

export interface AmbassadorReferral {
  id: string;
  ambassador_id: string;
  member_user_id: string;
  lead_id: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export function useAmbassadors() {
  const { user } = useAuthContext();
  const [ambassadors, setAmbassadors] = useState<Ambassador[]>([]);
  const [links, setLinks] = useState<AmbassadorMemberLink[]>([]);
  const [campaigns, setCampaigns] = useState<AmbassadorCampaign[]>([]);
  const [referrals, setReferrals] = useState<AmbassadorReferral[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [ambRes, linkRes, campRes, refRes] = await Promise.all([
        supabase.from('ambassadors').select('*').order('full_name'),
        supabase.from('ambassador_member_links').select('*'),
        supabase.from('ambassador_campaigns').select('*').order('created_at', { ascending: false }),
        supabase.from('ambassador_referrals').select('*').order('created_at', { ascending: false }),
      ]);

      if (ambRes.data) setAmbassadors(ambRes.data as Ambassador[]);
      if (linkRes.data) setLinks(linkRes.data as AmbassadorMemberLink[]);
      if (campRes.data) setCampaigns(campRes.data as AmbassadorCampaign[]);
      if (refRes.data) setReferrals(refRes.data as AmbassadorReferral[]);
    } catch (err) {
      console.error('Error fetching ambassadors:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createAmbassador = useCallback(async (data: Partial<Ambassador>) => {
    const { error } = await supabase.from('ambassadors').insert({
      full_name: data.full_name!,
      phone: data.phone || null,
      email: data.email || null,
      instagram_username: data.instagram_username || null,
      city: data.city || null,
      state: data.state || null,
      notes: data.notes || null,
    });
    if (error) { toast.error('Erro ao criar embaixador'); throw error; }
    toast.success('Embaixador criado!');
    await fetchAll();
  }, [fetchAll]);

  const updateAmbassador = useCallback(async (id: string, data: Partial<Ambassador>) => {
    const { error } = await supabase.from('ambassadors').update(data).eq('id', id);
    if (error) { toast.error('Erro ao atualizar'); throw error; }
    toast.success('Embaixador atualizado!');
    await fetchAll();
  }, [fetchAll]);

  const deleteAmbassador = useCallback(async (id: string) => {
    const { error } = await supabase.from('ambassadors').delete().eq('id', id);
    if (error) { toast.error('Erro ao remover'); throw error; }
    toast.success('Embaixador removido!');
    await fetchAll();
  }, [fetchAll]);

  const linkAmbassadorToMember = useCallback(async (ambassadorId: string, memberUserId: string) => {
    const { error } = await supabase.from('ambassador_member_links').upsert(
      { ambassador_id: ambassadorId, member_user_id: memberUserId, is_active: true },
      { onConflict: 'ambassador_id,member_user_id' }
    );
    if (error) { toast.error('Erro ao vincular'); throw error; }
    toast.success('Embaixador vinculado!');
    await fetchAll();
  }, [fetchAll]);

  const unlinkAmbassador = useCallback(async (ambassadorId: string, memberUserId: string) => {
    const { error } = await supabase.from('ambassador_member_links')
      .delete()
      .eq('ambassador_id', ambassadorId)
      .eq('member_user_id', memberUserId);
    if (error) { toast.error('Erro ao desvincular'); throw error; }
    toast.success('Embaixador desvinculado!');
    await fetchAll();
  }, [fetchAll]);

  const createCampaign = useCallback(async (data: Partial<AmbassadorCampaign>) => {
    const { error } = await supabase.from('ambassador_campaigns').insert({
      name: data.name!,
      description: data.description || null,
      member_user_id: data.member_user_id || null,
      period_start: data.period_start!,
      period_end: data.period_end!,
      metric_key: data.metric_key || 'leads_captured',
      target_value: data.target_value || 10,
      reward_value: data.reward_value || 100,
      min_threshold_percent: data.min_threshold_percent || 70,
      accelerator_multiplier: data.accelerator_multiplier ?? 1.5,
      cap_percent: data.cap_percent ?? 200,
    });
    if (error) { toast.error('Erro ao criar campanha'); throw error; }
    toast.success('Campanha criada!');
    await fetchAll();
  }, [fetchAll]);

  const updateCampaign = useCallback(async (id: string, data: Partial<AmbassadorCampaign>) => {
    const { error } = await supabase.from('ambassador_campaigns').update(data).eq('id', id);
    if (error) { toast.error('Erro ao atualizar campanha'); throw error; }
    toast.success('Campanha atualizada!');
    await fetchAll();
  }, [fetchAll]);

  const createReferral = useCallback(async (data: Partial<AmbassadorReferral>) => {
    const { error } = await supabase.from('ambassador_referrals').insert({
      ambassador_id: data.ambassador_id!,
      member_user_id: data.member_user_id!,
      lead_id: data.lead_id || null,
      contact_id: data.contact_id || null,
      campaign_id: data.campaign_id || null,
      status: data.status || 'captured',
      notes: data.notes || null,
    });
    if (error) { toast.error('Erro ao registrar indicação'); throw error; }
    toast.success('Indicação registrada!');
    await fetchAll();
  }, [fetchAll]);

  const updateReferral = useCallback(async (id: string, data: Partial<AmbassadorReferral>) => {
    const { error } = await supabase.from('ambassador_referrals').update(data).eq('id', id);
    if (error) { toast.error('Erro ao atualizar indicação'); throw error; }
    await fetchAll();
  }, [fetchAll]);

  const getAmbassadorsForMember = useCallback((memberUserId: string) => {
    const linkedIds = links.filter(l => l.member_user_id === memberUserId && l.is_active).map(l => l.ambassador_id);
    return ambassadors.filter(a => linkedIds.includes(a.id));
  }, [ambassadors, links]);

  const getReferralsForAmbassador = useCallback((ambassadorId: string, campaignId?: string) => {
    return referrals.filter(r => {
      if (r.ambassador_id !== ambassadorId) return false;
      if (campaignId && r.campaign_id !== campaignId) return false;
      return true;
    });
  }, [referrals]);

  return {
    ambassadors, links, campaigns, referrals, loading,
    createAmbassador, updateAmbassador, deleteAmbassador,
    linkAmbassadorToMember, unlinkAmbassador,
    createCampaign, updateCampaign,
    createReferral, updateReferral,
    getAmbassadorsForMember, getReferralsForAmbassador,
    refetch: fetchAll,
  };
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/**
 * An "Ambassador" is a contact with classification = 'embaixador'.
 * They are linked to the team member who created them (created_by).
 */
export interface AmbassadorContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  classification: string | null;
  created_by: string | null;
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
  const [ambassadors, setAmbassadors] = useState<AmbassadorContact[]>([]);
  const [campaigns, setCampaigns] = useState<AmbassadorCampaign[]>([]);
  const [referrals, setReferrals] = useState<AmbassadorReferral[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch contacts classified as 'embaixador'
      const [contactsRes, campRes, refRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, full_name, phone, email, instagram_username, city, state, notes, classification, created_by, created_at')
          .eq('classification', 'embaixador')
          .order('full_name'),
        supabase.from('ambassador_campaigns').select('*').order('created_at', { ascending: false }),
        supabase.from('ambassador_referrals').select('*').order('created_at', { ascending: false }),
      ]);

      if (contactsRes.data) setAmbassadors(contactsRes.data as AmbassadorContact[]);
      if (campRes.data) setCampaigns(campRes.data as AmbassadorCampaign[]);
      if (refRes.data) setReferrals(refRes.data as AmbassadorReferral[]);
    } catch (err) {
      console.error('Error fetching ambassadors:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /** Mark an existing contact as ambassador */
  const markContactAsAmbassador = useCallback(async (contactId: string) => {
    const { error } = await supabase
      .from('contacts')
      .update({ classification: 'embaixador' })
      .eq('id', contactId);
    if (error) { toast.error('Erro ao marcar como embaixador'); throw error; }
    toast.success('Contato marcado como embaixador!');
    await fetchAll();
  }, [fetchAll]);

  /** Create a new contact already classified as ambassador */
  const createAmbassadorContact = useCallback(async (data: { full_name: string; phone?: string; email?: string; city?: string; state?: string; notes?: string }) => {
    const { error } = await supabase.from('contacts').insert({
      full_name: data.full_name,
      phone: data.phone || null,
      email: data.email || null,
      city: data.city || null,
      state: data.state || null,
      notes: data.notes || null,
      classification: 'embaixador',
      created_by: user?.id || null,
    } as any);
    if (error) { toast.error('Erro ao criar embaixador'); throw error; }
    toast.success('Embaixador criado!');
    await fetchAll();
  }, [fetchAll, user?.id]);

  /** Remove ambassador classification from contact */
  const removeAmbassadorClassification = useCallback(async (contactId: string) => {
    const { error } = await supabase
      .from('contacts')
      .update({ classification: null })
      .eq('id', contactId);
    if (error) { toast.error('Erro ao remover classificação'); throw error; }
    toast.success('Classificação de embaixador removida');
    await fetchAll();
  }, [fetchAll]);

  // Campaign CRUD
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

  // Referral CRUD
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

  /** Get ambassadors linked to a specific member (via created_by) */
  const getAmbassadorsForMember = useCallback((memberUserId: string) => {
    return ambassadors.filter(a => a.created_by === memberUserId);
  }, [ambassadors]);

  const getReferralsForAmbassador = useCallback((ambassadorId: string, campaignId?: string) => {
    return referrals.filter(r => {
      if (r.ambassador_id !== ambassadorId) return false;
      if (campaignId && r.campaign_id !== campaignId) return false;
      return true;
    });
  }, [referrals]);

  return {
    ambassadors, campaigns, referrals, loading,
    markContactAsAmbassador, createAmbassadorContact, removeAmbassadorClassification,
    createCampaign, updateCampaign,
    createReferral, updateReferral,
    getAmbassadorsForMember, getReferralsForAmbassador,
    refetch: fetchAll,
  };
}

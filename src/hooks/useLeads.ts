import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'not_qualified' | 'converted' | 'lost';

export interface Lead {
  id: string;
  ad_account_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_id: string | null;
  creative_name: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  source: string;
  status: LeadStatus;
  ad_spend_at_conversion: number;
  conversion_value: number;
  notes: string | null;
  qualified_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadStats {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  notQualified: number;
  converted: number;
  lost: number;
  totalSpent: number;
  totalRevenue: number;
  costPerLead: number;
  costPerConvertedLead: number;
  conversionRate: number;
  qualificationRate: number;
}

export const useLeads = (adAccountId?: string) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<LeadStats>({
    total: 0,
    new: 0,
    contacted: 0,
    qualified: 0,
    notQualified: 0,
    converted: 0,
    lost: 0,
    totalSpent: 0,
    totalRevenue: 0,
    costPerLead: 0,
    costPerConvertedLead: 0,
    conversionRate: 0,
    qualificationRate: 0,
  });

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (adAccountId) {
        query = query.eq('ad_account_id', adAccountId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Type assertion to handle the database response
      const typedLeads = (data || []) as Lead[];
      setLeads(typedLeads);
      calculateStats(typedLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast.error('Erro ao carregar leads');
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  const calculateStats = (leadsData: Lead[]) => {
    const total = leadsData.length;
    const newLeads = leadsData.filter(l => l.status === 'new').length;
    const contacted = leadsData.filter(l => l.status === 'contacted').length;
    const qualified = leadsData.filter(l => l.status === 'qualified').length;
    const notQualified = leadsData.filter(l => l.status === 'not_qualified').length;
    const converted = leadsData.filter(l => l.status === 'converted').length;
    const lost = leadsData.filter(l => l.status === 'lost').length;

    const totalSpent = leadsData.reduce((acc, l) => acc + (l.ad_spend_at_conversion || 0), 0);
    const totalRevenue = leadsData.filter(l => l.status === 'converted')
      .reduce((acc, l) => acc + (l.conversion_value || 0), 0);

    const costPerLead = total > 0 ? totalSpent / total : 0;
    const costPerConvertedLead = converted > 0 ? totalSpent / converted : 0;
    const conversionRate = total > 0 ? (converted / total) * 100 : 0;
    const qualificationRate = total > 0 ? (qualified / total) * 100 : 0;

    setStats({
      total,
      new: newLeads,
      contacted,
      qualified,
      notQualified,
      converted,
      lost,
      totalSpent,
      totalRevenue,
      costPerLead,
      costPerConvertedLead,
      conversionRate,
      qualificationRate,
    });
  };

  const addLead = async (lead: Partial<Lead>) => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .insert([{
          ...lead,
          ad_account_id: adAccountId || lead.ad_account_id,
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success('Lead adicionado com sucesso');
      fetchLeads();
      return data as Lead;
    } catch (error) {
      console.error('Error adding lead:', error);
      toast.error('Erro ao adicionar lead');
      throw error;
    }
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    try {
      // Auto-set timestamps based on status
      const timestampUpdates: Partial<Lead> = { ...updates };
      if (updates.status === 'qualified' && !updates.qualified_at) {
        timestampUpdates.qualified_at = new Date().toISOString();
      }
      if (updates.status === 'converted' && !updates.converted_at) {
        timestampUpdates.converted_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('leads')
        .update(timestampUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      toast.success('Lead atualizado com sucesso');
      fetchLeads();
      return data as Lead;
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('Erro ao atualizar lead');
      throw error;
    }
  };

  const deleteLead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Lead removido com sucesso');
      fetchLeads();
    } catch (error) {
      console.error('Error deleting lead:', error);
      toast.error('Erro ao remover lead');
      throw error;
    }
  };

  const updateLeadStatus = async (id: string, status: LeadStatus, conversionValue?: number) => {
    const updates: Partial<Lead> = { status };
    if (status === 'converted' && conversionValue !== undefined) {
      updates.conversion_value = conversionValue;
    }
    return updateLead(id, updates);
  };

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  return {
    leads,
    stats,
    loading,
    fetchLeads,
    addLead,
    updateLead,
    deleteLead,
    updateLeadStatus,
  };
};

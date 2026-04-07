import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { facebookCAPI } from '@/services/facebookCAPI';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { applyGeoRuleForLead } from '@/utils/applyGeoRuleForLead';

// Columns to fetch - avoids pulling unnecessary large text columns
const LEAD_SELECT_COLUMNS = [
  'id', 'ad_account_id', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
  'creative_id', 'creative_name', 'ad_name', 'ad_start_date',
  'lead_name', 'lead_phone', 'lead_email', 'source', 'status',
  'ad_spend_at_conversion', 'conversion_value', 'notes',
  'qualified_at', 'converted_at', 'created_at', 'updated_at',
  'facebook_lead_id', 'sync_status', 'last_sync_at',
  'instagram_comment_id', 'instagram_username', 'is_follower',
  'client_classification', 'classification_date', 'became_client_date',
  'city', 'state', 'neighborhood',
  'followup_count', 'last_followup_at', 'first_visit_at', 'first_meeting_at',
  'board_id', 'news_link', 'created_by', 'updated_by',
  'victim_name', 'victim_age', 'case_type', 'accident_date',
  'acolhedor', 'visit_state', 'visit_city', 'visit_region', 'visit_address',
  'accident_address', 'damage_description', 'contractor_company', 'main_company',
  'sector', 'company_size_justification', 'liability_type', 'legal_viability',
  'group_link', 'lead_status', 'product_service_id',
  'whatsapp_group_id', 'last_edit_summary', 'expected_birth_date',
  'case_number', 'in_progress_date', 'ctwa_context',
  'action_source', 'action_source_detail',
  'lead_status_reason', 'lead_status_changed_at', 'cac', 'inviavel_date'
].join(',');

const PAGE_SIZE = 1000;

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'not_qualified' | 'converted' | 'lost' | 'comment';
export type LeadBusinessStatus = 'active' | 'closed' | 'refused' | 'inviavel';
export type SyncStatus = 'local' | 'synced' | 'syncing' | 'error';
export type ClientClassification = 'client' | 'non_client' | 'prospect' | null;

export interface Lead {
  id: string;
  ad_account_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_id: string | null;
  creative_name: string | null;
  ad_name: string | null;
  ad_start_date: string | null;
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
  facebook_lead_id: string | null;
  sync_status: SyncStatus;
  last_sync_at: string | null;
  instagram_comment_id: string | null;
  instagram_username: string | null;
  is_follower: boolean | null;
  client_classification: ClientClassification;
  classification_date: string | null;
  became_client_date: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  // Follow-up tracking fields
  followup_count: number | null;
  last_followup_at: string | null;
  first_visit_at: string | null;
  first_meeting_at: string | null;
  // Kanban board
  board_id: string | null;
  // News link
  news_link: string | null;
  // Attribution
  created_by: string | null;
  updated_by: string | null;
  // Accident fields
  victim_name: string | null;
  victim_age: number | null;
  case_type: string | null;
  accident_date: string | null;
  acolhedor: string | null;
  visit_state: string | null;
  visit_city: string | null;
  visit_region: string | null;
  visit_address: string | null;
  accident_address: string | null;
  damage_description: string | null;
  contractor_company: string | null;
  main_company: string | null;
  sector: string | null;
  company_size_justification: string | null;
  liability_type: string | null;
  legal_viability: string | null;
  group_link: string | null;
  lead_status: LeadBusinessStatus;
  product_service_id: string | null;
  whatsapp_group_id: string | null;
  last_edit_summary: string | null;
  expected_birth_date: string | null;
  case_number: string | null;
  in_progress_date: string | null;
  ctwa_context: any | null;
  action_source: string | null;
  action_source_detail: string | null;
  lead_status_reason: string | null;
  lead_status_changed_at: string | null;
  cac: number | null;
  inviavel_date: string | null;
}

export interface LeadStats {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  notQualified: number;
  converted: number;
  lost: number;
  comment: number;
  totalSpent: number;
  totalRevenue: number;
  costPerLead: number;
  costPerConvertedLead: number;
  conversionRate: number;
  qualificationRate: number;
}

const getReadableErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object') {
    const typedError = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    const parts = [typedError.message, typedError.details, typedError.hint]
      .filter((part): part is string => Boolean(part && part.trim()))
      .map((part) => part.trim());

    if (parts.length > 0) {
      return parts.join(' • ');
    }

    if (typedError.code) {
      return `${fallback} (${typedError.code})`;
    }
  }

  return fallback;
};

export const useLeads = (adAccountId?: string) => {
  const { user } = useAuthContext();
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
    comment: 0,
    totalSpent: 0,
    totalRevenue: 0,
    costPerLead: 0,
    costPerConvertedLead: 0,
    conversionRate: 0,
    qualificationRate: 0,
  });

  const fetchLeads = useCallback(async (retryCount = 0) => {
    setLoading(true);
    try {
      // Paginated fetch to avoid timeouts on large datasets
      let allData: any[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let query = supabase
          .from('leads')
          .select(LEAD_SELECT_COLUMNS)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (adAccountId) {
          query = query.eq('ad_account_id', adAccountId);
        }

        const { data, error } = await query;

        if (error) throw error;

        if (data && data.length > 0) {
          allData = allData.concat(data);
          hasMore = data.length === PAGE_SIZE;
          page++;
        } else {
          hasMore = false;
        }
      }

      console.log(`✅ Leads carregados: ${allData.length} (${page} página(s))`);

      const typedLeads = allData as Lead[];
      setLeads(typedLeads);
      calculateStats(typedLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
      // Retry up to 2 times with increasing delay
      if (retryCount < 2) {
        console.log(`🔄 Retry ${retryCount + 1}/2 em ${(retryCount + 1) * 2}s...`);
        setTimeout(() => fetchLeads(retryCount + 1), (retryCount + 1) * 2000);
        return;
      }
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
    const comment = leadsData.filter(l => l.status === 'comment').length;

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
      comment,
      totalSpent,
      totalRevenue,
      costPerLead,
      costPerConvertedLead,
      conversionRate,
      qualificationRate,
    });
  };

  const addLead = async (lead: Partial<Lead>, testEventCode?: string) => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .insert([{
          ...lead,
          ad_account_id: adAccountId || lead.ad_account_id,
          created_by: user?.id,
          updated_by: user?.id,
        }])
        .select()
        .single();

      if (error) throw error;

      const newLead = data as Lead;

      // Send Lead event to Facebook CAPI
      facebookCAPI.sendLeadEvent({
        leadId: newLead.id,
        email: newLead.lead_email || undefined,
        phone: newLead.lead_phone || undefined,
        name: newLead.lead_name || undefined,
        campaignName: newLead.campaign_name || undefined,
        value: newLead.conversion_value || 0,
      }, testEventCode).then(result => {
        if (result.success) {
          console.log('CAPI: Lead event sent', testEventCode ? '(test mode)' : '');
        } else {
          console.warn('CAPI: Failed to send lead event', result.error);
        }
      });

      toast.success('Lead adicionado com sucesso');
      fetchLeads();
      return newLead;
    } catch (error) {
      console.error('Error adding lead:', error);
      toast.error(getReadableErrorMessage(error, 'Erro ao adicionar lead'));
      throw error;
    }
  };

  const updateLead = async (id: string, updates: Partial<Lead>, editSummary?: string) => {
    try {
      // Auto-set timestamps based on status
      const timestampUpdates: Record<string, any> = { ...updates };
      if (updates.status === 'qualified' && !updates.qualified_at) {
        timestampUpdates.qualified_at = new Date().toISOString();
      }
      if (updates.status === 'converted' && !updates.converted_at) {
        timestampUpdates.converted_at = new Date().toISOString();
      }
      
      // Track who updated
      if (user?.id) {
        timestampUpdates.updated_by = user.id;
      }
      if (editSummary) {
        timestampUpdates.last_edit_summary = editSummary;
      }

      const { data, error } = await supabase
        .from('leads')
        .update(timestampUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const updatedLead = data as Lead;

      // Optimistic local update - avoids full reload lag
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updatedLead } : l));

      // Send CAPI events based on status change
      if (updates.status === 'qualified') {
        facebookCAPI.sendQualifiedLeadEvent({
          leadId: id,
          email: updatedLead.lead_email || undefined,
          phone: updatedLead.lead_phone || undefined,
          name: updatedLead.lead_name || undefined,
          value: updatedLead.conversion_value || 0,
        }).then(result => {
          if (result.success) {
            console.log('CAPI: Qualified lead event sent');
          } else {
            console.warn('CAPI: Failed to send qualified event', result.error);
          }
        });
      }

      if (updates.status === 'converted') {
        facebookCAPI.sendPurchaseEvent({
          leadId: id,
          email: updatedLead.lead_email || undefined,
          phone: updatedLead.lead_phone || undefined,
          name: updatedLead.lead_name || undefined,
          value: updatedLead.conversion_value || 0,
        }).then(result => {
          if (result.success) {
            console.log('CAPI: Purchase event sent');
          } else {
            console.warn('CAPI: Failed to send purchase event', result.error);
          }
        });
      }

      toast.success('Lead atualizado com sucesso');
      return updatedLead;
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

  // Sincronizar status do lead com o Facebook
  const syncLeadWithFacebook = async (leadId: string, status: LeadStatus, accessToken?: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
      console.error('Lead não encontrado');
      return { success: false, error: 'Lead não encontrado' };
    }

    if (!lead.facebook_lead_id) {
      console.log('Lead sem Facebook Lead ID, não sincronizando');
      return { success: false, error: 'Lead sem Facebook Lead ID', code: 'NO_FACEBOOK_LEAD_ID' };
    }

    if (!accessToken) {
      console.log('Access token não fornecido');
      return { success: false, error: 'Access token não configurado', code: 'NO_ACCESS_TOKEN' };
    }

    try {
      // Atualiza status local para "syncing"
      await supabase
        .from('leads')
        .update({ sync_status: 'syncing' })
        .eq('id', leadId);

      const { data, error } = await cloudFunctions.invoke('sync-lead-status', {
        body: {
          leadId,
          facebookLeadId: lead.facebook_lead_id,
          status,
          accessToken
        }
      });

      if (error) throw error;

      if (data.success) {
        // Atualiza status de sincronização
        await supabase
          .from('leads')
          .update({ 
            sync_status: 'synced',
            last_sync_at: new Date().toISOString()
          })
          .eq('id', leadId);

        toast.success('Status sincronizado com o Facebook');
        fetchLeads();
        return { success: true };
      } else {
        await supabase
          .from('leads')
          .update({ sync_status: 'error' })
          .eq('id', leadId);

        return { success: false, error: data.error, code: data.code };
      }
    } catch (error) {
      console.error('Erro ao sincronizar com Facebook:', error);
      
      await supabase
        .from('leads')
        .update({ sync_status: 'error' })
        .eq('id', leadId);

      return { success: false, error: 'Erro ao sincronizar' };
    }
  };

  // Atualiza status e sincroniza com Facebook
  const updateLeadStatusAndSync = async (
    id: string, 
    status: LeadStatus, 
    conversionValue?: number,
    accessToken?: string
  ) => {
    // Primeiro atualiza localmente
    const result = await updateLeadStatus(id, status, conversionValue);
    
    // Depois tenta sincronizar com Facebook (se tiver token)
    if (accessToken) {
      const syncResult = await syncLeadWithFacebook(id, status, accessToken);
      if (!syncResult.success && syncResult.code !== 'NO_FACEBOOK_LEAD_ID') {
        toast.warning('Status atualizado localmente, mas falha ao sincronizar com Facebook');
      }
    }
    
    return result;
  };

  const toggleFollower = async (leadId: string, isFollower: boolean) => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({ is_follower: isFollower })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev =>
        prev.map(lead =>
          lead.id === leadId ? { ...lead, is_follower: isFollower } : lead
        )
      );

      toast.success(isFollower ? 'Marcado como seguidor' : 'Marcado como não seguidor');
    } catch (error) {
      console.error('Error updating follower status:', error);
      toast.error('Erro ao atualizar status de seguidor');
    }
  };

  const updateClientClassification = async (leadId: string, classification: ClientClassification) => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({ client_classification: classification })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev =>
        prev.map(lead =>
          lead.id === leadId ? { ...lead, client_classification: classification } : lead
        )
      );

      const labels: Record<string, string> = {
        client: 'Cliente',
        non_client: 'Não-Cliente',
        prospect: 'Prospect',
      };
      
      toast.success(classification ? `Classificado como ${labels[classification]}` : 'Classificação removida');
    } catch (error) {
      console.error('Error updating client classification:', error);
      toast.error('Erro ao atualizar classificação');
    }
  };

  // Debounced realtime - prevents cascade re-fetches when multiple leads update rapidly
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchLeads();

    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        () => {
          // Debounce: wait 3s after last event before re-fetching
          if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
          realtimeTimerRef.current = setTimeout(() => {
            console.log('🔄 Realtime: atualizando leads...');
            fetchLeads();
          }, 3000);
        }
      )
      .subscribe();

    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
      supabase.removeChannel(channel);
    };
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
    updateLeadStatusAndSync,
    syncLeadWithFacebook,
    toggleFollower,
    updateClientClassification,
  };
};

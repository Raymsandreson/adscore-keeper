import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type FollowupType = 'whatsapp' | 'call' | 'email' | 'visit' | 'meeting';
export type FollowupOutcome = 'positive' | 'neutral' | 'negative' | 'no_answer';

export interface LeadFollowup {
  id: string;
  lead_id: string;
  followup_date: string;
  followup_type: FollowupType;
  notes: string | null;
  outcome: FollowupOutcome | null;
  created_at: string;
}

export interface FollowupStats {
  totalFollowups: number;
  avgFollowupsToConversion: number;
  avgDaysBetweenFollowups: number;
  conversionByFollowupCount: { count: number; total: number; converted: number; rate: number }[];
  byType: Record<FollowupType, number>;
  byOutcome: Record<FollowupOutcome, number>;
}

const FOLLOWUP_TYPE_CONFIG: Record<FollowupType, { label: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  call: { label: 'Ligação', icon: '📞' },
  email: { label: 'E-mail', icon: '📧' },
  visit: { label: 'Visita', icon: '🏠' },
  meeting: { label: 'Reunião', icon: '🤝' },
};

const FOLLOWUP_OUTCOME_CONFIG: Record<FollowupOutcome, { label: string; color: string }> = {
  positive: { label: 'Positivo', color: 'bg-green-500' },
  neutral: { label: 'Neutro', color: 'bg-yellow-500' },
  negative: { label: 'Negativo', color: 'bg-red-500' },
  no_answer: { label: 'Sem resposta', color: 'bg-gray-500' },
};

export { FOLLOWUP_TYPE_CONFIG, FOLLOWUP_OUTCOME_CONFIG };

export const useLeadFollowups = () => {
  const [followups, setFollowups] = useState<LeadFollowup[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFollowupsForLead = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lead_followups')
        .select('*')
        .eq('lead_id', leadId)
        .order('followup_date', { ascending: false });

      if (error) throw error;
      setFollowups((data || []) as LeadFollowup[]);
      return data as LeadFollowup[];
    } catch (error) {
      console.error('Error fetching followups:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const addFollowup = async (
    leadId: string,
    type: FollowupType,
    outcome?: FollowupOutcome,
    notes?: string
  ) => {
    try {
      const { data, error } = await supabase
        .from('lead_followups')
        .insert([{
          lead_id: leadId,
          followup_type: type,
          outcome: outcome || null,
          notes: notes || null,
          followup_date: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      // Update lead's followup_count and last_followup_at
      const { data: countData } = await supabase
        .from('lead_followups')
        .select('id', { count: 'exact' })
        .eq('lead_id', leadId);

      await supabase
        .from('leads')
        .update({
          followup_count: countData?.length || 0,
          last_followup_at: new Date().toISOString(),
        })
        .eq('id', leadId);

      toast.success('Follow-up registrado');
      return data as LeadFollowup;
    } catch (error) {
      console.error('Error adding followup:', error);
      toast.error('Erro ao registrar follow-up');
      throw error;
    }
  };

  const quickAddFollowup = async (leadId: string) => {
    return addFollowup(leadId, 'whatsapp');
  };

  const deleteFollowup = async (followupId: string, leadId: string) => {
    try {
      const { error } = await supabase
        .from('lead_followups')
        .delete()
        .eq('id', followupId);

      if (error) throw error;

      // Update lead's followup_count
      const { data: countData } = await supabase
        .from('lead_followups')
        .select('id', { count: 'exact' })
        .eq('lead_id', leadId);

      const { data: lastFollowup } = await supabase
        .from('lead_followups')
        .select('followup_date')
        .eq('lead_id', leadId)
        .order('followup_date', { ascending: false })
        .limit(1)
        .single();

      await supabase
        .from('leads')
        .update({
          followup_count: countData?.length || 0,
          last_followup_at: lastFollowup?.followup_date || null,
        })
        .eq('id', leadId);

      toast.success('Follow-up removido');
    } catch (error) {
      console.error('Error deleting followup:', error);
      toast.error('Erro ao remover follow-up');
    }
  };

  return {
    followups,
    loading,
    fetchFollowupsForLead,
    addFollowup,
    quickAddFollowup,
    deleteFollowup,
  };
};

// Separate hook for analytics
export const useFollowupAnalytics = () => {
  const [stats, setStats] = useState<FollowupStats | null>(null);
  const [loading, setLoading] = useState(false);

  const calculateStats = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all followups with lead data
      const { data: followupsData, error: followupsError } = await supabase
        .from('lead_followups')
        .select('*')
        .order('followup_date', { ascending: true });

      if (followupsError) throw followupsError;

      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, status, followup_count, converted_at, created_at');

      if (leadsError) throw leadsError;

      const followups = (followupsData || []) as LeadFollowup[];
      const leads = leadsData || [];

      // Calculate total followups
      const totalFollowups = followups.length;

      // Calculate by type
      const byType = followups.reduce((acc, f) => {
        const type = f.followup_type as FollowupType;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<FollowupType, number>);

      // Calculate by outcome
      const byOutcome = followups.reduce((acc, f) => {
        if (f.outcome) {
          acc[f.outcome as FollowupOutcome] = (acc[f.outcome as FollowupOutcome] || 0) + 1;
        }
        return acc;
      }, {} as Record<FollowupOutcome, number>);

      // Calculate conversion by followup count
      const leadsByFollowupCount = new Map<number, { total: number; converted: number }>();
      leads.forEach(lead => {
        const count = (lead as any).followup_count || 0;
        if (!leadsByFollowupCount.has(count)) {
          leadsByFollowupCount.set(count, { total: 0, converted: 0 });
        }
        const entry = leadsByFollowupCount.get(count)!;
        entry.total++;
        if ((lead as any).status === 'converted') {
          entry.converted++;
        }
      });

      const conversionByFollowupCount = Array.from(leadsByFollowupCount.entries())
        .map(([count, data]) => ({
          count,
          total: data.total,
          converted: data.converted,
          rate: data.total > 0 ? (data.converted / data.total) * 100 : 0,
        }))
        .sort((a, b) => a.count - b.count);

      // Calculate average followups to conversion
      const convertedLeads = leads.filter((l: any) => l.status === 'converted' && l.followup_count > 0);
      const avgFollowupsToConversion = convertedLeads.length > 0
        ? convertedLeads.reduce((sum: number, l: any) => sum + (l.followup_count || 0), 0) / convertedLeads.length
        : 0;

      // Calculate average days between followups
      const followupsByLead = new Map<string, Date[]>();
      followups.forEach(f => {
        if (!followupsByLead.has(f.lead_id)) {
          followupsByLead.set(f.lead_id, []);
        }
        followupsByLead.get(f.lead_id)!.push(new Date(f.followup_date));
      });

      let totalDays = 0;
      let intervalCount = 0;
      followupsByLead.forEach(dates => {
        if (dates.length > 1) {
          dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < dates.length; i++) {
            const diffDays = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
            totalDays += diffDays;
            intervalCount++;
          }
        }
      });
      const avgDaysBetweenFollowups = intervalCount > 0 ? totalDays / intervalCount : 0;

      setStats({
        totalFollowups,
        avgFollowupsToConversion,
        avgDaysBetweenFollowups,
        conversionByFollowupCount,
        byType,
        byOutcome,
      });
    } catch (error) {
      console.error('Error calculating stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    stats,
    loading,
    calculateStats,
  };
};

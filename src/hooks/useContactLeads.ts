import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ContactLead {
  id: string;
  contact_id: string;
  lead_id: string;
  notes: string | null;
  created_at: string;
  lead?: {
    id: string;
    lead_name: string | null;
    lead_phone: string | null;
    lead_email: string | null;
    status: string | null;
    city: string | null;
    state: string | null;
    board_id: string | null;
  };
}

export interface ContactWithLeads {
  id: string;
  full_name: string;
  leads: ContactLead[];
}

// Hook to get all leads linked to a specific contact
export const useContactLeads = (contactId?: string) => {
  const [leads, setLeads] = useState<ContactLead[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeads = useCallback(async () => {
    if (!contactId) {
      setLeads([]);
      return;
    }

    setLoading(true);
    try {
      // First get the contact_leads entries
      const { data: linkData, error: linkError } = await supabase
        .from('contact_leads' as any)
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      if (linkError) throw linkError;

      // Then fetch associated leads
      const links = (linkData || []) as any[];
      const leadIds = links.map(l => l.lead_id);
      
      if (leadIds.length === 0) {
        setLeads([]);
        setLoading(false);
        return;
      }

      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, lead_email, status, city, state, board_id')
        .in('id', leadIds);

      if (leadsError) throw leadsError;

      const leadsMap = new Map((leadsData || []).map(l => [l.id, l]));
      
      const enrichedLeads: ContactLead[] = links.map(link => ({
        id: link.id,
        contact_id: link.contact_id,
        lead_id: link.lead_id,
        notes: link.notes,
        created_at: link.created_at,
        lead: leadsMap.get(link.lead_id)
      }));

      setLeads(enrichedLeads);
    } catch (error) {
      console.error('Error fetching contact leads:', error);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const linkLead = async (leadId: string, notes?: string) => {
    if (!contactId) return;

    try {
      const { error } = await supabase
        .from('contact_leads' as any)
        .insert({
          contact_id: contactId,
          lead_id: leadId,
          notes: notes || null
        });

      if (error) {
        if (error.code === '23505') {
          toast.error('Este lead já está vinculado ao contato');
          return;
        }
        throw error;
      }

      toast.success('Lead vinculado ao contato');
      fetchLeads();
    } catch (error) {
      console.error('Error linking lead:', error);
      toast.error('Erro ao vincular lead');
    }
  };

  const unlinkLead = async (leadId: string) => {
    if (!contactId) return;

    try {
      const { error } = await supabase
        .from('contact_leads' as any)
        .delete()
        .eq('contact_id', contactId)
        .eq('lead_id', leadId);

      if (error) throw error;

      toast.success('Lead desvinculado');
      fetchLeads();
    } catch (error) {
      console.error('Error unlinking lead:', error);
      toast.error('Erro ao desvincular lead');
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  return {
    leads,
    loading,
    fetchLeads,
    linkLead,
    unlinkLead
  };
};

// Hook to get lead counts for multiple contacts
export const useContactLeadCounts = (contactIds: string[]) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchCounts = async () => {
      if (contactIds.length === 0) {
        setCounts({});
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('contact_leads' as any)
          .select('contact_id')
          .in('contact_id', contactIds);

        if (error) throw error;

        const countMap: Record<string, number> = {};
        (((data || []) as unknown) as { contact_id: string }[]).forEach((item) => {
          countMap[item.contact_id] = (countMap[item.contact_id] || 0) + 1;
        });
        setCounts(countMap);
      } catch (error) {
        console.error('Error fetching contact lead counts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCounts();
  }, [contactIds.join(',')]);

  return { counts, loading };
};

// Hook to search for leads to link
export const useSearchLeads = () => {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const searchLeads = async (query: string, excludeIds: string[] = []) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      let queryBuilder = supabase
        .from('leads')
        .select('id, lead_name, lead_phone, lead_email, status, city, state')
        .or(`lead_name.ilike.%${query}%,lead_phone.ilike.%${query}%,lead_email.ilike.%${query}%`)
        .limit(10);

      if (excludeIds.length > 0) {
        queryBuilder = queryBuilder.not('id', 'in', `(${excludeIds.join(',')})`);
      }

      const { data, error } = await queryBuilder;

      if (error) throw error;
      setResults(data || []);
    } catch (error) {
      console.error('Error searching leads:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return { results, loading, searchLeads };
};

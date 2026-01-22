import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BridgeContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  classifications: string[] | null;
  matchType: 'same_neighborhood' | 'same_city' | 'same_state';
  matchScore: number;
}

export interface BridgeSuggestion {
  contact: BridgeContact;
  leadName: string;
  leadId: string;
  reason: string;
}

// Hook to find potential bridges between contacts based on location
export const useContactBridges = () => {
  const [suggestions, setSuggestions] = useState<BridgeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  // Find contacts that could be bridges to a specific lead based on location
  const findBridgesForLead = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      // First, get the lead's location info
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, lead_name, city, state, neighborhood')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        console.error('Error fetching lead:', leadError);
        setSuggestions([]);
        return [];
      }

      if (!lead.city && !lead.state) {
        // No location data to match against
        setSuggestions([]);
        return [];
      }

      // Find contacts in the same location that are NOT already linked to this lead
      let query = supabase
        .from('contacts')
        .select('id, full_name, phone, email, instagram_username, city, state, neighborhood, classifications')
        .limit(50);

      // Build location filter
      const filters: string[] = [];
      
      if (lead.neighborhood && lead.city) {
        filters.push(`neighborhood.ilike.%${lead.neighborhood}%`);
      }
      if (lead.city) {
        filters.push(`city.ilike.%${lead.city}%`);
      }
      if (lead.state) {
        filters.push(`state.eq.${lead.state}`);
      }

      if (filters.length > 0) {
        query = query.or(filters.join(','));
      }

      const { data: contacts, error: contactsError } = await query;

      if (contactsError) {
        console.error('Error fetching contacts:', contactsError);
        setSuggestions([]);
        return [];
      }

      // Get already linked contacts
      const { data: linkedContacts } = await supabase
        .from('contact_leads' as any)
        .select('contact_id')
        .eq('lead_id', leadId);

      const linkedIds = new Set((((linkedContacts || []) as unknown) as { contact_id: string }[]).map((c) => c.contact_id));

      // Score and filter contacts
      const bridgeContacts: BridgeSuggestion[] = (contacts || [])
        .filter((c: any) => !linkedIds.has(c.id))
        .map((contact: any) => {
          let matchType: 'same_neighborhood' | 'same_city' | 'same_state' = 'same_state';
          let matchScore = 0;
          let reason = '';

          // Calculate match score
          if (lead.neighborhood && contact.neighborhood && 
              contact.neighborhood.toLowerCase().includes(lead.neighborhood.toLowerCase())) {
            matchType = 'same_neighborhood';
            matchScore = 100;
            reason = `Mesmo bairro: ${contact.neighborhood}`;
          } else if (lead.city && contact.city && 
                     contact.city.toLowerCase() === lead.city.toLowerCase()) {
            matchType = 'same_city';
            matchScore = 70;
            reason = `Mesma cidade: ${contact.city}`;
          } else if (lead.state && contact.state === lead.state) {
            matchType = 'same_state';
            matchScore = 30;
            reason = `Mesmo estado: ${contact.state}`;
          }

          // Boost score for contacts with classifications indicating relationships
          if (contact.classifications?.includes('client')) {
            matchScore += 20;
            reason += ' (Cliente)';
          } else if (contact.classifications?.includes('partner')) {
            matchScore += 15;
            reason += ' (Parceiro)';
          }

          return {
            contact: {
              ...contact,
              matchType,
              matchScore
            },
            leadName: lead.lead_name || 'Lead sem nome',
            leadId: lead.id,
            reason
          };
        })
        .filter((s: BridgeSuggestion) => s.contact.matchScore > 0)
        .sort((a: BridgeSuggestion, b: BridgeSuggestion) => b.contact.matchScore - a.contact.matchScore)
        .slice(0, 10);

      setSuggestions(bridgeContacts);
      return bridgeContacts;
    } catch (error) {
      console.error('Error finding bridges:', error);
      setSuggestions([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Find bridges for a contact - suggests leads they could be connected to
  const findBridgesForContact = useCallback(async (contactId: string) => {
    setLoading(true);
    try {
      // Get the contact's location info
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id, full_name, city, state, neighborhood')
        .eq('id', contactId)
        .single();

      if (contactError || !contact) {
        console.error('Error fetching contact:', contactError);
        setSuggestions([]);
        return [];
      }

      if (!contact.city && !contact.state) {
        setSuggestions([]);
        return [];
      }

      // Find leads in the same location
      let query = supabase
        .from('leads')
        .select('id, lead_name, lead_phone, city, state, neighborhood')
        .limit(50);

      const filters: string[] = [];
      
      if (contact.neighborhood && contact.city) {
        filters.push(`neighborhood.ilike.%${contact.neighborhood}%`);
      }
      if (contact.city) {
        filters.push(`city.ilike.%${contact.city}%`);
      }
      if (contact.state) {
        filters.push(`state.eq.${contact.state}`);
      }

      if (filters.length > 0) {
        query = query.or(filters.join(','));
      }

      const { data: leads, error: leadsError } = await query;

      if (leadsError) {
        console.error('Error fetching leads:', leadsError);
        setSuggestions([]);
        return [];
      }

      // Get already linked leads
      const { data: linkedLeads } = await supabase
        .from('contact_leads' as any)
        .select('lead_id')
        .eq('contact_id', contactId);

      const linkedIds = new Set((((linkedLeads || []) as unknown) as { lead_id: string }[]).map((l) => l.lead_id));

      // Score and filter leads
      const bridgeLeads: BridgeSuggestion[] = (leads || [])
        .filter((l: any) => !linkedIds.has(l.id))
        .map((lead: any) => {
          let matchType: 'same_neighborhood' | 'same_city' | 'same_state' = 'same_state';
          let matchScore = 0;
          let reason = '';

          if (contact.neighborhood && lead.neighborhood && 
              lead.neighborhood.toLowerCase().includes(contact.neighborhood.toLowerCase())) {
            matchType = 'same_neighborhood';
            matchScore = 100;
            reason = `Mesmo bairro: ${lead.neighborhood}`;
          } else if (contact.city && lead.city && 
                     lead.city.toLowerCase() === contact.city.toLowerCase()) {
            matchType = 'same_city';
            matchScore = 70;
            reason = `Mesma cidade: ${lead.city}`;
          } else if (contact.state && lead.state === contact.state) {
            matchType = 'same_state';
            matchScore = 30;
            reason = `Mesmo estado: ${lead.state}`;
          }

          return {
            contact: {
              id: lead.id,
              full_name: lead.lead_name || 'Lead sem nome',
              phone: lead.lead_phone,
              email: null,
              instagram_username: null,
              city: lead.city,
              state: lead.state,
              neighborhood: lead.neighborhood,
              classifications: null,
              matchType,
              matchScore
            },
            leadName: lead.lead_name || 'Lead sem nome',
            leadId: lead.id,
            reason
          };
        })
        .filter((s: BridgeSuggestion) => s.contact.matchScore > 0)
        .sort((a: BridgeSuggestion, b: BridgeSuggestion) => b.contact.matchScore - a.contact.matchScore)
        .slice(0, 10);

      setSuggestions(bridgeLeads);
      return bridgeLeads;
    } catch (error) {
      console.error('Error finding bridges:', error);
      setSuggestions([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    suggestions,
    loading,
    findBridgesForLead,
    findBridgesForContact
  };
};

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ContactInfo {
  id: string;
  full_name: string;
  instagram_username: string | null;
  phone: string | null;
  email: string | null;
}

interface LeadInfo {
  id: string;
  lead_name: string | null;
  status: string | null;
  board_id: string | null;
}

interface RelationshipInfo {
  id: string;
  relationship_type: string;
  related_contact: {
    id: string;
    full_name: string;
    instagram_username: string | null;
    phone: string | null;
  };
}

export interface CommentContactData {
  contact: ContactInfo | null;
  linkedLeads: LeadInfo[];
  relationships: RelationshipInfo[];
  loading: boolean;
}

export const useCommentContactInfo = (instagramUsernames: string[]) => {
  const [contactsData, setContactsData] = useState<Record<string, CommentContactData>>({});

  const fetchContactInfo = useCallback(async (usernames: string[]) => {
    if (usernames.length === 0) return;

    // Normalize usernames (remove @)
    const normalizedUsernames = usernames.map(u => u.replace('@', '').toLowerCase());
    
    // Initialize loading state
    const loadingState: Record<string, CommentContactData> = {};
    normalizedUsernames.forEach(username => {
      if (!contactsData[username]) {
        loadingState[username] = { contact: null, linkedLeads: [], relationships: [], loading: true };
      }
    });
    
    if (Object.keys(loadingState).length > 0) {
      setContactsData(prev => ({ ...prev, ...loadingState }));
    }

    try {
      // Fetch contacts by instagram_username
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, full_name, instagram_username, phone, email')
        .in('instagram_username', normalizedUsernames.map(u => `@${u}`));

      if (contactsError) throw contactsError;

      const contactMap = new Map<string, ContactInfo>();
      const contactIds: string[] = [];
      
      contacts?.forEach(contact => {
        const username = contact.instagram_username?.replace('@', '').toLowerCase();
        if (username) {
          contactMap.set(username, contact);
          contactIds.push(contact.id);
        }
      });

      // Fetch linked leads for these contacts using raw query approach
      let leadsByContact: Record<string, LeadInfo[]> = {};
      if (contactIds.length > 0) {
        // Use supabase client with type assertion
        const supabaseAny = supabase as any;
        const { data: contactLeads, error: leadsError } = await supabaseAny
          .from('contact_leads')
          .select('contact_id, lead_id')
          .in('contact_id', contactIds);

        if (!leadsError && contactLeads && contactLeads.length > 0) {
          const leadIds = contactLeads.map((cl: any) => cl.lead_id);
          
          const { data: leads } = await supabase
            .from('leads')
            .select('id, lead_name, status, board_id')
            .in('id', leadIds);

          if (leads) {
            contactLeads.forEach((cl: any) => {
              const lead = leads.find(l => l.id === cl.lead_id);
              if (lead) {
                if (!leadsByContact[cl.contact_id]) {
                  leadsByContact[cl.contact_id] = [];
                }
                leadsByContact[cl.contact_id].push(lead);
              }
            });
          }
        }
      }

      // Fetch relationships for these contacts
      let relationshipsByContact: Record<string, RelationshipInfo[]> = {};
      if (contactIds.length > 0) {
        const { data: relationships, error: relError } = await supabase
          .from('contact_relationships')
          .select('id, contact_id, related_contact_id, relationship_type')
          .or(`contact_id.in.(${contactIds.join(',')}),related_contact_id.in.(${contactIds.join(',')})`);

        if (!relError && relationships && relationships.length > 0) {
          // Get all related contact IDs
          const relatedIds = new Set<string>();
          relationships.forEach(rel => {
            relatedIds.add(rel.contact_id);
            relatedIds.add(rel.related_contact_id);
          });

          const { data: relatedContacts } = await supabase
            .from('contacts')
            .select('id, full_name, instagram_username, phone')
            .in('id', Array.from(relatedIds));

          if (relatedContacts) {
            const relatedMap = new Map(relatedContacts.map(c => [c.id, c]));

            relationships.forEach(rel => {
              // Determine which contact is "ours" and which is "related"
              const isOutgoing = contactIds.includes(rel.contact_id);
              const ourContactId = isOutgoing ? rel.contact_id : rel.related_contact_id;
              const relatedContactId = isOutgoing ? rel.related_contact_id : rel.contact_id;
              
              const relatedContact = relatedMap.get(relatedContactId);
              if (relatedContact) {
                if (!relationshipsByContact[ourContactId]) {
                  relationshipsByContact[ourContactId] = [];
                }
                relationshipsByContact[ourContactId].push({
                  id: rel.id,
                  relationship_type: rel.relationship_type,
                  related_contact: relatedContact
                });
              }
            });
          }
        }
      }

      // Build final data
      const newData: Record<string, CommentContactData> = {};
      normalizedUsernames.forEach(username => {
        const contact = contactMap.get(username);
        newData[username] = {
          contact: contact || null,
          linkedLeads: contact ? (leadsByContact[contact.id] || []) : [],
          relationships: contact ? (relationshipsByContact[contact.id] || []) : [],
          loading: false
        };
      });

      setContactsData(prev => ({ ...prev, ...newData }));
    } catch (error) {
      console.error('Error fetching contact info:', error);
      // Set loading to false on error
      const errorState: Record<string, CommentContactData> = {};
      normalizedUsernames.forEach(username => {
        errorState[username] = { contact: null, linkedLeads: [], relationships: [], loading: false };
      });
      setContactsData(prev => ({ ...prev, ...errorState }));
    }
  }, []);

  useEffect(() => {
    const uniqueUsernames = [...new Set(instagramUsernames.filter(Boolean))];
    const unloadedUsernames = uniqueUsernames.filter(u => {
      const normalized = u.replace('@', '').toLowerCase();
      return !contactsData[normalized];
    });
    
    if (unloadedUsernames.length > 0) {
      fetchContactInfo(unloadedUsernames);
    }
  }, [instagramUsernames, fetchContactInfo]);

  const getContactData = useCallback((username: string | null): CommentContactData => {
    if (!username) return { contact: null, linkedLeads: [], relationships: [], loading: false };
    const normalized = username.replace('@', '').toLowerCase();
    return contactsData[normalized] || { contact: null, linkedLeads: [], relationships: [], loading: false };
  }, [contactsData]);

  const refetch = useCallback(() => {
    const usernames = Object.keys(contactsData);
    if (usernames.length > 0) {
      setContactsData({});
      fetchContactInfo(usernames);
    }
  }, [contactsData, fetchContactInfo]);

  return { getContactData, refetch };
};

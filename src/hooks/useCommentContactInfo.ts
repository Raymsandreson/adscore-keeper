import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ContactInfo {
  id: string;
  full_name: string;
  instagram_username: string | null;
  phone: string | null;
  email: string | null;
  classifications: string[] | null;
  follower_status: string | null;
  updated_at: string | null;
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
  const loadedUsernamesRef = useRef<Set<string>>(new Set());

  const fetchContactInfo = useCallback(async (usernames: string[], forceRefresh = false) => {
    if (usernames.length === 0) return;

    // Normalize usernames (remove @)
    const normalizedUsernames = usernames.map(u => u.replace('@', '').toLowerCase());
    
    // Filter out already loaded usernames unless forcing refresh
    const usernamesToFetch = forceRefresh 
      ? normalizedUsernames 
      : normalizedUsernames.filter(u => !loadedUsernamesRef.current.has(u));
    
    if (usernamesToFetch.length === 0) return;
    
    // Mark as loading
    usernamesToFetch.forEach(u => loadedUsernamesRef.current.add(u));
    
    // Initialize loading state
    setContactsData(prev => {
      const loadingState: Record<string, CommentContactData> = { ...prev };
      usernamesToFetch.forEach(username => {
        loadingState[username] = { contact: null, linkedLeads: [], relationships: [], loading: true };
      });
      return loadingState;
    });

    try {
      // Fetch contacts by instagram_username - try both with and without @
      // Also use ILIKE for case-insensitive matching
      const usernamesWithAt = usernamesToFetch.map(u => `@${u}`);
      const usernamesWithoutAt = usernamesToFetch;
      const allUsernamesToSearch = [...usernamesWithAt, ...usernamesWithoutAt];
      
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, full_name, instagram_username, phone, email, classifications, follower_status, updated_at')
        .in('instagram_username', allUsernamesToSearch);

      if (contactsError) throw contactsError;

      const contactIds: string[] = [];
      
      // Collect all contacts matching the username
      const contactsByUsername = new Map<string, ContactInfo[]>();
      
      contacts?.forEach(contact => {
        const username = contact.instagram_username?.replace('@', '').toLowerCase();
        if (username) {
          if (!contactsByUsername.has(username)) {
            contactsByUsername.set(username, []);
          }
          contactsByUsername.get(username)!.push(contact);
          contactIds.push(contact.id);
        }
      });

      // Fetch linked leads for these contacts
      let leadsByContact: Record<string, LeadInfo[]> = {};
      if (contactIds.length > 0) {
        const { data: contactLeads, error: leadsError } = await supabase
          .from('contact_leads')
          .select('contact_id, lead_id')
          .in('contact_id', contactIds);

        if (!leadsError && contactLeads && contactLeads.length > 0) {
          const leadIds = contactLeads.map((cl) => cl.lead_id);
          
          const { data: leads } = await supabase
            .from('leads')
            .select('id, lead_name, status, board_id')
            .in('id', leadIds);

          if (leads) {
            contactLeads.forEach((cl) => {
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

      // Build final data - for each username, prefer the contact that has classifications, leads, or relationships
      const newData: Record<string, CommentContactData> = {};
      usernamesToFetch.forEach(username => {
        const matchingContacts = contactsByUsername.get(username) || [];
        
        // Score each contact to find the best one
        // Priority: 1. Has leads, 2. Has classifications, 3. Has relationships, 4. First match
        const scoredContacts = matchingContacts.map(contact => {
          const contactLeads = leadsByContact[contact.id] || [];
          const contactRelationships = relationshipsByContact[contact.id] || [];
          const hasClassifications = contact.classifications && contact.classifications.length > 0;
          
          let score = 0;
          if (contactLeads.length > 0) score += 100; // Highest priority
          if (hasClassifications) score += 50; // Second priority
          if (contactRelationships.length > 0) score += 25; // Third priority
          
          return {
            contact,
            leads: contactLeads,
            relationships: contactRelationships,
            score
          };
        });
        
        // Sort by score descending
        scoredContacts.sort((a, b) => b.score - a.score);
        
        const bestMatch = scoredContacts[0];
        
        // Aggregate all leads and relationships from all matching contacts
        const allLeads: LeadInfo[] = [];
        const allRelationships: RelationshipInfo[] = [];
        const seenLeadIds = new Set<string>();
        const seenRelIds = new Set<string>();
        
        matchingContacts.forEach(contact => {
          (leadsByContact[contact.id] || []).forEach(lead => {
            if (!seenLeadIds.has(lead.id)) {
              seenLeadIds.add(lead.id);
              allLeads.push(lead);
            }
          });
          (relationshipsByContact[contact.id] || []).forEach(rel => {
            if (!seenRelIds.has(rel.id)) {
              seenRelIds.add(rel.id);
              allRelationships.push(rel);
            }
          });
        });
        
        newData[username] = {
          contact: bestMatch?.contact || null,
          linkedLeads: allLeads,
          relationships: allRelationships,
          loading: false
        };
      });

      setContactsData(prev => ({ ...prev, ...newData }));
    } catch (error) {
      console.error('Error fetching contact info:', error);
      // Set loading to false on error
      const errorState: Record<string, CommentContactData> = {};
      usernamesToFetch.forEach(username => {
        errorState[username] = { contact: null, linkedLeads: [], relationships: [], loading: false };
      });
      setContactsData(prev => ({ ...prev, ...errorState }));
    }
  }, []);

  useEffect(() => {
    const uniqueUsernames = [...new Set(instagramUsernames.filter(Boolean))];
    const normalizedUsernames = uniqueUsernames.map(u => u.replace('@', '').toLowerCase());
    const unloadedUsernames = normalizedUsernames.filter(u => !loadedUsernamesRef.current.has(u));
    
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
    const usernames = Array.from(loadedUsernamesRef.current);
    if (usernames.length > 0) {
      fetchContactInfo(usernames, true);
    }
  }, [fetchContactInfo]);

  const refetchUsername = useCallback((username: string | null) => {
    if (!username) return;
    const normalized = username.replace('@', '').toLowerCase();
    fetchContactInfo([normalized], true);
  }, [fetchContactInfo]);

  return { getContactData, refetch, refetchUsername };
};

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ContactClassification = 'client' | 'non_client' | 'prospect' | 'partner' | 'supplier' | null;
export type FollowerStatus = 'follower' | 'following' | 'mutual' | 'none';

export interface Contact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  instagram_url: string | null;
  classification: ContactClassification;
  notes: string | null;
  tags: string[];
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  street: string | null;
  cep: string | null;
  lead_id: string | null;
  converted_to_lead_at: string | null;
  follower_status: FollowerStatus;
  created_at: string;
  updated_at: string;
}

export interface ContactStats {
  total: number;
  clients: number;
  nonClients: number;
  prospects: number;
  partners: number;
  suppliers: number;
  withInstagram: number;
  convertedToLead: number;
}

export const useContacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ContactStats>({
    total: 0,
    clients: 0,
    nonClients: 0,
    prospects: 0,
    partners: 0,
    suppliers: 0,
    withInstagram: 0,
    convertedToLead: 0,
  });

  // Fetch contacts with server-side pagination
  const fetchContacts = useCallback(async (page = 1, pageSize = 50, filters?: {
    search?: string;
    classification?: string;
    followerStatus?: string;
  }) => {
    setLoading(true);
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply filters if provided
      if (filters?.search) {
        const search = `%${filters.search}%`;
        query = query.or(`full_name.ilike.${search},phone.ilike.${search},email.ilike.${search},instagram_username.ilike.${search}`);
      }

      if (filters?.classification && filters.classification !== 'all') {
        if (filters.classification === 'none') {
          query = query.is('classification', null);
        } else {
          query = query.eq('classification', filters.classification);
        }
      }

      if (filters?.followerStatus && filters.followerStatus !== 'all') {
        if (filters.followerStatus === 'mutual') {
          query = query.eq('follower_status', 'mutual');
        } else if (filters.followerStatus === 'seguidor') {
          query = query.in('follower_status', ['follower', 'mutual']);
        } else if (filters.followerStatus === 'seguindo') {
          query = query.in('follower_status', ['following', 'mutual']);
        }
      }

      // Apply pagination
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      const typedContacts = (data || []) as Contact[];
      setContacts(typedContacts);
      setTotalCount(count || 0);

      // Fetch stats separately (without pagination)
      await fetchStats();
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('Erro ao carregar contatos');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch stats separately for accuracy using COUNT queries to bypass default limit
  const fetchStats = async () => {
    try {
      // Use individual count queries to bypass the 1000 row limit
      const [totalRes, clientsRes, nonClientsRes, prospectsRes, partnersRes, suppliersRes, withInstagramRes, leadsRes] = await Promise.all([
        supabase.from('contacts').select('*', { count: 'exact', head: true }),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('classification', 'client'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('classification', 'non_client'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('classification', 'prospect'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('classification', 'partner'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('classification', 'supplier'),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).not('instagram_username', 'is', null),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).not('lead_id', 'is', null),
      ]);

      setStats({
        total: totalRes.count || 0,
        clients: clientsRes.count || 0,
        nonClients: nonClientsRes.count || 0,
        prospects: prospectsRes.count || 0,
        partners: partnersRes.count || 0,
        suppliers: suppliersRes.count || 0,
        withInstagram: withInstagramRes.count || 0,
        convertedToLead: leadsRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // Tag stats based on follower_status - need separate query for full dataset
  const [tagStats, setTagStats] = useState({
    seguidores: 0,
    seguindo: 0,
    mutuos: 0,
  });

  const fetchTagStats = async () => {
    try {
      // Use count queries to bypass the 1000 row limit
      const [followersRes, followingRes, mutualRes] = await Promise.all([
        supabase.from('contacts').select('*', { count: 'exact', head: true }).in('follower_status', ['follower', 'mutual']),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).in('follower_status', ['following', 'mutual']),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('follower_status', 'mutual'),
      ]);

      setTagStats({
        seguidores: followersRes.count || 0,
        seguindo: followingRes.count || 0,
        mutuos: mutualRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching tag stats:', error);
    }
  };

  // Helper to determine follower_status from tags
  const getFollowerStatusFromTags = (tags: string[] | null | undefined): FollowerStatus => {
    const hasSeguidor = tags?.includes('seguidor') || false;
    const hasSeguindo = tags?.includes('seguindo') || false;
    
    if (hasSeguidor && hasSeguindo) return 'mutual';
    if (hasSeguidor) return 'follower';
    if (hasSeguindo) return 'following';
    return 'none';
  };

  const addContact = async (contact: Partial<Contact> & { full_name: string }) => {
    try {
      // Extract Instagram username from URL if provided
      let instagramUsername = contact.instagram_username;
      if (contact.instagram_url && !instagramUsername) {
        const match = contact.instagram_url.match(/instagram\.com\/([^/?]+)/);
        if (match) {
          instagramUsername = match[1].replace('@', '');
        }
      }

      // Determine follower_status from tags
      const followerStatus = contact.follower_status || getFollowerStatusFromTags(contact.tags);

      const { data, error } = await supabase
        .from('contacts')
        .insert([{
          full_name: contact.full_name,
          phone: contact.phone || null,
          email: contact.email || null,
          instagram_username: instagramUsername || null,
          instagram_url: contact.instagram_url || null,
          classification: contact.classification || 'prospect',
          notes: contact.notes || null,
          tags: contact.tags || [],
          city: contact.city || null,
          state: contact.state || null,
          follower_status: followerStatus,
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success('Contato adicionado com sucesso');
      fetchContacts();
      return data as Contact;
    } catch (error) {
      console.error('Error adding contact:', error);
      toast.error('Erro ao adicionar contato');
      throw error;
    }
  };

  const updateContact = async (id: string, updates: Partial<Contact>) => {
    try {
      // Extract Instagram username from URL if provided
      let instagramUsername = updates.instagram_username;
      if (updates.instagram_url && !instagramUsername) {
        const match = updates.instagram_url.match(/instagram\.com\/([^/?]+)/);
        if (match) {
          instagramUsername = match[1].replace('@', '');
        }
      }

      const { data, error } = await supabase
        .from('contacts')
        .update({
          ...updates,
          instagram_username: instagramUsername ?? updates.instagram_username,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      toast.success('Contato atualizado');
      fetchContacts();
      return data as Contact;
    } catch (error) {
      console.error('Error updating contact:', error);
      toast.error('Erro ao atualizar contato');
      throw error;
    }
  };

  const deleteContact = async (id: string) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Contato removido');
      fetchContacts();
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Erro ao remover contato');
      throw error;
    }
  };

  const updateClassification = async (id: string, classification: ContactClassification) => {
    return updateContact(id, { classification });
  };

  const convertToLead = async (contactId: string, leadData?: Partial<any>) => {
    try {
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) throw new Error('Contato não encontrado');

      // Create lead from contact
      const { data: leadResult, error: leadError } = await supabase
        .from('leads')
        .insert({
          lead_name: contact.full_name,
          lead_phone: contact.phone,
          lead_email: contact.email,
          instagram_username: contact.instagram_username,
          source: 'contact_import',
          status: 'new',
          client_classification: contact.classification === 'client' ? 'client' : 
                                contact.classification === 'prospect' ? 'prospect' : null,
          city: contact.city,
          state: contact.state,
          notes: contact.notes,
          ...leadData,
        })
        .select()
        .single();

      if (leadError) throw leadError;

      // Update contact with lead reference
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          lead_id: leadResult.id,
          converted_to_lead_at: new Date().toISOString(),
        })
        .eq('id', contactId);

      if (updateError) throw updateError;

      toast.success('Contato convertido em lead');
      fetchContacts();
      return leadResult;
    } catch (error) {
      console.error('Error converting contact to lead:', error);
      toast.error('Erro ao converter contato em lead');
      throw error;
    }
  };

  const importFromCSV = async (csvData: Partial<Contact>[]) => {
    let imported = 0;
    let errors = 0;
    let duplicates = 0;

    for (const contact of csvData) {
      try {
        // Check for duplicates by phone or email or instagram
        let duplicateQuery = supabase.from('contacts').select('id');
        
        if (contact.phone) {
          duplicateQuery = duplicateQuery.eq('phone', contact.phone);
        } else if (contact.email) {
          duplicateQuery = duplicateQuery.eq('email', contact.email);
        } else if (contact.instagram_username) {
          duplicateQuery = duplicateQuery.eq('instagram_username', contact.instagram_username);
        }

        const { data: existing } = await duplicateQuery.maybeSingle();

        if (existing) {
          duplicates++;
          continue;
        }

        // Extract Instagram username from URL
        let instagramUsername = contact.instagram_username;
        if (contact.instagram_url && !instagramUsername) {
          const match = contact.instagram_url.match(/instagram\.com\/([^/?]+)/);
          if (match) {
            instagramUsername = match[1].replace('@', '');
          }
        }

        const { error } = await supabase
          .from('contacts')
          .insert({
            full_name: contact.full_name || 'Sem nome',
            phone: contact.phone,
            email: contact.email,
            instagram_username: instagramUsername,
            instagram_url: contact.instagram_url,
            classification: contact.classification || 'prospect',
            city: contact.city,
            state: contact.state,
            notes: contact.notes,
            tags: contact.tags || [],
          });

        if (error) {
          console.error('Insert error:', error);
          errors++;
        } else {
          imported++;
        }
      } catch (error) {
        console.error('Error:', error);
        errors++;
      }
    }

    fetchContacts();
    return { imported, errors, duplicates };
  };

  // Import from Meta export (JSON format with followers/following)
  // Automatically detects mutual contacts when importing a second list
  const importFromMetaExport = async (
    data: any[], 
    importType: 'followers' | 'following' | 'both', 
    classification: ContactClassification = 'prospect',
    onProgress?: (progress: { current: number; total: number; imported: number; errors: number; duplicates: number; upgradedToMutual: number }) => void
  ) => {
    let imported = 0;
    let errors = 0;
    let duplicates = 0;
    let upgradedToMutual = 0;
    const total = data.length;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      try {
        // Extract username from the item - Meta export format varies
        let username = '';
        let displayName = '';
        let profileUrl = '';

        // Handle different Meta export formats
        if (typeof item === 'string') {
          username = item.replace('@', '');
        } else if (item.string_list_data) {
          // Format: { string_list_data: [{ href: "...", value: "username", timestamp: ... }] }
          const listData = item.string_list_data[0];
          username = listData?.value || '';
          profileUrl = listData?.href || '';
        } else if (item.value) {
          username = item.value.replace('@', '');
          profileUrl = item.href || '';
        } else if (item.username) {
          username = item.username.replace('@', '');
          displayName = item.name || item.full_name || '';
        } else if (item.href) {
          const match = item.href.match(/instagram\.com\/([^/?]+)/);
          if (match) username = match[1];
          profileUrl = item.href;
        }

        if (!username) {
          // Report progress even for skipped items
          if (onProgress) {
            onProgress({ current: i + 1, total, imported, errors, duplicates, upgradedToMutual });
          }
          continue;
        }

        // Check for existing contact with this username
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, follower_status, tags')
          .eq('instagram_username', username.toLowerCase())
          .maybeSingle();

        if (existing) {
          // Check if we can upgrade to mutual
          const currentStatus = existing.follower_status as FollowerStatus;
          const newImportType = importType === 'followers' ? 'follower' : 'following';
          
          // Determine if this should become mutual
          const shouldUpgradeToMutual = 
            (currentStatus === 'follower' && newImportType === 'following') ||
            (currentStatus === 'following' && newImportType === 'follower');
          
          if (shouldUpgradeToMutual) {
            // Upgrade to mutual - update both follower_status and tags
            const currentTags = existing.tags || [];
            const newTag = importType === 'followers' ? 'seguidor' : 'seguindo';
            const updatedTags = currentTags.includes(newTag) ? currentTags : [...currentTags, newTag];
            
            const { error: updateError } = await supabase
              .from('contacts')
              .update({ 
                follower_status: 'mutual',
                tags: updatedTags
              })
              .eq('id', existing.id);
            
            if (updateError) {
              console.error('Update to mutual error:', updateError);
              errors++;
            } else {
              upgradedToMutual++;
            }
          } else {
            // Already the same type or already mutual
            duplicates++;
          }
          
          // Report progress
          if (onProgress) {
            onProgress({ current: i + 1, total, imported, errors, duplicates, upgradedToMutual });
          }
          continue;
        }

        const instagramUrl = profileUrl || `https://instagram.com/${username}`;
        const tags = [importType === 'followers' ? 'seguidor' : importType === 'following' ? 'seguindo' : 'instagram'];
        const followerStatus: FollowerStatus = importType === 'followers' ? 'follower' : importType === 'following' ? 'following' : 'none';

        const { error } = await supabase
          .from('contacts')
          .insert({
            full_name: displayName || `@${username}`,
            instagram_username: username.toLowerCase(),
            instagram_url: instagramUrl,
            classification,
            tags,
            follower_status: followerStatus,
          });

        if (error) {
          console.error('Insert error:', error);
          errors++;
        } else {
          imported++;
        }
      } catch (error) {
        console.error('Error:', error);
        errors++;
      }

      // Report progress after each item
      if (onProgress) {
        onProgress({ current: i + 1, total, imported, errors, duplicates, upgradedToMutual });
      }
    }

    fetchContacts();
    return { imported, errors, duplicates, upgradedToMutual };
  };

  useEffect(() => {
    fetchContacts();
    fetchTagStats();
  }, [fetchContacts]);

  return {
    contacts,
    totalCount,
    stats,
    tagStats,
    loading,
    fetchContacts,
    fetchStats,
    fetchTagStats,
    addContact,
    updateContact,
    deleteContact,
    updateClassification,
    convertToLead,
    importFromCSV,
    importFromMetaExport,
  };
};

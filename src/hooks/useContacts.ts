import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  classifications: string[] | null;
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
  profession: string | null;
  profession_cbo_code: string | null;
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
    professions?: string[];
    dateFrom?: string;
    dateTo?: string;
    leadLinked?: 'all' | 'linked' | 'not_linked';
    city?: string;
    state?: string;
    actionSource?: string;
    createdBy?: string;
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

      // Filter by professions (multi-select)
      if (filters?.professions && filters.professions.length > 0) {
        query = query.in('profession', filters.professions);
      }

      // Filter by created_at date range
      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters?.dateTo) {
        // Add end of day to include the full day
        query = query.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);
      }

      // Filter by lead linkage via contact_leads table
      if (filters?.leadLinked === 'linked') {
        // Get contact IDs that have entries in contact_leads
        const { data: linkedData } = await supabase
          .from('contact_leads')
          .select('contact_id');
        const linkedIds = [...new Set((linkedData || []).map((d: any) => d.contact_id))];
        if (linkedIds.length > 0) {
          query = query.in('id', linkedIds);
        } else {
          // No contacts linked, return empty
          setContacts([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }
      } else if (filters?.leadLinked === 'not_linked') {
        const { data: linkedData } = await supabase
          .from('contact_leads')
          .select('contact_id');
        const linkedIds = [...new Set((linkedData || []).map((d: any) => d.contact_id))];
        if (linkedIds.length > 0) {
          // Supabase doesn't have "not in" easily, use filter
          for (const id of linkedIds) {
            query = query.neq('id', id);
          }
        }
      }

      // Filter by city
      if (filters?.city && filters.city !== 'all') {
        query = query.eq('city', filters.city);
      }

      // Filter by state
      if (filters?.state && filters.state !== 'all') {
        query = query.eq('state', filters.state);
      }

      // Filter by action source (manual, system, group_creation, whatsapp_group)
      if (filters?.actionSource && filters.actionSource !== 'all') {
        query = query.eq('action_source', filters.actionSource);
      }

      // Filter by created_by (user who created the contact)
      if (filters?.createdBy && filters.createdBy !== 'all') {
        query = query.eq('created_by', filters.createdBy);
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

      // Get current user for created_by attribution
      const { data: { user: currentUser } } = await supabase.auth.getUser();

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
          neighborhood: contact.neighborhood || null,
          street: contact.street || null,
          cep: contact.cep || null,
          profession: contact.profession || null,
          follower_status: followerStatus,
          created_by: currentUser?.id || null,
        }])
        .select()
        .single();

      if (error) throw error;

      // Auto-save to Google Contacts (silent, best-effort)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          cloudFunctions.invoke('google-save-contact', {
            body: {
              name: contact.full_name,
              phone: contact.phone || undefined,
              email: contact.email || undefined,
              instagram_username: instagramUsername || undefined,
              notes: contact.notes || undefined,
            },
          }).catch(() => {}); // silent fail if not connected
        }
      } catch {}

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

      // Create lead from contact data
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

      // Create link in contact_leads junction table
      const { error: linkError } = await supabase
        .from('contact_leads')
        .insert({
          contact_id: contactId,
          lead_id: leadResult.id,
        });

      if (linkError) throw linkError;

      // Update contact with lead reference (legacy support)
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          lead_id: leadResult.id,
          converted_to_lead_at: new Date().toISOString(),
        })
        .eq('id', contactId);

      if (updateError) throw updateError;

      toast.success('Lead criado e vinculado ao contato');
      fetchContacts();
      return leadResult;
    } catch (error) {
      console.error('Error linking contact to lead:', error);
      toast.error('Erro ao vincular contato a lead');
      throw error;
    }
  };

  const importFromCSV = async (csvData: Partial<Contact>[]) => {
    let imported = 0;
    let errors = 0;
    let duplicates = 0;

    // Get current user for created_by attribution
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const currentUserId = currentUser?.id || null;

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
            created_by: currentUserId,
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

    // Get current user for created_by attribution
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const currentUserId = currentUser?.id || null;

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

        // Check for existing contact with this username (check both with and without @)
        const normalizedUsername = username.toLowerCase().replace('@', '');
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, follower_status, tags')
          .or(`instagram_username.eq.${normalizedUsername},instagram_username.eq.@${normalizedUsername}`)
          .limit(1)
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
            created_by: currentUserId,
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

  // Merge duplicate contacts by Instagram username
  const mergeDuplicateContacts = async (onProgress?: (progress: { current: number; total: number; merged: number; errors: number }) => void) => {
    try {
      // Fetch ALL contacts with Instagram username using pagination
      let allContacts: Contact[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .not('instagram_username', 'is', null)
          .order('created_at', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        
        if (data && data.length > 0) {
          allContacts = [...allContacts, ...(data as Contact[])];
          hasMore = data.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      }

      if (allContacts.length === 0) {
        toast.info('Nenhum contato com Instagram encontrado');
        return { merged: 0, errors: 0 };
      }

      // Group contacts by normalized Instagram username
      const contactsByUsername = new Map<string, Contact[]>();
      
      allContacts.forEach(contact => {
        const normalized = contact.instagram_username?.replace('@', '').toLowerCase();
        if (normalized) {
          if (!contactsByUsername.has(normalized)) {
            contactsByUsername.set(normalized, []);
          }
          contactsByUsername.get(normalized)!.push(contact as Contact);
        }
      });

      // Find groups with duplicates
      const duplicateGroups = Array.from(contactsByUsername.entries())
        .filter(([_, contacts]) => contacts.length > 1);

      if (duplicateGroups.length === 0) {
        toast.info('Nenhum contato duplicado encontrado');
        return { merged: 0, errors: 0 };
      }

      let merged = 0;
      let errors = 0;
      const total = duplicateGroups.length;

      for (let i = 0; i < duplicateGroups.length; i++) {
        const [username, duplicates] = duplicateGroups[i];
        
        try {
          // Sort by: has lead_id first, then by most complete data, then by oldest
          const sorted = duplicates.sort((a, b) => {
            // Prefer the one with lead_id
            if (a.lead_id && !b.lead_id) return -1;
            if (!a.lead_id && b.lead_id) return 1;
            
            // Count non-null fields
            const countFields = (c: Contact) => {
              let count = 0;
              if (c.full_name && c.full_name !== `@${username}`) count++;
              if (c.phone) count++;
              if (c.email) count++;
              if (c.city) count++;
              if (c.state) count++;
              if (c.notes) count++;
              if (c.classification && c.classification !== 'prospect') count++;
              return count;
            };
            
            const countA = countFields(a);
            const countB = countFields(b);
            if (countA !== countB) return countB - countA;
            
            // Keep oldest
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });

          const primary = sorted[0];
          const duplicatesToMerge = sorted.slice(1);

          // Merge data: fill in blanks from duplicates
          const mergedData: Partial<Contact> = {};
          
          // Name: prefer non-@ names
          if (!primary.full_name || primary.full_name.startsWith('@')) {
            const betterName = duplicatesToMerge.find(d => d.full_name && !d.full_name.startsWith('@'))?.full_name;
            if (betterName) mergedData.full_name = betterName;
          }
          
          // Fill missing fields from duplicates
          if (!primary.phone) {
            const phone = duplicatesToMerge.find(d => d.phone)?.phone;
            if (phone) mergedData.phone = phone;
          }
          if (!primary.email) {
            const email = duplicatesToMerge.find(d => d.email)?.email;
            if (email) mergedData.email = email;
          }
          if (!primary.city) {
            const city = duplicatesToMerge.find(d => d.city)?.city;
            if (city) mergedData.city = city;
          }
          if (!primary.state) {
            const state = duplicatesToMerge.find(d => d.state)?.state;
            if (state) mergedData.state = state;
          }
          if (!primary.neighborhood) {
            const neighborhood = duplicatesToMerge.find(d => d.neighborhood)?.neighborhood;
            if (neighborhood) mergedData.neighborhood = neighborhood;
          }
          if (!primary.street) {
            const street = duplicatesToMerge.find(d => d.street)?.street;
            if (street) mergedData.street = street;
          }
          if (!primary.cep) {
            const cep = duplicatesToMerge.find(d => d.cep)?.cep;
            if (cep) mergedData.cep = cep;
          }
          
          // Classification: prefer non-prospect
          if (!primary.classification || primary.classification === 'prospect') {
            const betterClass = duplicatesToMerge.find(d => d.classification && d.classification !== 'prospect')?.classification;
            if (betterClass) mergedData.classification = betterClass;
          }
          
          // Merge classifications array
          const allClassifications = new Set<string>();
          [primary, ...duplicatesToMerge].forEach(c => {
            (c.classifications || []).forEach(cls => allClassifications.add(cls));
          });
          if (allClassifications.size > 0) {
            mergedData.classifications = Array.from(allClassifications);
          }
          
          // Follower status: upgrade to mutual if any is mutual, or combine follower/following
          const allStatuses = [primary.follower_status, ...duplicatesToMerge.map(d => d.follower_status)];
          if (allStatuses.includes('mutual')) {
            mergedData.follower_status = 'mutual';
          } else if (allStatuses.includes('follower') && allStatuses.includes('following')) {
            mergedData.follower_status = 'mutual';
          } else if (allStatuses.includes('follower') && primary.follower_status !== 'follower') {
            mergedData.follower_status = 'follower';
          } else if (allStatuses.includes('following') && primary.follower_status !== 'following') {
            mergedData.follower_status = 'following';
          }
          
          // Merge tags
          const allTags = new Set<string>();
          [primary, ...duplicatesToMerge].forEach(c => {
            (c.tags || []).forEach(t => allTags.add(t));
          });
          if (allTags.size > 0) {
            mergedData.tags = Array.from(allTags);
          }
          
          // Merge notes
          const allNotes = [primary.notes, ...duplicatesToMerge.map(d => d.notes)]
            .filter(Boolean)
            .join('\n---\n');
          if (allNotes && allNotes !== primary.notes) {
            mergedData.notes = allNotes;
          }

          // Normalize instagram_username without @
          mergedData.instagram_username = username;

          // Update primary contact if there are changes
          if (Object.keys(mergedData).length > 0) {
            await supabase
              .from('contacts')
              .update(mergedData)
              .eq('id', primary.id);
          }

          // Move contact_leads from duplicates to primary
          const duplicateIds = duplicatesToMerge.map(d => d.id);
          await supabase
            .from('contact_leads')
            .update({ contact_id: primary.id })
            .in('contact_id', duplicateIds);

          // Move contact_relationships from duplicates to primary
          await supabase
            .from('contact_relationships')
            .update({ contact_id: primary.id })
            .in('contact_id', duplicateIds);
          
          await supabase
            .from('contact_relationships')
            .update({ related_contact_id: primary.id })
            .in('related_contact_id', duplicateIds);

          // Delete duplicate contacts
          const { error: deleteError } = await supabase
            .from('contacts')
            .delete()
            .in('id', duplicateIds);

          if (deleteError) throw deleteError;

          merged++;
        } catch (err) {
          console.error(`Error merging ${username}:`, err);
          errors++;
        }

        if (onProgress) {
          onProgress({ current: i + 1, total, merged, errors });
        }
      }

      fetchContacts();
      fetchStats();
      fetchTagStats();
      
      return { merged, errors };
    } catch (error) {
      console.error('Error merging duplicates:', error);
      toast.error('Erro ao mesclar contatos');
      throw error;
    }
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
    mergeDuplicateContacts,
  };
};

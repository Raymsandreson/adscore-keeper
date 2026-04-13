import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/hooks/useAuditLog';
import { Lead } from '@/hooks/useLeads';

export interface LeadContact {
  id: string;
  lead_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  classification: string | null;
  notes: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
}

export const useLeadContacts = (leadId?: string) => {
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchContacts = async () => {
    if (!leadId) {
      setContacts([]);
      return;
    }

    setLoading(true);
    try {
      // First get the contacts linked via contact_leads junction table
      const { data: linkData, error: linkError } = await supabase
        .from('contact_leads' as any)
        .select('contact_id')
        .eq('lead_id', leadId);

      if (linkError) throw linkError;

      const contactIds = ((linkData || []) as unknown as { contact_id: string }[]).map(l => l.contact_id);
      
      // Also check for legacy lead_id column
      const { data: legacyData, error: legacyError } = await supabase
        .from('contacts')
        .select('id')
        .eq('lead_id', leadId);

      if (legacyError) throw legacyError;
      
      const legacyIds = (legacyData || []).map(c => c.id);
      const allIds = [...new Set([...contactIds, ...legacyIds])];

      if (allIds.length === 0) {
        setContacts([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('id', allIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching lead contacts:', error);
    } finally {
      setLoading(false);
    }
  };

  const addContactToLead = async (contact: {
    full_name: string;
    phone?: string | null;
    email?: string | null;
    instagram_username?: string | null;
    classification?: string | null;
    notes?: string | null;
    city?: string | null;
    state?: string | null;
    neighborhood?: string | null;
    street?: string | null;
    cep?: string | null;
    profession?: string | null;
  }) => {
    if (!leadId) return;

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('contacts')
        .insert([{
          full_name: contact.full_name,
          phone: contact.phone || null,
          email: contact.email || null,
          instagram_username: contact.instagram_username || null,
          classification: contact.classification || null,
          notes: contact.notes || null,
          city: contact.city || null,
          state: contact.state || null,
          neighborhood: contact.neighborhood || null,
          street: contact.street || null,
          cep: contact.cep || null,
          profession: contact.profession || null,
          lead_id: leadId,
          created_by: currentUser?.id || null,
        }])
        .select()
        .single();

      if (error) throw error;
      
      toast.success('Contato adicionado ao lead');
      fetchContacts();
      return data;
    } catch (error) {
      console.error('Error adding contact:', error);
      toast.error('Erro ao adicionar contato');
      throw error;
    }
  };

  const linkExistingContact = async (contactId: string) => {
    if (!leadId) return;

    try {
      // Use the new junction table
      const { error } = await supabase
        .from('contact_leads' as any)
        .insert({
          contact_id: contactId,
          lead_id: leadId
        });

      if (error) {
        if (error.code === '23505') {
          toast.error('Este contato já está vinculado ao lead');
          return;
        }
        throw error;
      }
      
      toast.success('Contato vinculado ao lead');
      fetchContacts();
    } catch (error) {
      console.error('Error linking contact:', error);
      toast.error('Erro ao vincular contato');
      throw error;
    }
  };

  const unlinkContact = async (contactId: string) => {
    if (!leadId) return;

    try {
      // Remove from junction table
      const { error } = await supabase
        .from('contact_leads' as any)
        .delete()
        .eq('contact_id', contactId)
        .eq('lead_id', leadId);

      if (error) throw error;
      
      // Also clear legacy lead_id if exists
      await supabase
        .from('contacts')
        .update({ lead_id: null })
        .eq('id', contactId)
        .eq('lead_id', leadId);
      
      toast.success('Contato desvinculado');
      fetchContacts();
    } catch (error) {
      console.error('Error unlinking contact:', error);
      toast.error('Erro ao desvincular contato');
      throw error;
    }
  };

  const updateContact = async (contactId: string, updates: Partial<LeadContact>) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update(updates)
        .eq('id', contactId);

      if (error) throw error;
      
      toast.success('Contato atualizado');
      fetchContacts();
    } catch (error) {
      console.error('Error updating contact:', error);
      toast.error('Erro ao atualizar contato');
      throw error;
    }
  };

  const deleteContact = async (contactId: string) => {
    try {
      // Fetch full snapshot before archiving
      const { data: snapshot } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();

      // Save snapshot to audit log
      if (snapshot) {
        await logAudit({
          action: 'delete',
          entityType: 'contact',
          entityId: contactId,
          entityName: snapshot.full_name || 'Contato',
          details: { snapshot, soft_delete: true },
        });
      }

      // Soft delete
      const { error } = await supabase
        .from('contacts')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', contactId);

      if (error) throw error;
      
      toast.success('Contato arquivado');
      fetchContacts();
    } catch (error) {
      console.error('Error archiving contact:', error);
      toast.error('Erro ao arquivar contato');
      throw error;
    }
  };

  // Fetch unlinked contacts for linking
  const fetchUnlinkedContacts = async (searchQuery?: string) => {
    try {
      let query = supabase
        .from('contacts')
        .select('*')
        .is('lead_id', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (searchQuery) {
        query = query.or(`full_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching unlinked contacts:', error);
      return [];
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [leadId]);

  return {
    contacts,
    loading,
    fetchContacts,
    addContactToLead,
    linkExistingContact,
    unlinkContact,
    updateContact,
    deleteContact,
    fetchUnlinkedContacts,
  };
};

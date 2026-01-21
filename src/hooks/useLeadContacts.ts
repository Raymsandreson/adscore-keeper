import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('lead_id', leadId)
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
  }) => {
    if (!leadId) return;

    try {
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
          lead_id: leadId,
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
      const { error } = await supabase
        .from('contacts')
        .update({ lead_id: leadId })
        .eq('id', contactId);

      if (error) throw error;
      
      toast.success('Contato vinculado ao lead');
      fetchContacts();
    } catch (error) {
      console.error('Error linking contact:', error);
      toast.error('Erro ao vincular contato');
      throw error;
    }
  };

  const unlinkContact = async (contactId: string) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ lead_id: null })
        .eq('id', contactId);

      if (error) throw error;
      
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
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', contactId);

      if (error) throw error;
      
      toast.success('Contato removido');
      fetchContacts();
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Erro ao remover contato');
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

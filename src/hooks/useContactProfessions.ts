import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ContactProfession {
  id: string;
  contact_id: string;
  cbo_code: string;
  profession_title: string;
  is_primary: boolean;
  created_at: string;
}

export const useContactProfessions = (contactId?: string) => {
  const [professions, setProfessions] = useState<ContactProfession[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProfessions = useCallback(async (id?: string) => {
    const targetId = id || contactId;
    if (!targetId) return;
    
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('contact_professions')
        .select('*')
        .eq('contact_id', targetId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setProfessions((data || []) as ContactProfession[]);
    } catch (error) {
      console.error('Error fetching contact professions:', error);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const addProfession = useCallback(async (
    targetContactId: string,
    cboCode: string,
    professionTitle: string,
    isPrimary: boolean = false
  ) => {
    try {
      // If setting as primary, unset other primaries first
      if (isPrimary) {
        await (supabase as any)
          .from('contact_professions')
          .update({ is_primary: false })
          .eq('contact_id', targetContactId);
      }

      const { error } = await (supabase as any)
        .from('contact_professions')
        .insert({
          contact_id: targetContactId,
          cbo_code: cboCode,
          profession_title: professionTitle,
          is_primary: isPrimary
        });

      if (error) {
        if (error.code === '23505') {
          toast.error('Esta profissão já está atribuída a este contato');
          return false;
        }
        throw error;
      }

      // Also update the primary profession in contacts table for backwards compatibility
      if (isPrimary) {
        await supabase
          .from('contacts')
          .update({ 
            profession: professionTitle,
            profession_cbo_code: cboCode
          })
          .eq('id', targetContactId);
      }

      toast.success(`Profissão adicionada: ${professionTitle}`);
      await fetchProfessions(targetContactId);
      return true;
    } catch (error) {
      console.error('Error adding profession:', error);
      toast.error('Erro ao adicionar profissão');
      return false;
    }
  }, [fetchProfessions]);

  const removeProfession = useCallback(async (professionId: string, contactIdForRefetch?: string) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_professions')
        .delete()
        .eq('id', professionId);

      if (error) throw error;

      toast.success('Profissão removida');
      const targetId = contactIdForRefetch || contactId;
      if (targetId) {
        await fetchProfessions(targetId);
      }
      return true;
    } catch (error) {
      console.error('Error removing profession:', error);
      toast.error('Erro ao remover profissão');
      return false;
    }
  }, [contactId, fetchProfessions]);

  const setPrimaryProfession = useCallback(async (professionId: string, targetContactId: string) => {
    try {
      // First, unset all primaries for this contact
      await (supabase as any)
        .from('contact_professions')
        .update({ is_primary: false })
        .eq('contact_id', targetContactId);

      // Set the new primary
      const { data, error } = await (supabase as any)
        .from('contact_professions')
        .update({ is_primary: true })
        .eq('id', professionId)
        .select('profession_title, cbo_code')
        .single();

      if (error) throw error;

      // Update contacts table for backwards compatibility
      if (data) {
        await supabase
          .from('contacts')
          .update({ 
            profession: data.profession_title,
            profession_cbo_code: data.cbo_code
          })
          .eq('id', targetContactId);
      }

      toast.success('Profissão principal definida');
      await fetchProfessions(targetContactId);
      return true;
    } catch (error) {
      console.error('Error setting primary profession:', error);
      toast.error('Erro ao definir profissão principal');
      return false;
    }
  }, [fetchProfessions]);

  return {
    professions,
    loading,
    fetchProfessions,
    addProfession,
    removeProfession,
    setPrimaryProfession
  };
};

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ContactRelationshipType {
  id: string;
  name: string;
  icon: string;
  is_system: boolean;
  display_order: number;
}

export interface RelationshipCount {
  contact_id: string;
  count: number;
}

export interface ContactRelationship {
  id: string;
  contact_id: string;
  related_contact_id: string;
  relationship_type: string;
  notes: string | null;
  created_at: string;
  isInverse?: boolean;
  related_contact?: {
    id: string;
    full_name: string;
    instagram_username: string | null;
    phone: string | null;
  };
}

export const useContactRelationships = (contactId?: string) => {
  const [relationships, setRelationships] = useState<ContactRelationship[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<ContactRelationshipType[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRelationshipTypes = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('contact_relationship_types')
        .select('*')
        .order('display_order');

      if (error) throw error;
      setRelationshipTypes(data || []);
    } catch (error) {
      console.error('Error fetching relationship types:', error);
    }
  }, []);

  const fetchRelationships = useCallback(async () => {
    if (!contactId) {
      setRelationships([]);
      return;
    }

    setLoading(true);
    try {
      // Fetch relationships where this contact is the source
      const { data: outgoing, error: outError } = await (supabase as any)
        .from('contact_relationships')
        .select(`
          *,
          related_contact:related_contact_id (
            id, full_name, instagram_username, phone
          )
        `)
        .eq('contact_id', contactId);

      if (outError) throw outError;

      // Also fetch relationships where this contact is the target (inverse)
      const { data: incoming, error: inError } = await (supabase as any)
        .from('contact_relationships')
        .select(`
          *,
          related_contact:contact_id (
            id, full_name, instagram_username, phone
          )
        `)
        .eq('related_contact_id', contactId);

      if (inError) throw inError;

      // Combine both, marking incoming as inverse
      const allRelationships: ContactRelationship[] = [
        ...(outgoing || []).map((r: any) => ({
          ...r,
          isInverse: false,
        })),
        ...(incoming || []).map((r: any) => ({
          ...r,
          // Swap IDs for display purposes
          contact_id: r.related_contact_id,
          related_contact_id: r.contact_id,
          isInverse: true,
        })),
      ];

      setRelationships(allRelationships);
    } catch (error) {
      console.error('Error fetching relationships:', error);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const addRelationship = async (
    relatedContactId: string,
    relationshipType: string,
    notes?: string
  ) => {
    if (!contactId) return;

    try {
      const { data, error } = await (supabase as any)
        .from('contact_relationships')
        .insert({
          contact_id: contactId,
          related_contact_id: relatedContactId,
          relationship_type: relationshipType,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.error('Este vínculo já existe');
        } else {
          throw error;
        }
        return null;
      }

      toast.success('Vínculo adicionado');
      fetchRelationships();
      return data;
    } catch (error) {
      console.error('Error adding relationship:', error);
      toast.error('Erro ao adicionar vínculo');
      return null;
    }
  };

  const removeRelationship = async (relationshipId: string) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_relationships')
        .delete()
        .eq('id', relationshipId);

      if (error) throw error;

      toast.success('Vínculo removido');
      fetchRelationships();
    } catch (error) {
      console.error('Error removing relationship:', error);
      toast.error('Erro ao remover vínculo');
    }
  };

  const addRelationshipType = async (name: string, icon: string = 'users') => {
    try {
      const { data, error } = await (supabase as any)
        .from('contact_relationship_types')
        .insert({
          name,
          icon,
          is_system: false,
          display_order: relationshipTypes.length + 1,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.error('Este tipo de vínculo já existe');
        } else {
          throw error;
        }
        return null;
      }

      toast.success('Tipo de vínculo criado');
      fetchRelationshipTypes();
      return data;
    } catch (error) {
      console.error('Error adding relationship type:', error);
      toast.error('Erro ao criar tipo de vínculo');
      return null;
    }
  };

  useEffect(() => {
    fetchRelationshipTypes();
  }, [fetchRelationshipTypes]);

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  return {
    relationships,
    relationshipTypes,
    loading,
    fetchRelationships,
    addRelationship,
    removeRelationship,
    addRelationshipType,
    fetchRelationshipTypes,
  };
};

// Hook to fetch relationship counts for multiple contacts at once
export const useContactRelationshipCounts = (contactIds: string[]) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const fetchCounts = useCallback(async () => {
    if (!contactIds.length) {
      setCounts({});
      return;
    }

    setLoading(true);
    try {
      // Fetch counts where contact is the source
      const { data: outgoing, error: outError } = await (supabase as any)
        .from('contact_relationships')
        .select('contact_id')
        .in('contact_id', contactIds);

      if (outError) throw outError;

      // Fetch counts where contact is the target
      const { data: incoming, error: inError } = await (supabase as any)
        .from('contact_relationships')
        .select('related_contact_id')
        .in('related_contact_id', contactIds);

      if (inError) throw inError;

      // Count relationships per contact
      const countMap: Record<string, number> = {};
      
      (outgoing || []).forEach((r: any) => {
        countMap[r.contact_id] = (countMap[r.contact_id] || 0) + 1;
      });
      
      (incoming || []).forEach((r: any) => {
        countMap[r.related_contact_id] = (countMap[r.related_contact_id] || 0) + 1;
      });

      setCounts(countMap);
    } catch (error) {
      console.error('Error fetching relationship counts:', error);
    } finally {
      setLoading(false);
    }
  }, [contactIds.join(',')]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return { counts, loading, refetch: fetchCounts };
};

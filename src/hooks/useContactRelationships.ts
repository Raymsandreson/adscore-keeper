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

  // Symmetric relationship types that should be cross-referenced
  const SYMMETRIC_RELATIONSHIPS = [
    'Primo', 'Prima', 'Irmão', 'Irmã', 'Cunhado', 'Cunhada',
    'Sobrinho', 'Sobrinha', 'Tio', 'Tia', 'Amigo', 'Colega',
    'Vizinho', 'Sócio', 'Parceiro'
  ];

  const isSymmetricRelationship = (type: string) => {
    return SYMMETRIC_RELATIONSHIPS.some(r => 
      type.toLowerCase().includes(r.toLowerCase())
    );
  };

  // Cross-reference relationships: if A is cousin of B and C, then B and C are also cousins
  const crossReferenceRelationships = async (
    newContactId: string,
    relationshipType: string
  ) => {
    if (!contactId || !isSymmetricRelationship(relationshipType)) return;

    try {
      // Find all contacts that have the same relationship type with contactId
      const { data: existingOutgoing } = await (supabase as any)
        .from('contact_relationships')
        .select('related_contact_id')
        .eq('contact_id', contactId)
        .eq('relationship_type', relationshipType)
        .neq('related_contact_id', newContactId);

      const { data: existingIncoming } = await (supabase as any)
        .from('contact_relationships')
        .select('contact_id')
        .eq('related_contact_id', contactId)
        .eq('relationship_type', relationshipType)
        .neq('contact_id', newContactId);

      // Collect all related contacts (except the new one)
      const relatedContacts = new Set<string>();
      (existingOutgoing || []).forEach((r: any) => relatedContacts.add(r.related_contact_id));
      (existingIncoming || []).forEach((r: any) => relatedContacts.add(r.contact_id));

      if (relatedContacts.size === 0) return;

      // Create cross-references between the new contact and all existing related contacts
      const crossRefsToCreate: Array<{ contact_id: string; related_contact_id: string; relationship_type: string; notes: string }> = [];

      for (const existingContactId of relatedContacts) {
        // Check if relationship already exists in either direction
        const { data: existingRel } = await (supabase as any)
          .from('contact_relationships')
          .select('id')
          .or(`and(contact_id.eq.${newContactId},related_contact_id.eq.${existingContactId}),and(contact_id.eq.${existingContactId},related_contact_id.eq.${newContactId})`)
          .eq('relationship_type', relationshipType);

        if (!existingRel || existingRel.length === 0) {
          crossRefsToCreate.push({
            contact_id: newContactId,
            related_contact_id: existingContactId,
            relationship_type: relationshipType,
            notes: 'Vínculo criado automaticamente por cruzamento'
          });
        }
      }

      if (crossRefsToCreate.length > 0) {
        const { error: crossRefError } = await (supabase as any)
          .from('contact_relationships')
          .insert(crossRefsToCreate);

        if (!crossRefError) {
          toast.success(`${crossRefsToCreate.length} vínculo(s) cruzado(s) criado(s) automaticamente`);
        }
      }
    } catch (error) {
      console.error('Error cross-referencing relationships:', error);
    }
  };

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
      
      // Cross-reference symmetric relationships
      await crossReferenceRelationships(relatedContactId, relationshipType);
      
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

// Hook to fetch relationship types list
export const useRelationshipTypes = () => {
  const [relationshipTypes, setRelationshipTypes] = useState<ContactRelationshipType[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRelationshipTypes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('contact_relationship_types')
        .select('*')
        .order('display_order');

      if (error) throw error;
      setRelationshipTypes(data || []);
    } catch (error) {
      console.error('Error fetching relationship types:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRelationshipTypes();
  }, [fetchRelationshipTypes]);

  return { relationshipTypes, loading, refetch: fetchRelationshipTypes };
};

// Hook to fetch contact IDs that have a specific relationship type
export const useContactsByRelationshipType = (relationshipType: string | null) => {
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchContactIds = useCallback(async () => {
    if (!relationshipType) {
      setContactIds(new Set());
      return;
    }

    setLoading(true);
    try {
      // Fetch all relationships of this type
      const { data, error } = await (supabase as any)
        .from('contact_relationships')
        .select('contact_id, related_contact_id')
        .eq('relationship_type', relationshipType);

      if (error) throw error;

      // Collect all contact IDs (both sides of the relationship)
      const ids = new Set<string>();
      (data || []).forEach((r: any) => {
        ids.add(r.contact_id);
        ids.add(r.related_contact_id);
      });

      setContactIds(ids);
    } catch (error) {
      console.error('Error fetching contacts by relationship type:', error);
    } finally {
      setLoading(false);
    }
  }, [relationshipType]);

  useEffect(() => {
    fetchContactIds();
  }, [fetchContactIds]);

  return { contactIds, loading, refetch: fetchContactIds };
};

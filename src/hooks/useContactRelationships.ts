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

  // Relationship type mappings for cross-referencing
  const RELATIONSHIP_RULES = {
    // Symmetric relationships (A is X of B → B is X of A, and if both are X of C, they're X of each other)
    symmetric: [
      'Primo', 'Prima', 'Irmão', 'Irmã', 'Cunhado', 'Cunhada',
      'Amigo', 'Amiga', 'Colega', 'Vizinho', 'Vizinha', 'Sócio', 'Sócia', 
      'Parceiro', 'Parceira', 'Conhecido', 'Conhecida'
    ],
    // Child relationships that imply siblings when sharing same parent
    childTypes: ['Filho', 'Filha'],
    // Grandchild relationships that imply cousins when sharing same grandparent
    grandchildTypes: ['Neto', 'Neta'],
    // Sibling result types
    siblingTypes: { male: 'Irmão', female: 'Irmã', neutral: 'Irmão' },
    // Cousin result types  
    cousinTypes: { male: 'Primo', female: 'Prima', neutral: 'Primo' },
    // Nephew/niece types (children of siblings become cousins to each other)
    nephewTypes: ['Sobrinho', 'Sobrinha'],
    // Uncle/aunt types
    uncleTypes: ['Tio', 'Tia'],
  };

  const normalizeType = (type: string) => type.toLowerCase().trim();

  const matchesAnyType = (type: string, types: string[]) => {
    const normalized = normalizeType(type);
    return types.some(t => normalized.includes(normalizeType(t)));
  };

  const isSymmetricRelationship = (type: string) => matchesAnyType(type, RELATIONSHIP_RULES.symmetric);
  const isChildRelationship = (type: string) => matchesAnyType(type, RELATIONSHIP_RULES.childTypes);
  const isGrandchildRelationship = (type: string) => matchesAnyType(type, RELATIONSHIP_RULES.grandchildTypes);
  const isNephewRelationship = (type: string) => matchesAnyType(type, RELATIONSHIP_RULES.nephewTypes);

  // Get all contacts with a specific relationship to a given contact
  const getRelatedContactsByType = async (targetContactId: string, types: string[]) => {
    const contacts = new Set<string>();
    
    for (const relType of types) {
      // Outgoing relationships
      const { data: outgoing } = await (supabase as any)
        .from('contact_relationships')
        .select('related_contact_id, relationship_type')
        .eq('contact_id', targetContactId)
        .ilike('relationship_type', `%${relType}%`);
      
      (outgoing || []).forEach((r: any) => contacts.add(r.related_contact_id));

      // Incoming relationships
      const { data: incoming } = await (supabase as any)
        .from('contact_relationships')
        .select('contact_id, relationship_type')
        .eq('related_contact_id', targetContactId)
        .ilike('relationship_type', `%${relType}%`);
      
      (incoming || []).forEach((r: any) => contacts.add(r.contact_id));
    }
    
    return contacts;
  };

  // Check if a relationship already exists between two contacts
  const relationshipExists = async (contactA: string, contactB: string, relType: string) => {
    const { data } = await (supabase as any)
      .from('contact_relationships')
      .select('id')
      .or(`and(contact_id.eq.${contactA},related_contact_id.eq.${contactB}),and(contact_id.eq.${contactB},related_contact_id.eq.${contactA})`)
      .ilike('relationship_type', `%${relType}%`);
    
    return (data && data.length > 0);
  };

  // Create relationship if it doesn't exist
  const createRelationshipIfNotExists = async (
    contactA: string, 
    contactB: string, 
    relType: string,
    checkTypes: string[]
  ) => {
    // Check if any similar relationship already exists
    for (const checkType of checkTypes) {
      if (await relationshipExists(contactA, contactB, checkType)) {
        return false;
      }
    }
    
    const { error } = await (supabase as any)
      .from('contact_relationships')
      .insert({
        contact_id: contactA,
        related_contact_id: contactB,
        relationship_type: relType,
        notes: 'Vínculo criado automaticamente por cruzamento familiar'
      });
    
    return !error;
  };

  // Cross-reference all family relationships
  const crossReferenceRelationships = async (
    newContactId: string,
    relationshipType: string
  ) => {
    if (!contactId) return;

    let createdCount = 0;

    try {
      // 1. SYMMETRIC RELATIONSHIPS (primos, irmãos, cunhados, amigos, etc.)
      // If A is X of C, and B is X of C, then A and B are also X of each other
      if (isSymmetricRelationship(relationshipType)) {
        const existingRelated = await getRelatedContactsByType(contactId, [relationshipType]);
        existingRelated.delete(newContactId); // Remove the new contact from the set
        
        for (const existingContactId of existingRelated) {
          if (await createRelationshipIfNotExists(newContactId, existingContactId, relationshipType, [relationshipType])) {
            createdCount++;
          }
        }
      }

      // 2. CHILDREN OF SAME PARENT ARE SIBLINGS
      // If A is filho of C, and B is filho of C, then A and B are irmãos
      if (isChildRelationship(relationshipType)) {
        const siblings = await getRelatedContactsByType(contactId, RELATIONSHIP_RULES.childTypes);
        siblings.delete(newContactId);
        
        for (const siblingId of siblings) {
          const siblingType = RELATIONSHIP_RULES.siblingTypes.neutral;
          if (await createRelationshipIfNotExists(newContactId, siblingId, siblingType, ['Irmão', 'Irmã'])) {
            createdCount++;
          }
        }
      }

      // 3. GRANDCHILDREN OF SAME GRANDPARENT ARE COUSINS
      // If A is neto of C, and B is neto of C, then A and B are primos
      if (isGrandchildRelationship(relationshipType)) {
        const cousins = await getRelatedContactsByType(contactId, RELATIONSHIP_RULES.grandchildTypes);
        cousins.delete(newContactId);
        
        for (const cousinId of cousins) {
          const cousinType = RELATIONSHIP_RULES.cousinTypes.neutral;
          if (await createRelationshipIfNotExists(newContactId, cousinId, cousinType, ['Primo', 'Prima'])) {
            createdCount++;
          }
        }
      }

      // 4. NEPHEWS/NIECES OF SAME PERSON ARE COUSINS OR SIBLINGS
      // If A is sobrinho of C, and B is sobrinho of C, they could be cousins (different sibling parents) or siblings (same parent)
      if (isNephewRelationship(relationshipType)) {
        const otherNephews = await getRelatedContactsByType(contactId, RELATIONSHIP_RULES.nephewTypes);
        otherNephews.delete(newContactId);
        
        for (const nephewId of otherNephews) {
          // Default to cousins since we can't determine if they share a parent
          const cousinType = RELATIONSHIP_RULES.cousinTypes.neutral;
          if (await createRelationshipIfNotExists(newContactId, nephewId, cousinType, ['Primo', 'Prima', 'Irmão', 'Irmã'])) {
            createdCount++;
          }
        }
      }

      // 5. SIBLINGS OF PARENT RELATIONSHIPS (propagate sibling status)
      // If A has siblings, and we add B as sibling of A, B is also sibling of A's siblings
      if (matchesAnyType(relationshipType, ['Irmão', 'Irmã'])) {
        const existingSiblings = await getRelatedContactsByType(contactId, ['Irmão', 'Irmã']);
        existingSiblings.delete(newContactId);
        
        for (const siblingId of existingSiblings) {
          if (await createRelationshipIfNotExists(newContactId, siblingId, RELATIONSHIP_RULES.siblingTypes.neutral, ['Irmão', 'Irmã'])) {
            createdCount++;
          }
        }
      }

      if (createdCount > 0) {
        toast.success(`${createdCount} vínculo(s) familiar(es) criado(s) automaticamente`);
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

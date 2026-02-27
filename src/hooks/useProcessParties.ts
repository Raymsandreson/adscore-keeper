import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PartyRole = 'autor' | 'reu' | 'testemunha' | 'advogado' | 'dependente' | 'perito' | 'outro';

export interface ProcessParty {
  id: string;
  process_id: string;
  contact_id: string;
  role: PartyRole;
  notes: string | null;
  created_at: string;
  // Joined
  contact_name?: string;
  contact_phone?: string;
}

export const partyRoleLabels: Record<PartyRole, string> = {
  autor: 'Autor',
  reu: 'Réu',
  testemunha: 'Testemunha',
  advogado: 'Advogado',
  dependente: 'Dependente',
  perito: 'Perito',
  outro: 'Outro',
};

export function useProcessParties(processId?: string) {
  const [parties, setParties] = useState<ProcessParty[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchParties = useCallback(async (id?: string) => {
    const targetId = id || processId;
    if (!targetId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('process_parties')
        .select('*, contacts(full_name, phone)')
        .eq('process_id', targetId)
        .order('created_at');
      if (error) throw error;
      const enriched = (data || []).map((p: any) => ({
        ...p,
        contact_name: p.contacts?.full_name,
        contact_phone: p.contacts?.phone,
      }));
      setParties(enriched as ProcessParty[]);
    } catch (error) {
      console.error('Error fetching parties:', error);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  const addParty = useCallback(async (party: { process_id: string; contact_id: string; role: PartyRole; notes?: string }) => {
    try {
      const { data, error } = await supabase
        .from('process_parties')
        .insert(party as any)
        .select('*, contacts(full_name, phone)')
        .single();
      if (error) {
        if (error.code === '23505') {
          toast.error('Este contato já é parte neste processo com este papel');
          return;
        }
        throw error;
      }
      const enriched = {
        ...data,
        contact_name: (data as any).contacts?.full_name,
        contact_phone: (data as any).contacts?.phone,
      } as ProcessParty;
      setParties(prev => [...prev, enriched]);
      toast.success('Parte adicionada ao processo');
      return enriched;
    } catch (error) {
      console.error('Error adding party:', error);
      toast.error('Erro ao adicionar parte');
      throw error;
    }
  }, []);

  const removeParty = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('process_parties')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setParties(prev => prev.filter(p => p.id !== id));
      toast.success('Parte removida');
    } catch (error) {
      console.error('Error removing party:', error);
      toast.error('Erro ao remover parte');
      throw error;
    }
  }, []);

  return { parties, loading, fetchParties, addParty, removeParty };
}

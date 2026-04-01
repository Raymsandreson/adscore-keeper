import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface NucleusCompanyLink {
  id: string;
  nucleus_id: string;
  company_id: string;
}

export interface SpecializedNucleus {
  id: string;
  name: string;
  prefix: string;
  color: string;
  description: string | null;
  is_active: boolean;
  sequence_counter: number;
  company_id: string | null; // legacy, kept for compatibility
  company_ids: string[]; // new N:N
  created_at: string;
  updated_at: string;
}

export function useSpecializedNuclei() {
  const [nuclei, setNuclei] = useState<SpecializedNucleus[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNuclei = useCallback(async () => {
    setLoading(true);
    try {
      const [nucleiRes, linksRes] = await Promise.all([
        supabase.from('specialized_nuclei').select('*').order('name'),
        supabase.from('nucleus_companies').select('*'),
      ]);
      if (nucleiRes.error) throw nucleiRes.error;

      const links = (linksRes.data || []) as NucleusCompanyLink[];
      const linksByNucleus: Record<string, string[]> = {};
      links.forEach(l => {
        if (!linksByNucleus[l.nucleus_id]) linksByNucleus[l.nucleus_id] = [];
        linksByNucleus[l.nucleus_id].push(l.company_id);
      });

      const enriched = (nucleiRes.data || []).map((n: any) => ({
        ...n,
        company_ids: linksByNucleus[n.id] || [],
      })) as SpecializedNucleus[];

      setNuclei(enriched);
    } catch (error) {
      console.error('Error fetching nuclei:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncCompanyLinks = useCallback(async (nucleusId: string, companyIds: string[]) => {
    // Delete existing links
    await supabase.from('nucleus_companies').delete().eq('nucleus_id', nucleusId);
    // Insert new links
    if (companyIds.length > 0) {
      const rows = companyIds.map(cid => ({ nucleus_id: nucleusId, company_id: cid }));
      await supabase.from('nucleus_companies').insert(rows as any);
    }
  }, []);

  const addNucleus = useCallback(async (nucleus: Partial<SpecializedNucleus> & { company_ids?: string[] }) => {
    try {
      const { company_ids, company_id, ...rest } = nucleus as any;
      const { data, error } = await supabase
        .from('specialized_nuclei')
        .insert(rest)
        .select()
        .single();
      if (error) throw error;

      const ids = company_ids || (company_id ? [company_id] : []);
      if (ids.length > 0) {
        await syncCompanyLinks(data.id, ids);
      }

      const enriched = { ...data, company_ids: ids } as SpecializedNucleus;
      setNuclei(prev => [...prev, enriched]);
      toast.success('Núcleo criado');
      return enriched;
    } catch (error) {
      console.error('Error adding nucleus:', error);
      toast.error('Erro ao criar núcleo');
      throw error;
    }
  }, [syncCompanyLinks]);

  const updateNucleus = useCallback(async (id: string, updates: Partial<SpecializedNucleus> & { company_ids?: string[] }) => {
    try {
      const { company_ids, company_id, ...rest } = updates as any;
      let updatedData: any = null;

      // Only update the nucleus row if there are actual column changes
      const hasColumnUpdates = Object.keys(rest).length > 0;
      if (hasColumnUpdates) {
        const { data, error } = await supabase
          .from('specialized_nuclei')
          .update(rest)
          .eq('id', id)
          .select()
          .maybeSingle();
        if (error) throw error;
        updatedData = data;
      }

      if (company_ids !== undefined) {
        await syncCompanyLinks(id, company_ids);
      }

      // If we didn't update the row, find the existing nucleus for state
      if (!updatedData) {
        const existing = nuclei.find(n => n.id === id);
        updatedData = existing ? { ...existing } : { id };
      }

      const enriched = { ...updatedData, company_ids: company_ids ?? (nuclei.find(n => n.id === id)?.company_ids || []) } as SpecializedNucleus;
      setNuclei(prev => prev.map(n => n.id === id ? enriched : n));
      toast.success('Núcleo atualizado');
      return enriched;
    } catch (error) {
      console.error('Error updating nucleus:', error);
      toast.error('Erro ao atualizar núcleo');
      throw error;
    }
  }, [syncCompanyLinks, nuclei]);

  const deleteNucleus = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('specialized_nuclei').delete().eq('id', id);
      if (error) throw error;
      setNuclei(prev => prev.filter(n => n.id !== id));
      toast.success('Núcleo removido');
    } catch (error) {
      console.error('Error deleting nucleus:', error);
      toast.error('Erro ao remover núcleo');
      throw error;
    }
  }, []);

  useEffect(() => {
    fetchNuclei();
  }, [fetchNuclei]);

  return { nuclei, loading, fetchNuclei, addNucleus, updateNucleus, deleteNucleus };
}

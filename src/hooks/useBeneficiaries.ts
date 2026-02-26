import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Beneficiary {
  id: string;
  name: string;
  document: string | null;
  person_type: 'fisica' | 'juridica';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useBeneficiaries() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBeneficiaries = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('beneficiaries')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      setBeneficiaries((data as Beneficiary[]) || []);
    } catch (err: any) {
      console.error('Error fetching beneficiaries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBeneficiaries(); }, [fetchBeneficiaries]);

  const addBeneficiary = useCallback(async (b: Partial<Beneficiary>) => {
    const { data, error } = await supabase
      .from('beneficiaries')
      .insert([{ name: b.name, document: b.document || null, person_type: b.person_type || 'juridica', is_active: true }])
      .select().single();
    if (error) throw error;
    toast.success('Beneficiário criado');
    await fetchBeneficiaries();
    return data as Beneficiary;
  }, [fetchBeneficiaries]);

  const updateBeneficiary = useCallback(async (id: string, updates: Partial<Beneficiary>) => {
    const { error } = await supabase.from('beneficiaries').update(updates).eq('id', id);
    if (error) throw error;
    toast.success('Beneficiário atualizado');
    await fetchBeneficiaries();
  }, [fetchBeneficiaries]);

  const deleteBeneficiary = useCallback(async (id: string) => {
    const { error } = await supabase.from('beneficiaries').delete().eq('id', id);
    if (error) throw error;
    toast.success('Beneficiário removido');
    await fetchBeneficiaries();
  }, [fetchBeneficiaries]);

  const activeBeneficiaries = beneficiaries.filter(b => b.is_active);

  return { beneficiaries, activeBeneficiaries, loading, fetchBeneficiaries, addBeneficiary, updateBeneficiary, deleteBeneficiary };
}

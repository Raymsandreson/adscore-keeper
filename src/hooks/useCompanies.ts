import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  trading_name: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      setCompanies((data as Company[]) || []);
    } catch (err: any) {
      console.error('Error fetching companies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const addCompany = useCallback(async (company: Partial<Company>) => {
    const { data, error } = await supabase
      .from('companies')
      .insert([{ name: company.name, cnpj: company.cnpj || null, trading_name: company.trading_name || null, is_active: true, display_order: company.display_order || 0 }])
      .select().single();
    if (error) throw error;
    toast.success('Empresa criada');
    await fetchCompanies();
    return data as Company;
  }, [fetchCompanies]);

  const updateCompany = useCallback(async (id: string, updates: Partial<Company>) => {
    const { error } = await supabase.from('companies').update(updates).eq('id', id);
    if (error) throw error;
    toast.success('Empresa atualizada');
    await fetchCompanies();
  }, [fetchCompanies]);

  const deleteCompany = useCallback(async (id: string) => {
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) throw error;
    toast.success('Empresa removida');
    await fetchCompanies();
  }, [fetchCompanies]);

  const activeCompanies = companies.filter(c => c.is_active);

  return { companies, activeCompanies, loading, fetchCompanies, addCompany, updateCompany, deleteCompany };
}

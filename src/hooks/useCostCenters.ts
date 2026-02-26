import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CostCenter {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function useCostCenters() {
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCostCenters = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      setCostCenters((data as CostCenter[]) || []);
    } catch (err: any) {
      console.error('Error fetching cost centers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCostCenters(); }, [fetchCostCenters]);

  const addCostCenter = useCallback(async (cc: Partial<CostCenter>) => {
    const { data, error } = await supabase
      .from('cost_centers')
      .insert([{ name: cc.name, company_id: cc.company_id || null, description: cc.description || null, is_active: true, display_order: cc.display_order || 0 }])
      .select().single();
    if (error) throw error;
    toast.success('Centro de custo criado');
    await fetchCostCenters();
    return data as CostCenter;
  }, [fetchCostCenters]);

  const updateCostCenter = useCallback(async (id: string, updates: Partial<CostCenter>) => {
    const { error } = await supabase.from('cost_centers').update(updates).eq('id', id);
    if (error) throw error;
    toast.success('Centro de custo atualizado');
    await fetchCostCenters();
  }, [fetchCostCenters]);

  const deleteCostCenter = useCallback(async (id: string) => {
    const { error } = await supabase.from('cost_centers').delete().eq('id', id);
    if (error) throw error;
    toast.success('Centro de custo removido');
    await fetchCostCenters();
  }, [fetchCostCenters]);

  const getByCompany = useCallback((companyId: string) => {
    return costCenters.filter(cc => cc.company_id === companyId && cc.is_active);
  }, [costCenters]);

  const activeCostCenters = costCenters.filter(cc => cc.is_active);

  return { costCenters, activeCostCenters, loading, fetchCostCenters, addCostCenter, updateCostCenter, deleteCostCenter, getByCompany };
}

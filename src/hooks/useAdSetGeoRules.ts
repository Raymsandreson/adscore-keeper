import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AdSetGeoRule {
  id: string;
  board_id: string;
  stage_id: string | null;
  acolhedor: string | null;
  adset_id: string;
  ad_account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  radius_km: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useAdSetGeoRules() {
  const [rules, setRules] = useState<AdSetGeoRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('adset_geo_rules')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRules((data as any[]) || []);
    } catch (e) {
      console.error('Error fetching adset geo rules:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const createRule = async (rule: Omit<AdSetGeoRule, 'id' | 'created_at' | 'updated_at'>) => {
    const { error } = await supabase.from('adset_geo_rules').insert(rule as any);
    if (error) { toast.error('Erro ao criar regra'); throw error; }
    toast.success('Regra criada com sucesso');
    fetchRules();
  };

  const updateRule = async (id: string, updates: Partial<AdSetGeoRule>) => {
    const { error } = await supabase.from('adset_geo_rules').update(updates as any).eq('id', id);
    if (error) { toast.error('Erro ao atualizar regra'); throw error; }
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from('adset_geo_rules').delete().eq('id', id);
    if (error) { toast.error('Erro ao deletar regra'); throw error; }
    toast.success('Regra removida');
    fetchRules();
  };

  return { rules, loading, fetchRules, createRule, updateRule, deleteRule };
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CboProfession {
  id: string;
  cbo_code: string;
  title: string;
  family_code: string | null;
  family_title: string | null;
}

export const useCboProfessions = () => {
  const [professions, setProfessions] = useState<CboProfession[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProfessions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('cbo_professions')
        .select('*')
        .order('title', { ascending: true });

      if (error) throw error;
      setProfessions((data || []) as CboProfession[]);
    } catch (error) {
      console.error('Error fetching CBO professions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchProfessions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      return professions;
    }

    try {
      const { data, error } = await (supabase as any)
        .from('cbo_professions')
        .select('*')
        .or(`title.ilike.%${query}%,cbo_code.ilike.%${query}%`)
        .order('title', { ascending: true })
        .limit(50);

      if (error) throw error;
      return (data || []) as CboProfession[];
    } catch (error) {
      console.error('Error searching professions:', error);
      return [];
    }
  }, [professions]);

  useEffect(() => {
    fetchProfessions();
  }, [fetchProfessions]);

  return {
    professions,
    loading,
    fetchProfessions,
    searchProfessions,
  };
};

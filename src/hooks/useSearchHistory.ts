import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

interface SearchHistoryItem {
  id: string;
  keywords: string[];
  max_posts: number | null;
  min_comments: number | null;
  apify_run_id: string | null;
  status: string | null;
  results_count: number | null;
  results: Json | null;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_search_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching search history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const createSearchRecord = async (
    keywords: string[],
    maxPosts: number,
    minComments: number,
    runId: string
  ) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('instagram_search_history')
        .insert({
          keywords,
          max_posts: maxPosts,
          min_comments: minComments,
          apify_run_id: runId,
          status: 'running',
          created_by: userData.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      
      setHistory(prev => [data, ...prev]);
      return data.id;
    } catch (error) {
      console.error('Error creating search record:', error);
      return null;
    }
  };

  const updateSearchResults = async (
    id: string,
    results: any[],
    status: 'completed' | 'failed' = 'completed'
  ) => {
    try {
      const { error } = await supabase
        .from('instagram_search_history')
        .update({
          results,
          results_count: results.length,
          status,
          completed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      setHistory(prev =>
        prev.map(item =>
          item.id === id
            ? { ...item, results, results_count: results.length, status, completed_at: new Date().toISOString() }
            : item
        )
      );
    } catch (error) {
      console.error('Error updating search results:', error);
    }
  };

  const deleteSearchRecord = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instagram_search_history')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setHistory(prev => prev.filter(item => item.id !== id));
      toast.success('Busca removida do histórico');
    } catch (error) {
      console.error('Error deleting search record:', error);
      toast.error('Erro ao remover busca');
    }
  };

  return {
    history,
    isLoading,
    fetchHistory,
    createSearchRecord,
    updateSearchResults,
    deleteSearchRecord,
  };
}

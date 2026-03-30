import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface SearchHistoryItem {
  id: string;
  keywords: string[];
  post_urls: string[];
  max_posts: number | null;
  min_comments: number | null;
  apify_run_id: string | null;
  status: string | null;
  results_count: number | null;
  results: Json | null;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
  cost_usd: number | null;
  cost_brl: number | null;
  // Computed: is this a hashtag search or post extraction
  search_type: 'hashtag' | 'post';
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_search_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      // Enrich with search_type
      const enriched = (data || []).map(item => ({
        ...item,
        post_urls: (item as any).post_urls || [],
        cost_usd: (item as any).cost_usd || null,
        cost_brl: (item as any).cost_brl || null,
        search_type: ((item as any).post_urls?.length > 0 ? 'post' : 'hashtag') as 'hashtag' | 'post',
      }));
      
      setHistory(enriched);
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
      
      const enrichedData: SearchHistoryItem = {
        ...data,
        post_urls: [],
        cost_usd: null,
        cost_brl: null,
        search_type: 'hashtag',
      };
      setHistory(prev => [enrichedData, ...prev]);
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

  const resumeSearch = useCallback(async (item: SearchHistoryItem): Promise<any[] | null> => {
    if (!item.apify_run_id) {
      toast.error('Esta busca não possui ID de execução');
      return null;
    }

    setResumingId(item.id);

    try {
      // Check status first
      const { data: statusData, error: statusError } = await cloudFunctions.invoke('search-instagram-posts', {
        body: { action: 'status', runId: item.apify_run_id },
      });

      if (statusError) throw statusError;

      if (statusData?.isFailed) {
        await updateSearchResults(item.id, [], 'failed');
        toast.error('A busca falhou no Apify');
        return null;
      }

      if (!statusData?.isComplete) {
        toast.info('A busca ainda está em andamento. Aguarde...');
        // Start polling
        return await pollForResults(item.id, item.apify_run_id);
      }

      // If complete, fetch results
      const { data: resultsData, error: resultsError } = await cloudFunctions.invoke('search-instagram-posts', {
        body: { action: 'results', runId: item.apify_run_id },
      });

      if (resultsError) throw resultsError;

      if (resultsData?.success) {
        const posts = resultsData.posts || [];
        await updateSearchResults(item.id, posts, 'completed');
        toast.success(`Encontrados ${posts.length} posts`);
        return posts;
      } else {
        throw new Error(resultsData?.error || 'Erro ao buscar resultados');
      }
    } catch (error) {
      console.error('Resume search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao retomar busca');
      return null;
    } finally {
      setResumingId(null);
    }
  }, []);

  const pollForResults = async (searchId: string, runId: string): Promise<any[] | null> => {
    const maxAttempts = 120; // 10 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        const { data: statusData, error: statusError } = await cloudFunctions.invoke('search-instagram-posts', {
          body: { action: 'status', runId },
        });

        if (statusError) throw statusError;

        if (statusData?.isFailed) {
          await updateSearchResults(searchId, [], 'failed');
          toast.error('A busca falhou no Apify');
          return null;
        }

        if (statusData?.isComplete) {
          const { data: resultsData, error: resultsError } = await cloudFunctions.invoke('search-instagram-posts', {
            body: { action: 'results', runId },
          });

          if (resultsError) throw resultsError;

          if (resultsData?.success) {
            const posts = resultsData.posts || [];
            await updateSearchResults(searchId, posts, 'completed');
            toast.success(`Encontrados ${posts.length} posts`);
            return posts;
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        throw error;
      }
    }

    toast.error('Timeout: a busca demorou mais de 10 minutos');
    return null;
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
    resumingId,
    fetchHistory,
    createSearchRecord,
    updateSearchResults,
    resumeSearch,
    deleteSearchRecord,
  };
}

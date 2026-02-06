import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

interface ExtractionHistoryItem {
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
  creator_name?: string;
  creator_email?: string;
}

// Cotação BRL/USD (pode ser atualizada via API no futuro)
const USD_TO_BRL_RATE = 5.5;

export function usePostExtractionHistory() {
  const [history, setHistory] = useState<ExtractionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Buscar histórico com info do criador
      const { data: historyData, error: historyError } = await supabase
        .from('instagram_search_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (historyError) throw historyError;

      // Buscar nomes dos usuários que criaram
      const creatorIds = [...new Set((historyData || []).map(h => h.created_by).filter(Boolean))];
      
      let profilesMap: Record<string, { full_name: string | null; email: string | null }> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', creatorIds);
        
        if (profiles) {
          profilesMap = profiles.reduce((acc, p) => ({
            ...acc,
            [p.user_id]: { full_name: p.full_name, email: p.email }
          }), {});
        }
      }

      // Combinar dados
      const enrichedHistory = (historyData || []).map(item => ({
        ...item,
        post_urls: (item as any).post_urls || [],
        cost_usd: (item as any).cost_usd || null,
        cost_brl: (item as any).cost_brl || null,
        creator_name: item.created_by ? profilesMap[item.created_by]?.full_name || undefined : undefined,
        creator_email: item.created_by ? profilesMap[item.created_by]?.email || undefined : undefined,
      }));

      setHistory(enrichedHistory);
    } catch (error) {
      console.error('Error fetching extraction history:', error);
      toast.error('Erro ao carregar histórico');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const createExtractionRecord = async (
    postUrls: string[],
    maxComments: number,
    runId: string
  ): Promise<string | null> => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('instagram_search_history')
        .insert({
          keywords: [], // Não usado para extração por URL
          post_urls: postUrls,
          max_posts: maxComments,
          apify_run_id: runId,
          status: 'running',
          created_by: userData.user?.id,
        } as any)
        .select()
        .single();

      if (error) throw error;
      
      await fetchHistory();
      return data.id;
    } catch (error) {
      console.error('Error creating extraction record:', error);
      return null;
    }
  };

  const updateExtractionResults = async (
    id: string,
    results: any[],
    status: 'completed' | 'failed' = 'completed',
    costUsd: number = 0
  ) => {
    try {
      const costBrl = costUsd * USD_TO_BRL_RATE;
      
      const { error } = await supabase
        .from('instagram_search_history')
        .update({
          results,
          results_count: results.length,
          status,
          completed_at: new Date().toISOString(),
          cost_usd: costUsd,
          cost_brl: costBrl,
        } as any)
        .eq('id', id);

      if (error) throw error;

      await fetchHistory();
    } catch (error) {
      console.error('Error updating extraction results:', error);
    }
  };

  const deleteExtractionRecord = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instagram_search_history')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setHistory(prev => prev.filter(item => item.id !== id));
      toast.success('Registro removido do histórico');
    } catch (error) {
      console.error('Error deleting extraction record:', error);
      toast.error('Erro ao remover registro');
    }
  };

  // Calcular totais
  const totalCostUsd = history.reduce((acc, item) => acc + (item.cost_usd || 0), 0);
  const totalCostBrl = history.reduce((acc, item) => acc + (item.cost_brl || 0), 0);
  const totalComments = history.reduce((acc, item) => acc + (item.results_count || 0), 0);

  return {
    history,
    isLoading,
    fetchHistory,
    createExtractionRecord,
    updateExtractionResults,
    deleteExtractionRecord,
    totalCostUsd,
    totalCostBrl,
    totalComments,
    USD_TO_BRL_RATE,
  };
}

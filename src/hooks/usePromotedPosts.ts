import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getMetaCredentials } from '@/utils/metaCredentials';

export interface PromotedPost {
  id: string;
  post_title: string;
  post_platform: string;
  post_id: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  ad_account_id: string | null;
  campaign_name: string | null;
  objective: string | null;
  status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  start_date: string | null;
  end_date: string | null;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  followers_gained: number;
  comments_count: number;
  likes_count: number;
  shares_count: number;
  saves_count: number;
  engagement_rate: number;
  cpm: number;
  cpc: number;
  ctr: number;
  editorial_post_id: string | null;
  notes: string | null;
  created_at: string;
}

export function usePromotedPosts() {
  const [promotedPosts, setPromotedPosts] = useState<PromotedPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPromotedPosts = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('promoted_posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching promoted posts:', error);
    } else {
      setPromotedPosts(data || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchPromotedPosts();

    const channel = supabase
      .channel('promoted_posts_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoted_posts' }, () => {
        fetchPromotedPosts();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchPromotedPosts]);

  const createCampaign = async (params: {
    postId: string;
    campaignName: string;
    objective: string;
    dailyBudget?: number;
    lifetimeBudget?: number;
    startDate: string;
    endDate?: string;
    locations?: { key: string; name: string }[];
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    interests?: { id: string; name: string }[];
    placements?: string[];
    editorialPostId?: string;
    postTitle?: string;
    postPlatform?: string;
    leadId?: string;
    creativeData?: {
      imageUrl?: string;
      headline?: string;
      body?: string;
      linkDescription?: string;
      callToAction?: string;
    };
  }) => {
    const { accessToken, adAccountId } = await getMetaCredentials();

    if (!accessToken || !adAccountId) {
      toast.error('Token Meta não encontrado. Conecte sua conta primeiro.');
      return { success: false, error: 'No access token' };
    }

    try {
      const response = await fetch(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/create-meta-campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          accessToken,
          adAccountId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao criar campanha');
      }

      toast.success('Campanha criada com sucesso! Status: Pausada');
      await fetchPromotedPosts();
      return { success: true, data: data.data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      toast.error(`Erro: ${msg}`);
      return { success: false, error: msg };
    }
  };

  return {
    promotedPosts,
    isLoading,
    createCampaign,
    refreshPromotedPosts: fetchPromotedPosts,
  };
}

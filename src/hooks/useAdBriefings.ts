import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AdBriefing {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  creative_url: string | null;
  creative_type: string;
  headline: string | null;
  body_text: string | null;
  link_description: string | null;
  cta: string;
  notes: string | null;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  promoted_post_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useAdBriefings() {
  const [briefings, setBriefings] = useState<AdBriefing[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBriefings = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('ad_briefings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching briefings:', error);
    } else {
      setBriefings((data as AdBriefing[]) || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchBriefings();

    const channel = supabase
      .channel('ad_briefings_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_briefings' }, () => {
        fetchBriefings();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchBriefings]);

  const createBriefing = async (params: {
    leadId?: string;
    leadName?: string;
    creativeUrl?: string;
    creativeType?: string;
    headline?: string;
    bodyText?: string;
    linkDescription?: string;
    cta?: string;
    notes?: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('ad_briefings').insert({
      lead_id: params.leadId || null,
      lead_name: params.leadName || null,
      creative_url: params.creativeUrl || null,
      creative_type: params.creativeType || 'image',
      headline: params.headline || null,
      body_text: params.bodyText || null,
      link_description: params.linkDescription || null,
      cta: params.cta || 'LEARN_MORE',
      notes: params.notes || null,
      created_by: user?.id || null,
    } as any);

    if (error) {
      toast.error('Erro ao criar briefing');
      console.error(error);
      return false;
    }
    toast.success('Briefing criado com sucesso!');
    return true;
  };

  const updateBriefingStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from('ad_briefings')
      .update({ status } as any)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao atualizar status');
      return false;
    }
    return true;
  };

  const deleteBriefing = async (id: string) => {
    const { error } = await supabase
      .from('ad_briefings')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Erro ao excluir briefing');
      return false;
    }
    toast.success('Briefing excluído');
    return true;
  };

  const linkBriefingToAd = async (briefingId: string, promotedPostId: string) => {
    const { error } = await supabase
      .from('ad_briefings')
      .update({ promoted_post_id: promotedPostId, status: 'linked' } as any)
      .eq('id', briefingId);

    if (error) {
      toast.error('Erro ao vincular briefing ao anúncio');
      return false;
    }
    toast.success('Briefing vinculado ao anúncio!');
    return true;
  };

  return {
    briefings,
    isLoading,
    createBriefing,
    updateBriefingStatus,
    deleteBriefing,
    linkBriefingToAd,
    refreshBriefings: fetchBriefings,
  };
}

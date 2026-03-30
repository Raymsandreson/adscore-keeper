import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface ExternalPost {
  id: string;
  url: string;
  post_id: string | null;
  platform: string;
  title: string | null;
  description: string | null;
  author_username: string | null;
  comments_count: number | null;
  last_fetched_at: string | null;
  lead_id: string | null;
  news_links: string[] | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  lead?: {
    id: string;
    lead_name: string | null;
    status: string | null;
  } | null;
}

interface UseExternalPostsOptions {
  platform?: string;
  hasLead?: boolean | null;
  searchTerm?: string;
}

export function useExternalPosts(options: UseExternalPostsOptions = {}) {
  const [posts, setPosts] = useState<ExternalPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('external_posts')
        .select(`
          *,
          lead:leads(id, lead_name, status)
        `)
        .order('created_at', { ascending: false });

      if (options.platform && options.platform !== 'all') {
        query = query.eq('platform', options.platform);
      }

      if (options.hasLead === true) {
        query = query.not('lead_id', 'is', null);
      } else if (options.hasLead === false) {
        query = query.is('lead_id', null);
      }

      const { data, error } = await query;

      if (error) throw error;

      let filteredData = (data || []) as ExternalPost[];

      if (options.searchTerm) {
        const search = options.searchTerm.toLowerCase();
        filteredData = filteredData.filter(post =>
          post.url.toLowerCase().includes(search) ||
          post.title?.toLowerCase().includes(search) ||
          post.author_username?.toLowerCase().includes(search) ||
          post.description?.toLowerCase().includes(search)
        );
      }

      setPosts(filteredData);
    } catch (error) {
      console.error('Error fetching external posts:', error);
      toast.error('Erro ao carregar posts externos');
    } finally {
      setIsLoading(false);
    }
  }, [options.platform, options.hasLead, options.searchTerm]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const addPost = async (url: string, platform: string = 'instagram') => {
    try {
      const { data, error } = await supabase
        .from('external_posts')
        .insert({ url, platform })
        .select()
        .single();

      if (error) throw error;

      toast.success('Post adicionado com sucesso!');
      await fetchPosts();
      return data;
    } catch (error: any) {
      console.error('Error adding post:', error);
      if (error.code === '23505') {
        toast.error('Este post já foi adicionado');
      } else {
        toast.error('Erro ao adicionar post');
      }
      return null;
    }
  };

  const updatePost = async (id: string, updates: Partial<Omit<ExternalPost, 'metadata' | 'lead'>>) => {
    try {
      const { error } = await supabase
        .from('external_posts')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast.success('Post atualizado!');
      await fetchPosts();
      return true;
    } catch (error) {
      console.error('Error updating post:', error);
      toast.error('Erro ao atualizar post');
      return false;
    }
  };

  const deletePost = async (id: string) => {
    try {
      const { error } = await supabase
        .from('external_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Post removido!');
      await fetchPosts();
      return true;
    } catch (error) {
      console.error('Error deleting post:', error);
      toast.error('Erro ao remover post');
      return false;
    }
  };

  const addNewsLink = async (id: string, link: string) => {
    const post = posts.find(p => p.id === id);
    if (!post) return false;

    const currentLinks = post.news_links || [];
    if (currentLinks.includes(link)) {
      toast.error('Este link já foi adicionado');
      return false;
    }

    return updatePost(id, { 
      news_links: [...currentLinks, link] 
    });
  };

  const removeNewsLink = async (id: string, link: string) => {
    const post = posts.find(p => p.id === id);
    if (!post) return false;

    const currentLinks = post.news_links || [];
    return updatePost(id, { 
      news_links: currentLinks.filter(l => l !== link) 
    });
  };

  const linkToLead = async (postId: string, leadId: string | null) => {
    return updatePost(postId, { lead_id: leadId });
  };

  const fetchCommentsForPost = async (postUrl: string, myUsername?: string) => {
    try {
      const { data, error } = await cloudFunctions.invoke('fetch-apify-comments', {
        body: { postUrls: [postUrl], myUsername }
      });

      if (error) throw error;

      if (data?.success) {
        // Update the post's last_fetched_at and comments_count
        const post = posts.find(p => p.url === postUrl);
        if (post) {
          await updatePost(post.id, {
            last_fetched_at: new Date().toISOString(),
            comments_count: data.total
          });
        }

        toast.success(`${data.savedToDatabase} comentários salvos!`);
        return data;
      } else {
        throw new Error(data?.error || 'Erro desconhecido');
      }
    } catch (error: any) {
      console.error('Error fetching comments:', error);
      toast.error(error.message || 'Erro ao buscar comentários');
      return null;
    }
  };

  return {
    posts,
    isLoading,
    fetchPosts,
    addPost,
    updatePost,
    deletePost,
    addNewsLink,
    removeNewsLink,
    linkToLead,
    fetchCommentsForPost,
  };
}

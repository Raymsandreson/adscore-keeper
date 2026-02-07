import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PostMetadata {
  caption: string;
  thumbnailUrl: string | null;
  ownerUsername: string;
  mediaType: 'image' | 'video';
  html?: string | null;
}

interface PostMetadataCache {
  [url: string]: PostMetadata | null;
}

// Global cache to avoid repeated fetches
const metadataCache: PostMetadataCache = {};

export function usePostMetadata() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async (postUrl: string): Promise<PostMetadata | null> => {
    if (!postUrl) return null;
    
    // Check cache first
    const normalizedUrl = postUrl.trim().replace(/\/$/, '');
    if (metadataCache[normalizedUrl] !== undefined) {
      return metadataCache[normalizedUrl];
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke('fetch-post-metadata', {
        body: { postUrl: normalizedUrl },
      });
      
      if (fnError) throw fnError;
      
      if (data?.success && data?.metadata) {
        const metadata: PostMetadata = {
          caption: data.metadata.caption || '',
          thumbnailUrl: data.metadata.thumbnailUrl || null,
          ownerUsername: data.metadata.ownerUsername || '',
          mediaType: data.metadata.mediaType || 'image',
          html: data.metadata.html,
        };
        
        // Cache the result
        metadataCache[normalizedUrl] = metadata;
        return metadata;
      }
      
      // Cache null result to avoid repeated fetches
      metadataCache[normalizedUrl] = null;
      return null;
      
    } catch (err) {
      console.error('Error fetching post metadata:', err);
      setError(err instanceof Error ? err.message : 'Erro ao buscar metadados');
      metadataCache[normalizedUrl] = null;
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getCachedMetadata = useCallback((postUrl: string): PostMetadata | null => {
    const normalizedUrl = postUrl.trim().replace(/\/$/, '');
    return metadataCache[normalizedUrl] || null;
  }, []);

  const clearCache = useCallback((postUrl?: string) => {
    if (postUrl) {
      const normalizedUrl = postUrl.trim().replace(/\/$/, '');
      delete metadataCache[normalizedUrl];
    } else {
      Object.keys(metadataCache).forEach(key => delete metadataCache[key]);
    }
  }, []);

  return {
    fetchMetadata,
    getCachedMetadata,
    clearCache,
    isLoading,
    error,
  };
}

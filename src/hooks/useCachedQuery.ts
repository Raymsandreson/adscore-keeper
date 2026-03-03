import { useCallback } from 'react';
import { cacheSet, cacheGet, CACHE_TTL } from '@/lib/offlineCache';
import { useAuthContext } from '@/contexts/AuthContext';

/**
 * Hook that wraps Supabase queries with offline cache fallback.
 * On success: caches data. On failure in offline mode: returns cached data.
 */
export function useCachedQuery() {
  const { isOfflineMode } = useAuthContext();

  const cachedQuery = useCallback(async <T>(
    key: string,
    queryFn: () => Promise<{ data: T | null; error: any }>,
    ttl: number = CACHE_TTL.GENERAL,
  ): Promise<{ data: T | null; error: any; fromCache: boolean; cacheAge?: number }> => {
    try {
      const result = await queryFn();
      
      if (!result.error && result.data) {
        // Cache successful results
        cacheSet(key, result.data, ttl);
        return { ...result, fromCache: false };
      }

      // If query failed, try cache
      if (result.error) {
        const cached = cacheGet<T>(key);
        if (cached?.data) {
          console.log(`[Cache] Serving cached data for "${key}" (age: ${Math.round(cached.age / 1000)}s)`);
          return { data: cached.data, error: null, fromCache: true, cacheAge: cached.age };
        }
      }

      return { ...result, fromCache: false };
    } catch (err) {
      // Network error - try cache
      const cached = cacheGet<T>(key);
      if (cached?.data) {
        console.log(`[Cache] Network error, serving cached data for "${key}"`);
        return { data: cached.data, error: null, fromCache: true, cacheAge: cached.age };
      }
      return { data: null, error: err, fromCache: false };
    }
  }, []);

  return { cachedQuery, isOfflineMode };
}

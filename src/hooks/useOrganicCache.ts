const CACHE_KEY = 'organic_insights_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface OrganicCacheData {
  platforms: any[];
  isRealData: boolean;
  timestamp: number;
  fetchKey: string;
}

interface CacheEntry {
  data: OrganicCacheData;
  expiresAt: number;
}

export const useOrganicCache = () => {
  const getCachedData = (fetchKey: string): OrganicCacheData | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is expired
      if (now > entry.expiresAt) {
        console.log('🗑️ Cache expirado, removendo...');
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      // Check if fetch key matches (same parameters)
      if (entry.data.fetchKey !== fetchKey) {
        console.log('🔄 Parâmetros mudaram, cache inválido');
        return null;
      }

      const ageSeconds = Math.round((now - entry.data.timestamp) / 1000);
      console.log(`✅ Cache válido encontrado (${ageSeconds}s atrás)`);
      return entry.data;
    } catch (error) {
      console.error('Erro ao ler cache:', error);
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  };

  const setCachedData = (data: Omit<OrganicCacheData, 'timestamp'>) => {
    try {
      const entry: CacheEntry = {
        data: {
          ...data,
          timestamp: Date.now(),
        },
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
      console.log('💾 Dados salvos no cache (TTL: 5 min)');
    } catch (error) {
      console.error('Erro ao salvar cache:', error);
    }
  };

  const clearCache = () => {
    localStorage.removeItem(CACHE_KEY);
    console.log('🗑️ Cache limpo manualmente');
  };

  const getCacheAge = (): number | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      return Math.round((Date.now() - entry.data.timestamp) / 1000);
    } catch {
      return null;
    }
  };

  return {
    getCachedData,
    setCachedData,
    clearCache,
    getCacheAge,
  };
};

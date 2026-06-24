// Module-level stale-while-revalidate cache for useLeads.
// Shared across all hook instances so navigating between pages doesn't refetch.
import type { Lead, LeadStats } from './useLeads';

type CacheKey = string; // adAccountId ?? '__all__'

interface CacheEntry {
  leads: Lead[];
  stats: LeadStats | null;
  fetchedAt: number;
  inflight: Promise<Lead[]> | null;
  subscribers: Set<(leads: Lead[], stats: LeadStats | null) => void>;
}

const FRESH_TTL = 60_000;       // 1 min: serve sem revalidar
export const HARD_TTL = 10 * 60_000; // 10 min: serve mas força loading se vazio
const STORAGE_PREFIX = 'adscore:leads-cache:v1:';
const STORAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

const cache = new Map<CacheKey, CacheEntry>();

export const keyFor = (adAccountId?: string): CacheKey => adAccountId || '__all__';

const emptyStats: LeadStats = {
  total: 0, new: 0, contacted: 0, qualified: 0, notQualified: 0,
  converted: 0, lost: 0, comment: 0, totalSpent: 0, totalRevenue: 0,
  costPerLead: 0, costPerConvertedLead: 0, conversionRate: 0, qualificationRate: 0,
};

function ensure(key: CacheKey): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      leads: [],
      stats: null,
      fetchedAt: 0,
      inflight: null,
      subscribers: new Set(),
    };
    // Try to hydrate from sessionStorage
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.leads)) {
          entry.leads = parsed.leads;
          entry.stats = parsed.stats || null;
          entry.fetchedAt = parsed.fetchedAt || 0;
        }
      }
    } catch { /* ignore */ }
    cache.set(key, entry);
  }
  return entry;
}

function persist(key: CacheKey, entry: CacheEntry) {
  try {
    const payload = JSON.stringify({
      leads: entry.leads,
      stats: entry.stats,
      fetchedAt: entry.fetchedAt,
    });
    if (payload.length > STORAGE_MAX_BYTES) return;
    sessionStorage.setItem(STORAGE_PREFIX + key, payload);
  } catch { /* sessionStorage full or unavailable */ }
}

export const leadsCache = {
  get(adAccountId?: string) {
    return ensure(keyFor(adAccountId));
  },

  isFresh(adAccountId?: string) {
    const e = ensure(keyFor(adAccountId));
    return e.leads.length > 0 && Date.now() - e.fetchedAt < FRESH_TTL;
  },

  hasAny(adAccountId?: string) {
    return ensure(keyFor(adAccountId)).leads.length > 0;
  },

  set(adAccountId: string | undefined, leads: Lead[], stats: LeadStats) {
    const key = keyFor(adAccountId);
    const entry = ensure(key);
    entry.leads = leads;
    entry.stats = stats;
    entry.fetchedAt = Date.now();
    persist(key, entry);
    entry.subscribers.forEach(cb => cb(leads, stats));
  },

  // Apply a functional update (used by realtime / mutations)
  update(
    adAccountId: string | undefined,
    updater: (leads: Lead[]) => Lead[],
    recalcStats?: (leads: Lead[]) => LeadStats,
  ) {
    const key = keyFor(adAccountId);
    const entry = ensure(key);
    const next = updater(entry.leads);
    if (next === entry.leads) return;
    entry.leads = next;
    if (recalcStats) entry.stats = recalcStats(next);
    entry.fetchedAt = Date.now();
    persist(key, entry);
    entry.subscribers.forEach(cb => cb(entry.leads, entry.stats));
  },

  setInflight(adAccountId: string | undefined, p: Promise<Lead[]> | null) {
    ensure(keyFor(adAccountId)).inflight = p;
  },

  subscribe(adAccountId: string | undefined, cb: (leads: Lead[], stats: LeadStats | null) => void) {
    const entry = ensure(keyFor(adAccountId));
    entry.subscribers.add(cb);
    return () => entry.subscribers.delete(cb);
  },

  emptyStats,
};

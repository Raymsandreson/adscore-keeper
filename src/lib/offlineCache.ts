/**
 * Offline Cache - stores critical data in localStorage for offline/degraded access.
 * Uses versioned keys with TTL for automatic expiration.
 */

const CACHE_PREFIX = 'whatsjud_cache_';
const CACHE_VERSION = 'v1_';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // in milliseconds
}

// Default TTLs
export const CACHE_TTL = {
  SESSION: 24 * 60 * 60 * 1000,    // 24h - auth session
  PROFILE: 12 * 60 * 60 * 1000,    // 12h - user profile
  LEADS: 10 * 60 * 1000,            // 10min - leads list
  CONTACTS: 10 * 60 * 1000,         // 10min - contacts list
  ACTIVITIES: 5 * 60 * 1000,        // 5min - activities
  BOARDS: 30 * 60 * 1000,           // 30min - kanban boards
  GENERAL: 5 * 60 * 1000,           // 5min - general data
} as const;

function getKey(key: string): string {
  return `${CACHE_PREFIX}${CACHE_VERSION}${key}`;
}

export function cacheSet<T>(key: string, data: T, ttl: number = CACHE_TTL.GENERAL): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
    localStorage.setItem(getKey(key), JSON.stringify(entry));
  } catch (e) {
    // localStorage full - evict oldest entries
    evictOldest();
    try {
      const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
      localStorage.setItem(getKey(key), JSON.stringify(entry));
    } catch {
      console.warn('[Cache] Could not save:', key);
    }
  }
}

export function cacheGet<T>(key: string): { data: T; isStale: boolean; age: number } | null {
  try {
    const raw = localStorage.getItem(getKey(key));
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;
    const isStale = age > entry.ttl;

    return { data: entry.data, isStale, age };
  } catch {
    return null;
  }
}

export function cacheRemove(key: string): void {
  localStorage.removeItem(getKey(key));
}

export function cacheClear(): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
}

function evictOldest(): void {
  const entries: { key: string; timestamp: number }[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const entry = JSON.parse(localStorage.getItem(key)!);
      entries.push({ key, timestamp: entry.timestamp || 0 });
    } catch {
      entries.push({ key, timestamp: 0 });
    }
  }

  // Remove oldest 25%
  entries.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = Math.max(1, Math.floor(entries.length * 0.25));
  entries.slice(0, toRemove).forEach(e => localStorage.removeItem(e.key));
}

// Connectivity detection
let isOnline = navigator.onLine;
const listeners = new Set<(online: boolean) => void>();

window.addEventListener('online', () => { isOnline = true; listeners.forEach(l => l(true)); });
window.addEventListener('offline', () => { isOnline = false; listeners.forEach(l => l(false)); });

export function getIsOnline(): boolean {
  return isOnline;
}

export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Format cache age for display
 */
export function formatCacheAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s atrás`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h atrás`;
}

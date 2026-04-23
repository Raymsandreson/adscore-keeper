/**
 * Hook Tracer — logger leve em memória para diagnosticar re-renders e
 * disparos repetidos de hooks/efeitos. Sem dependência externa, zero custo
 * quando a página de debug não está aberta (apenas push num array circular).
 *
 * Uso:
 *   import { traceHook } from '@/utils/hookTracer';
 *   traceHook('useAuth.initialize', { reason: 'mount' });
 *   traceHook('fetchMessages', { triggerSync, selectedInstanceId });
 */

export type HookTraceEntry = {
  id: number;
  ts: number;          // performance.now()
  wallTime: number;    // Date.now()
  name: string;        // ex: "useWhatsAppMessages.fetchMessages"
  detail?: Record<string, unknown>;
  // diff em ms desde o último disparo do MESMO name
  deltaMs: number | null;
};

type Listener = (entries: HookTraceEntry[]) => void;

const MAX_ENTRIES = 500;

const entries: HookTraceEntry[] = [];
const counters = new Map<string, number>();
const lastTsByName = new Map<string, number>();
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  // snapshot defensivo para o React detectar mudança
  const snapshot = entries.slice();
  listeners.forEach((l) => {
    try {
      l(snapshot);
    } catch {
      // ignore
    }
  });
}

export function traceHook(name: string, detail?: Record<string, unknown>) {
  const ts = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const last = lastTsByName.get(name) ?? null;
  const deltaMs = last == null ? null : Math.round(ts - last);
  lastTsByName.set(name, ts);
  counters.set(name, (counters.get(name) ?? 0) + 1);

  const entry: HookTraceEntry = {
    id: nextId++,
    ts,
    wallTime: Date.now(),
    name,
    detail,
    deltaMs,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  notify();
}

export function getHookTraceSnapshot(): HookTraceEntry[] {
  return entries.slice();
}

export function getHookCounters(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}

export function clearHookTrace() {
  entries.length = 0;
  counters.clear();
  lastTsByName.clear();
  notify();
}

export function subscribeHookTrace(listener: Listener): () => void {
  listeners.add(listener);
  // chamada inicial
  try {
    listener(entries.slice());
  } catch {}
  return () => {
    listeners.delete(listener);
  };
}

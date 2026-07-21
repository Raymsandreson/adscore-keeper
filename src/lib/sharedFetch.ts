/**
 * Cache compartilhado por chave para hooks de configuração global
 * (tipos de atividade, lista de perfis, OABs do sistema, etc).
 *
 * Motivo: esses hooks eram `useState` + `useEffect` puros, então cada instância
 * do componente disparava a própria requisição. Na aba Casos, 1.594 itens de
 * lista montavam ~5 desses hooks cada — ~8.000 requisições no load, o que
 * saturava o pool de conexões do navegador e produzia erros intermitentes.
 *
 * Duas garantias:
 *  - montagens simultâneas compartilham UMA requisição (dedupe do promise);
 *  - o resultado fica em cache por `TTL_MS`, então remontagens logo em seguida
 *    pintam na hora. Passado o TTL, revalida — mantém o comportamento antigo
 *    de "dado fresco a cada navegação" e evita cachear um resultado vazio
 *    obtido antes do login.
 *
 * Erro nunca é cacheado: a próxima montagem tenta de novo.
 */
import { useEffect, useRef, useState } from 'react';

const TTL_MS = 30_000;

interface Entry<T> {
  data?: T;
  fetchedAt: number;
  promise: Promise<T> | null;
  listeners: Set<(value: T) => void>;
}

const entries = new Map<string, Entry<unknown>>();

function getEntry<T>(key: string): Entry<T> {
  let e = entries.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { fetchedAt: 0, promise: null, listeners: new Set() };
    entries.set(key, e as Entry<unknown>);
  }
  return e;
}

function publish<T>(entry: Entry<T>, value: T) {
  entry.data = value;
  entry.fetchedAt = Date.now();
  for (const listener of entry.listeners) listener(value);
}

function run<T>(entry: Entry<T>, fetcher: () => Promise<T>): Promise<T> {
  const p = fetcher()
    .then(value => {
      if (entry.promise === p) entry.promise = null;
      publish(entry, value);
      return value;
    })
    .catch(err => {
      // Falha não vira cache — a próxima montagem tenta de novo.
      if (entry.promise === p) entry.promise = null;
      throw err;
    });
  entry.promise = p;
  return p;
}

/**
 * Substitui o valor em cache e avisa todas as instâncias montadas.
 * Usado por updates otimistas (ex.: reordenar tipos de atividade).
 */
export function setSharedData<T>(key: string, value: T) {
  publish(getEntry<T>(key), value);
}

export interface SharedFetchResult<T> {
  data: T;
  loading: boolean;
  /** Refaz a busca ignorando o TTL e propaga para todas as instâncias. */
  refetch: () => Promise<void>;
}

export function useSharedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): SharedFetchResult<T> {
  const entry = getEntry<T>(key);
  const fresh = entry.data !== undefined && Date.now() - entry.fetchedAt < TTL_MS;

  const [data, setData] = useState<T>(entry.data !== undefined ? entry.data : fallback);
  const [loading, setLoading] = useState(!fresh);

  // O fetcher costuma ser uma arrow recriada a cada render; guardar em ref
  // evita que o efeito rode de novo sem necessidade.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let mounted = true;
    const e = getEntry<T>(key);
    const listener = (value: T) => { if (mounted) setData(value); };
    e.listeners.add(listener);

    const isFresh = e.data !== undefined && Date.now() - e.fetchedAt < TTL_MS;
    if (isFresh) {
      setData(e.data as T);
      setLoading(false);
    } else {
      // Se já existe uma busca em voo, entra de carona nela.
      const p = e.promise ?? run(e, () => fetcherRef.current());
      setLoading(true);
      p.then(() => { if (mounted) setLoading(false); })
       .catch(() => { if (mounted) setLoading(false); });
    }

    return () => { mounted = false; e.listeners.delete(listener); };
  }, [key]);

  const refetch = useRef(async () => {
    const e = getEntry<T>(key);
    try {
      await run(e, () => fetcherRef.current());
    } catch {
      /* erro já foi tratado/logado pelo fetcher */
    }
  }).current;

  return { data, loading, refetch };
}

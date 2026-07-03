import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Persiste estado de página no localStorage por chave.
 * Restaura automaticamente ao montar o componente.
 * Sincroniza entre abas/janelas via evento 'storage'.
 * Usa localStorage para que o estado persista entre abas do navegador
 * e ao navegar entre seções do sistema.
 */
export function usePageState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `page_state_${key}`;
  const defaultRef = useRef(defaultValue);

  const readStored = useCallback((): T => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {}
    return defaultRef.current;
  }, [storageKey]);

  const [state, setStateRaw] = useState<T>(readStored);

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [storageKey]);

  // Sincroniza entre abas/janelas e quando o app volta do background no mobile
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue !== null) {
        try {
          setStateRaw(JSON.parse(e.newValue) as T);
        } catch {}
      }
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        setStateRaw(readStored());
      }
    };

    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [storageKey, readStored]);

  return [state, setState];
}

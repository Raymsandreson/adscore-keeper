import { useState, useCallback } from 'react';

/**
 * Persiste estado de página no localStorage por chave.
 * Restaura automaticamente ao montar o componente.
 * Usa localStorage para que o estado persista entre abas do navegador
 * e ao navegar entre seções do sistema.
 */
export function usePageState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `page_state_${key}`;

  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {}
    return defaultValue;
  });

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [storageKey]);

  return [state, setState];
}

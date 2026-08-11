import { useMemo } from 'react';
import { useSharedFetch } from '@/lib/sharedFetch';
import { fetchInactiveUserIds } from '@/lib/inactiveUsers';

const EMPTY: string[] = [];

/**
 * Mantém a lista de desativados carregada para este componente e o repinta
 * quando ela chega. Todo componente que renderiza seletor de assessor deve
 * chamar — é ele que faz `filterAssignableMembers` enxergar os desativados
 * (a lista fica em src/lib/assigneeBlocklist.ts).
 *
 * A busca é compartilhada: montar em 20 lugares continua sendo 1 requisição.
 */
export function useInactiveUserIds(): Set<string> {
  const { data } = useSharedFetch<string[]>(
    'inactive_user_ids',
    async () => Array.from(await fetchInactiveUserIds()),
    EMPTY,
  );
  return useMemo(() => new Set(data), [data]);
}

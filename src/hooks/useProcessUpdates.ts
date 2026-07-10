import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

export type UpdateCategoria =
  | 'decisao_merito'
  | 'audiencia'
  | 'pericia'
  | 'prazo'
  | 'despacho'
  | 'movimentacao';

export interface ProcessUpdate {
  id: string;
  process_id: string;
  lead_id: string | null;
  case_id: string | null;
  numero_cnj: string | null;
  processo_titulo: string | null;
  categoria: UpdateCategoria;
  titulo: string;
  descricao: string | null;
  data_movimentacao: string | null;
  created_at: string;
}

const LAST_SEEN_KEY = 'process-updates-last-seen';
const FETCH_LIMIT = 100;

/**
 * Feed do sino de atualizações processuais (tabela process_updates no Externo,
 * alimentada pela edge sync-process-compromissos). Realtime via INSERT;
 * "lido" é um timestamp local por dispositivo (localStorage).
 */
export const useProcessUpdates = () => {
  const [updates, setUpdates] = useState<ProcessUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(LAST_SEEN_KEY) || '');

  const fetchUpdates = useCallback(async () => {
    try {
      await ensureExternalSession();
      // process_updates ainda não está no types.ts gerado (mesmo caso de process_movements).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data, error } = await client
        .from('process_updates')
        .select('id, process_id, lead_id, case_id, numero_cnj, processo_titulo, categoria, titulo, descricao, data_movimentacao, created_at')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);
      if (error) throw error;
      setUpdates((data || []) as ProcessUpdate[]);
    } catch (err) {
      console.error('Error fetching process updates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUpdates();

    const channel = db
      .channel('process-updates-bell')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'process_updates' },
        (payload) => {
          const novo = payload.new as ProcessUpdate;
          setUpdates((prev) => [novo, ...prev].slice(0, FETCH_LIMIT));
        },
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [fetchUpdates]);

  const unreadCount = useMemo(
    () => updates.filter((u) => !lastSeen || u.created_at > lastSeen).length,
    [updates, lastSeen],
  );

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(LAST_SEEN_KEY, now);
    setLastSeen(now);
  }, []);

  return { updates, loading, unreadCount, lastSeen, markAllRead, refetch: fetchUpdates };
};

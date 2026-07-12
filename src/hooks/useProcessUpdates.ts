import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';

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

const FETCH_LIMIT = 100;

/**
 * Feed do sino de atualizações processuais (process_updates no Externo,
 * alimentada pela edge sync-process-compromissos + cron diário 5h).
 * Lido/não-lido é POR USUÁRIO, persistido em process_update_reads
 * (user_id = profile do Externo via remapToExternal).
 */
export const useProcessUpdates = () => {
  const { user } = useAuthContext();
  const [updates, setUpdates] = useState<ProcessUpdate[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [extUserId, setExtUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      await ensureExternalSession();
      const uid = user?.id ? await remapToExternal(user.id) : null;
      setExtUserId(uid);

      // process_updates/process_update_reads ainda não estão no types.ts gerado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data, error } = await client
        .from('process_updates')
        .select('id, process_id, lead_id, case_id, numero_cnj, processo_titulo, categoria, titulo, descricao, data_movimentacao, created_at')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);
      if (error) throw error;
      const rows = (data || []) as ProcessUpdate[];
      setUpdates(rows);

      if (uid && rows.length) {
        const { data: reads } = await client
          .from('process_update_reads')
          .select('update_id')
          .eq('user_id', uid)
          .in('update_id', rows.map((r) => r.id));
        setReadIds(new Set((reads || []).map((r: { update_id: string }) => r.update_id)));
      }
    } catch (err) {
      console.error('Error fetching process updates:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();

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
  }, [fetchAll]);

  const unreadCount = useMemo(
    () => updates.filter((u) => !readIds.has(u.id)).length,
    [updates, readIds],
  );

  const persistReads = useCallback(async (ids: string[]) => {
    if (!extUserId || !ids.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { error } = await client
      .from('process_update_reads')
      .upsert(ids.map((id) => ({ update_id: id, user_id: extUserId })), {
        onConflict: 'update_id,user_id',
        ignoreDuplicates: true,
      });
    if (error) console.error('Error marking updates read:', error);
  }, [extUserId]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    persistReads([id]);
  }, [persistReads]);

  const markAllRead = useCallback(() => {
    const pendentes = updates.filter((u) => !readIds.has(u.id)).map((u) => u.id);
    setReadIds(new Set(updates.map((u) => u.id)));
    persistReads(pendentes);
  }, [updates, readIds, persistReads]);

  return { updates, loading, unreadCount, readIds, markRead, markAllRead, refetch: fetchAll };
};

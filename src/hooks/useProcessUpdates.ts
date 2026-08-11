import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { classificarEsfera, type Esfera } from '@/lib/esferaJustica';

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
  /** Ramo da Justiça (migration 20260811210000). Null em linhas antigas. */
  esfera: Esfera | null;
  categoria: UpdateCategoria;
  titulo: string;
  descricao: string | null;
  data_movimentacao: string | null;
  created_at: string;
}

/** Etiqueta "Notificado" — o cliente já foi avisado desta movimentação. */
export interface UpdateNotificacao {
  update_id: string;
  notified_at: string;
  notified_by_name: string | null;
  activity_id: string | null;
}

const FETCH_LIMIT = 100;

const COLUNAS = 'id, process_id, lead_id, case_id, numero_cnj, processo_titulo, esfera, categoria, titulo, descricao, data_movimentacao, created_at';
// Sem a migration da esfera aplicada, o select acima falha inteiro e o sino fica
// vazio. Fallback mantém o sino funcionando (só sem o filtro por ramo).
const COLUNAS_SEM_ESFERA = COLUNAS.replace(', esfera', '');

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
  const [notificadas, setNotificadas] = useState<Map<string, UpdateNotificacao>>(new Map());
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
      const buscar = (colunas: string) => client
        .from('process_updates')
        .select(colunas)
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT);

      let { data, error } = await buscar(COLUNAS);
      if (error) ({ data, error } = await buscar(COLUNAS_SEM_ESFERA));
      if (error) throw error;
      // Linha antiga (ou banco sem a coluna): classifica pelo CNJ na hora, para
      // o filtro por ramo já valer sem esperar o backfill.
      const rows = ((data || []) as ProcessUpdate[]).map((r) => ({
        ...r,
        esfera: r.esfera || classificarEsfera({ numeroCnj: r.numero_cnj, titulo: r.processo_titulo }),
      }));
      setUpdates(rows);

      if (rows.length) {
        const ids = rows.map((r) => r.id);
        if (uid) {
          const { data: reads } = await client
            .from('process_update_reads')
            .select('update_id')
            .eq('user_id', uid)
            .in('update_id', ids);
          setReadIds(new Set((reads || []).map((r: { update_id: string }) => r.update_id)));
        }
        // Etiqueta "Notificado" é global (fato do caso), não por usuário.
        const { data: notifs, error: notifErr } = await client
          .from('process_update_notifications')
          .select('update_id, notified_at, notified_by_name, activity_id')
          .in('update_id', ids);
        if (notifErr) {
          console.warn('[useProcessUpdates] etiqueta de notificação indisponível:', notifErr.message);
        } else {
          setNotificadas(new Map((notifs || []).map((n: UpdateNotificacao) => [n.update_id, n])));
        }
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
          const bruto = payload.new as ProcessUpdate;
          const novo = {
            ...bruto,
            esfera: bruto.esfera || classificarEsfera({ numeroCnj: bruto.numero_cnj, titulo: bruto.processo_titulo }),
          };
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

  /**
   * Carimba a etiqueta "Notificado" na movimentação. Upsert: reenvio atualiza
   * quem mandou e quando, sem criar linha nova (update_id é a PK).
   */
  const markNotified = useCallback(async (
    updateId: string,
    info: { activityId?: string | null; groupJid?: string | null; notifiedByName?: string | null },
  ) => {
    const registro: UpdateNotificacao = {
      update_id: updateId,
      notified_at: new Date().toISOString(),
      notified_by_name: info.notifiedByName || null,
      activity_id: info.activityId || null,
    };
    setNotificadas((prev) => new Map(prev).set(updateId, registro));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { error } = await client
      .from('process_update_notifications')
      .upsert({
        ...registro,
        notified_by: extUserId,
        channel: 'whatsapp_grupo',
        group_jid: info.groupJid || null,
      }, { onConflict: 'update_id' });
    if (error) console.error('Error marking update notified:', error);
  }, [extUserId]);

  return {
    updates, loading, unreadCount, readIds, markRead, markAllRead,
    notificadas, markNotified, refetch: fetchAll,
  };
};

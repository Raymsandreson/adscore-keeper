/**
 * Caixa de pendências do cliente — todas as conversas, não uma só.
 *
 * Existe para tirar a dependência de alguém lembrar de abrir a conversa: as
 * promessas do cliente aparecem numa lista por data, como o funil de feedbacks.
 *
 * Lê `vw_client_commitments_owner` (Externo), que resolve de quem é cada
 * pendência com a MESMA cascata usada pelo telão — responsável do processo >
 * responsável processual do lead > último assessor que trabalhou o lead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { useAuthContext } from '@/contexts/AuthContext';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { isCommitmentOpen, isCommitmentOverdue } from '@/lib/clientCommitments';
import type { InboxCommitment } from '@/lib/clientCommitmentsInbox';

const SELECT = `id, lead_id, process_id, contact_id, phone, instance_name, title, kind, status,
  due_date, promised_at, source_message_id, source_message_text, notes, last_reminded_at,
  reminder_count, done_at, done_by_name, created_by_name, created_at, origin, ai_confidence,
  owner_user_id, lead_name`;

/** Teto de linhas: a caixa é operacional, não relatório histórico. */
const LIMITE = 500;

export function useClientCommitmentsInbox({ enabled = true }: { enabled?: boolean } = {}) {
  const { user, profile } = useAuthContext();
  const [items, setItems] = useState<InboxCommitment[]>([]);
  const [loading, setLoading] = useState(false);
  const [meExtId, setMeExtId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    remapToExternal(user?.id).then((id) => { if (!cancelled) setMeExtId(id); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('vw_client_commitments_owner')
        .select(SELECT)
        .in('status', ['combinado', 'cobrado'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(LIMITE);
      if (error) throw error;
      setItems((data as InboxCommitment[]) || []);
    } catch {
      console.warn('[useClientCommitmentsInbox] falha ao carregar a caixa de pendências');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  const minhas = useMemo(
    () => (meExtId ? items.filter((i) => i.owner_user_id === meExtId) : []),
    [items, meExtId]
  );

  const vencidas = useMemo(() => items.filter((i) => isCommitmentOverdue(i)), [items]);

  /** Donos presentes na lista, para o filtro por pessoa. */
  const donos = useMemo(() => {
    const ids = new Set<string>();
    for (const i of items) if (i.owner_user_id) ids.add(i.owner_user_id);
    return [...ids];
  }, [items]);

  const patch = useCallback(async (id: string, changes: Record<string, unknown>) => {
    // A escrita vai na TABELA; a view é só leitura com o dono resolvido.
    const { error } = await (db as any)
      .from('lead_client_commitments')
      .update(changes)
      .eq('id', id);
    if (error) throw error;
    setItems((prev) => prev.filter((i) => i.id !== id || isCommitmentOpen(
      (changes.status as never) ?? i.status
    )));
  }, []);

  const markDone = useCallback(
    async (id: string, resolver?: { userId?: string | null; name?: string | null }) => {
      const extUserId = await remapToExternal(resolver?.userId ?? user?.id);
      await patch(id, {
        status: 'feito',
        done_at: new Date().toISOString(),
        done_by: extUserId,
        done_by_name: resolver?.name || profile?.full_name || null,
      });
    },
    [patch, user?.id, profile?.full_name]
  );

  const dismiss = useCallback(
    (id: string) => patch(id, { status: 'descartada', dismissed_at: new Date().toISOString() }),
    [patch]
  );

  return { items, minhas, vencidas, donos, loading, reload: load, markDone, dismiss, meExtId };
}

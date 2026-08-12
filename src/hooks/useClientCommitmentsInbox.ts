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
import { isCommitmentConverted, type InboxCommitment } from '@/lib/clientCommitmentsInbox';

const SELECT = `id, lead_id, process_id, contact_id, phone, instance_name, title, kind, status,
  due_date, promised_at, source_message_id, source_message_text, notes, last_reminded_at,
  reminder_count, done_at, done_by_name, created_by_name, created_at, origin, ai_confidence,
  owner_user_id, lead_name, activity_id, converted_at, assigned_to`;

/**
 * Tamanho da página de leitura. A caixa lê TODAS as pendências em aberto, em
 * páginas, porque teto fixo escondia pendência real: com `limit(500)` ordenado
 * por `due_date` (nulos no fim), as 462 sem prazo de 12/08/2026 disputavam 271
 * vagas — 191 nunca chegavam à tela, e quem tinha só uma delas via "nenhuma
 * pendência" enquanto o telão (que lê a mesma view sem teto) cobrava o número.
 */
const PAGINA = 1000;

/**
 * Trava de segurança: se o backlog explodir, a caixa para de crescer em vez de
 * travar o navegador. Hoje são ~700 abertas.
 */
const TETO = 5000;

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
      // Ordem por `created_at` só para paginar de forma estável — quem ordena o
      // que aparece na tela é `commitmentDate` (prazo, ou o dia em que foi
      // combinada), do lado do cliente.
      const todas: InboxCommitment[] = [];
      for (let inicio = 0; inicio < TETO; inicio += PAGINA) {
        const { data, error } = await (db as any)
          .from('vw_client_commitments_owner')
          .select(SELECT)
          .in('status', ['combinado', 'cobrado'])
          .order('created_at', { ascending: true })
          .range(inicio, inicio + PAGINA - 1);
        if (error) throw error;
        const pagina = (data as InboxCommitment[]) || [];
        todas.push(...pagina);
        if (pagina.length < PAGINA) break;
      }
      setItems(todas);
    } catch {
      console.warn('[useClientCommitmentsInbox] falha ao carregar a caixa de pendências');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  /** O que ainda está na fila de cobrança — o que virou atividade sai daqui. */
  const emCobranca = useMemo(() => items.filter((i) => !isCommitmentConverted(i)), [items]);

  const minhas = useMemo(
    () => (meExtId ? emCobranca.filter((i) => i.owner_user_id === meExtId) : []),
    [emCobranca, meExtId]
  );

  const vencidas = useMemo(() => emCobranca.filter((i) => isCommitmentOverdue(i)), [emCobranca]);

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

  /**
   * Muda a linha e recarrega ELA sozinha da view.
   *
   * Releitura em vez de merge local porque `owner_user_id` é calculado pela
   * cascata da view — escrever `assigned_to` e adivinhar o dono aqui repetiria
   * a regra em dois lugares, que é como ela sai de sincronia.
   */
  const patchInPlace = useCallback(async (id: string, changes: Record<string, unknown>) => {
    const { error } = await (db as any)
      .from('lead_client_commitments')
      .update(changes)
      .eq('id', id);
    if (error) throw error;

    const { data } = await (db as any)
      .from('vw_client_commitments_owner')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (data) setItems((prev) => prev.map((i) => (i.id === id ? (data as InboxCommitment) : i)));
  }, []);

  /**
   * Registra que a pendência virou atividade do escritório. Não fecha a
   * pendência: o cliente continua devendo o que prometeu — o que muda é que
   * agora existe tarefa nossa cuidando disso, então ela sai da fila de cobrança.
   */
  const markConverted = useCallback(
    (id: string, activityId: string) =>
      patchInPlace(id, { activity_id: activityId, converted_at: new Date().toISOString() }),
    [patchInPlace]
  );

  /**
   * Troca à mão quem cuida da pendência. `null` devolve para o automático (a
   * cascata do caso/conversa/linha).
   */
  const setAssignee = useCallback(
    (id: string, extUserId: string | null) =>
      patchInPlace(id, {
        assigned_to: extUserId,
        assigned_at: extUserId ? new Date().toISOString() : null,
      }),
    [patchInPlace]
  );

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

  return {
    items, minhas, vencidas, donos, loading, reload: load,
    markDone, dismiss, markConverted, setAssignee, meExtId,
  };
}

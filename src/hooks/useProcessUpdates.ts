import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { classificarEsfera, type Esfera } from '@/lib/esferaJustica';
import { responsavelDoPassoAberto } from '@/lib/leadStepContext';
import { showNativeNotification } from '@/lib/nativeNotification';
import { ASSIGNEE_BLOCKLIST } from '@/lib/assigneeBlocklist';

export type UpdateCategoria =
  | 'decisao_merito'
  | 'audiencia'
  | 'pericia'
  | 'prazo'
  | 'despacho'
  | 'movimentacao';

/** Um evento do push do tribunal, como veio no e-mail. */
export interface EventoProcesso {
  data: string | null;
  hora: string | null;
  texto: string;
}

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
  /**
   * Eventos do push agrupado (migration 20260812150000). Null nas linhas do
   * Escavador e nas do layout de tabela, em que cada movimento já é uma linha.
   */
  eventos: EventoProcesso[] | null;
}

/** Etiqueta "Notificado" — o cliente já foi avisado desta movimentação. */
export interface UpdateNotificacao {
  update_id: string;
  notified_at: string;
  notified_by_name: string | null;
  activity_id: string | null;
}

// Exportado porque o sino precisa saber quando a lista está no teto: um período
// que abrange tudo que foi carregado vira "100+" no chip, e não "100" cravado.
export const FETCH_LIMIT = 100;

/** Mesma ordem do `order()` da busca — usada para reencaixar o que vem do realtime. */
const ordemDoFeed = (a: ProcessUpdate, b: ProcessUpdate): number => {
  const da = a.data_movimentacao || '';
  const dbb = b.data_movimentacao || '';
  // Sem data de movimentação vai para o fim, igual ao nullsFirst: false.
  if (da !== dbb) return da && dbb ? (da < dbb ? 1 : -1) : (da ? -1 : 1);
  return a.created_at < b.created_at ? 1 : -1;
};

const COLUNAS = 'id, process_id, lead_id, case_id, numero_cnj, processo_titulo, esfera, categoria, titulo, descricao, data_movimentacao, created_at, eventos';
// Coluna que falta derruba o select INTEIRO e o sino fica vazio em silêncio —
// já aconteceu com callback_at em lead_activities. Então cada coluna nova entra
// com degrau de recuo próprio: sem eventos ainda dá para ler o feed, e sem
// esfera dá para ler sem o filtro por ramo.
const COLUNAS_SEM_EVENTOS = COLUNAS.replace(', eventos', '');
const COLUNAS_SEM_ESFERA = COLUNAS_SEM_EVENTOS.replace(', esfera', '');

/**
 * Feed do sino de atualizações processuais (process_updates no Externo,
 * alimentada pela edge sync-process-compromissos + cron diário 5h).
 * Lido/não-lido é POR USUÁRIO, persistido em process_update_reads
 * (user_id = profile do Externo via remapToExternal).
 *
 * `opts.processId` restringe o feed a um processo só — é o que permite o mesmo
 * sino virar atalho dentro da ficha da atividade ("tem movimentação NESTE
 * processo?"). Filtrar a lista global no cliente não serviria: ela é cortada nas
 * FETCH_LIMIT mais recentes de todo mundo, então um processo parado há duas
 * semanas apareceria como "nenhuma atualização".
 */
export const useProcessUpdates = (opts?: { processId?: string | null }) => {
  const scopeProcessId = opts?.processId || null;
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
      // Ordem pela data DA MOVIMENTAÇÃO, não pela da linha.
      //
      // Ordenar por created_at parecia igual e não era: o backfill do Escavador
      // e do DataJud insere linhas novas com movimentação velha, e elas tomavam
      // as FETCH_LIMIT vagas. Em 12/08/2026 o banco tinha 22 movimentações do
      // dia e 26 do anterior — o sino mostrava 3 e 0. O filtro de período lê
      // data_movimentacao e o card mostra data_movimentacao; a busca também
      // precisa, senão "Hoje" esconde o que é de hoje.
      const buscar = (colunas: string) => {
        let q = client.from('process_updates').select(colunas);
        if (scopeProcessId) q = q.eq('process_id', scopeProcessId);
        return q
          .order('data_movimentacao', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(FETCH_LIMIT);
      };

      let { data, error } = await buscar(COLUNAS);
      if (error) ({ data, error } = await buscar(COLUNAS_SEM_EVENTOS));
      if (error) ({ data, error } = await buscar(COLUNAS_SEM_ESFERA));
      if (error) throw error;
      // Linha antiga (ou banco sem a coluna): classifica pelo CNJ na hora, para
      // o filtro por ramo já valer sem esperar o backfill.
      const rows = ((data || []) as ProcessUpdate[]).map((r) => ({
        ...r,
        esfera: r.esfera || classificarEsfera({ numeroCnj: r.numero_cnj, titulo: r.processo_titulo }),
        eventos: Array.isArray(r.eventos) ? r.eventos : null,
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
  }, [user?.id, scopeProcessId]);

  // Ref e não estado: o canal do realtime é montado uma vez só, e uma dependência
  // que muda depois do login faria a assinatura cair e subir de novo.
  const extUserIdRef = useRef<string | null>(null);
  useEffect(() => { extUserIdRef.current = extUserId; }, [extUserId]);

  /**
   * Movimentação nova chegou: avisa SÓ quem responde pelo passo que está em
   * aberto naquele processo.
   *
   * Por que o passo e não o processo: o dono muda ao longo do POP — quem cuida
   * da instrução não é quem cuida da execução. Avisar o responsável do processo
   * inteiro mandaria o aviso para a pessoa errada na metade das fases; avisar
   * todo mundo com o sino aberto (o que o canal fazia) é o mesmo que não avisar.
   *
   * Quando a cascata inteira falha (origem 'nenhum'), o aviso vai para TODO
   * MUNDO — decisão do Raym em 12/08/2026. É fundo de poço, não descuido:
   * cinco degraus já foram tentados, e movimentação sem destinatário é
   * movimentação que ninguém lê. Cada cliente decide por si (todos resolvem a
   * mesma cascata), então não precisa de fan-out no servidor.
   *
   * Silencioso só quando o dono é outro: notificação que chega para quem não
   * vai agir ensina a ignorar notificação.
   */
  const avisarSeForMinha = useCallback(async (u: ProcessUpdate) => {
    const eu = extUserIdRef.current;
    if (!eu || !u.lead_id) return;
    try {
      const passo = await responsavelDoPassoAberto(u.process_id, u.lead_id);

      const semDono = !passo.assigneeId;
      const minha = passo.assigneeId === eu;
      // Contas de teste e inativas ficam de fora do "todo mundo" — elas não
      // atuam em processo, e engrossariam o barulho justamente no caso em que
      // ele já é mais largo.
      if (!minha && !(semDono && !ASSIGNEE_BLOCKLIST.has(user?.id || ''))) return;

      const processo = u.processo_titulo || u.numero_cnj || 'processo';
      const corpo = [
        u.descricao?.slice(0, 140),
        passo.stepLabel ? `Passo em aberto: ${passo.stepLabel}` : null,
        // Quem recebe por falta de dono precisa saber que não é "sua" tarefa —
        // senão ou todo mundo age, ou ninguém age achando que é de outro.
        semDono ? 'Sem responsável definido — avisando a equipe' : null,
      ].filter(Boolean).join('\n');

      const exibiu = await showNativeNotification(`${u.titulo} — ${processo}`, {
        body: corpo,
        // Uma notificação por movimentação: reenvio do mesmo id substitui em vez
        // de empilhar quatro avisos do mesmo fato.
        tag: `process-update-${u.id}`,
        url: u.lead_id ? `/leads?openLead=${u.lead_id}` : '/',
      });

      // Sem permissão do navegador o aviso não pode simplesmente sumir — quem
      // tem o app aberto ainda precisa ver que caiu algo no passo dele.
      if (!exibiu) {
        toast.info(`${u.titulo} — ${processo}`, {
          description: semDono
            ? 'Sem responsável definido — avisando a equipe'
            : (passo.stepLabel ? `Seu passo: ${passo.stepLabel}` : undefined),
          duration: 10000,
        });
      }
    } catch (err) {
      console.warn('[useProcessUpdates] não deu para avisar o responsável:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();

    // Tópico por escopo: o sino global e o atalho da ficha ficam montados ao
    // mesmo tempo, e dois canais com o mesmo nome disputam a mesma assinatura.
    const channel = db
      .channel(scopeProcessId ? `process-updates-bell-${scopeProcessId}` : 'process-updates-bell')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'process_updates',
          ...(scopeProcessId ? { filter: `process_id=eq.${scopeProcessId}` } : {}),
        },
        (payload) => {
          const bruto = payload.new as ProcessUpdate;
          if (scopeProcessId && bruto.process_id !== scopeProcessId) return;
          const novo = {
            ...bruto,
            esfera: bruto.esfera || classificarEsfera({ numeroCnj: bruto.numero_cnj, titulo: bruto.processo_titulo }),
            eventos: Array.isArray(bruto.eventos) ? bruto.eventos : null,
          };
          // Reordena em vez de empilhar no topo: com a lista ordenada por
          // data_movimentacao, uma linha recém-inserida de movimentação antiga
          // no topo apareceria acima do que é de hoje.
          setUpdates((prev) => [novo, ...prev].sort(ordemDoFeed).slice(0, FETCH_LIMIT));
          // Só o feed global avisa. O atalho da ficha é outra instância do mesmo
          // hook: deixá-lo avisar também mandaria dois pop-ups do mesmo fato pra
          // quem estiver com a atividade daquele processo aberta.
          if (!scopeProcessId) void avisarSeForMinha(novo);
        },
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [fetchAll, avisarSeForMinha, scopeProcessId]);

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

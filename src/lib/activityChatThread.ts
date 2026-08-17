/**
 * O chat da atividade é da CADEIA, não da ficha.
 *
 * "Concluir + próxima" cria uma ficha nova (id novo) e o chat interno, que era
 * ancorado no id, nascia vazio: a conversa do dia anterior ficava presa na
 * ficha concluída e quem respondia lá falava com quem já tinha virado o dia.
 * Foi o que aconteceu na cadeia "Manifestar descumprimento…" (07/08/2026): a
 * resposta caiu na ficha que o responsável tinha deixado para trás 18 minutos
 * antes.
 *
 * Aqui a cadeia inteira compartilha um chat só:
 *  - LEITURA  = união dos elos (`ids`), então o histórico antigo continua visível;
 *  - ESCRITA  = sempre na raiz (`rootId`), então a conversa não se parte de novo
 *               a cada etapa e a chave de quem acompanha o thread é estável.
 *
 * Sem backfill: nada é movido de lugar, o que existe é lido de onde está.
 *
 * A cadeia vive em `lead_activities.parent_activity_id` / `chain_root_id`
 * (migration de 07/08/2026). Banco sem essas colunas cai no comportamento
 * antigo — chat da ficha — em vez de quebrar.
 */
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

export interface ActivityChatThread {
  /** Raiz da cadeia — onde as mensagens novas são gravadas. */
  rootId: string;
  /** Todos os elos vivos, em ordem de criação. O histórico é a união deles. */
  ids: string[];
}

/** Postgres 42703 = undefined_column: banco sem a migration da cadeia. */
const isMissingColumn = (err: unknown) =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === '42703';

/**
 * A cadeia só muda quando alguém conclui + cria a próxima. TTL curto porque o
 * custo de errar é baixo (a escrita vai pra raiz de qualquer jeito) e o de
 * consultar a cada abertura de ficha, não.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { thread: ActivityChatThread; at: number }>();
/** Uma resolução por atividade em voo — ficha e dock abrem juntos. */
const inflight = new Map<string, Promise<ActivityChatThread>>();

const now = () => Date.now();

function cacheThread(thread: ActivityChatThread) {
  const at = now();
  // Indexado por todos os elos: abrir qualquer um cai no mesmo thread.
  for (const id of new Set([thread.rootId, ...thread.ids])) {
    cache.set(id, { thread, at });
  }
}

/** O que já está em cache, sem ida ao banco — evita o flicker do primeiro render. */
export function peekActivityChatThread(activityId: string): ActivityChatThread | null {
  const hit = cache.get(activityId);
  if (!hit) return null;
  if (now() - hit.at > TTL_MS) {
    cache.delete(activityId);
    return null;
  }
  return hit.thread;
}

/** Fallback de tudo que der errado: o chat da própria ficha, como era antes. */
const soloThread = (activityId: string): ActivityChatThread => ({ rootId: activityId, ids: [activityId] });

/**
 * Raiz + elos da cadeia de uma atividade. Duas queries: uma para descobrir a
 * raiz, outra para os elos — subir de pai em pai seria N+1.
 */
export async function resolveActivityChatThread(activityId: string): Promise<ActivityChatThread> {
  if (!activityId) return soloThread(activityId);
  const cached = peekActivityChatThread(activityId);
  if (cached) return cached;
  const running = inflight.get(activityId);
  if (running) return running;

  const task = (async (): Promise<ActivityChatThread> => {
    try {
      await ensureExternalSession();
      const { data: self, error: selfErr } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, chain_root_id')
        .eq('id', activityId)
        .maybeSingle();

      if (selfErr) {
        if (!isMissingColumn(selfErr)) console.warn('[activityChatThread] falha ao resolver a raiz', selfErr);
        return soloThread(activityId);
      }
      // A raiz não guarda chain_root_id (fica NULL) — nela, a raiz é ela mesma.
      const rootId: string = self?.chain_root_id || activityId;

      const { data: elos, error: elosErr } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, created_at')
        .or(`chain_root_id.eq.${rootId},id.eq.${rootId}`)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (elosErr || !elos?.length) {
        if (elosErr && !isMissingColumn(elosErr)) console.warn('[activityChatThread] falha ao carregar os elos', elosErr);
        // Raiz conhecida mas elos ilegíveis: ainda vale escrever na raiz.
        const parcial = { rootId, ids: Array.from(new Set([rootId, activityId])) };
        cacheThread(parcial);
        return parcial;
      }

      const ids = (elos as { id: string }[]).map(e => e.id);
      // A ficha aberta entra sempre — elo apagado ainda mostra o que foi dito nele.
      if (!ids.includes(activityId)) ids.push(activityId);
      const thread: ActivityChatThread = { rootId, ids };
      cacheThread(thread);
      return thread;
    } catch (e) {
      console.warn('[activityChatThread] erro inesperado', e);
      return soloThread(activityId);
    } finally {
      inflight.delete(activityId);
    }
  })();

  inflight.set(activityId, task);
  return task;
}

/**
 * Raiz de várias atividades de uma vez — usado por quem acompanha threads
 * (`team_chat_thread_followers`) para não perder as linhas legadas, gravadas
 * com o id do elo antes desta mudança.
 */
export async function resolveActivityChatRoots(activityIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pendentes = Array.from(new Set(activityIds.filter(Boolean)));
  if (pendentes.length === 0) return out;
  try {
    await ensureExternalSession();
    const { data, error } = await (externalSupabase as any)
      .from('lead_activities')
      .select('id, chain_root_id')
      .in('id', pendentes);
    if (error) {
      if (!isMissingColumn(error)) console.warn('[activityChatThread] falha ao resolver raízes em lote', error);
      return out;
    }
    for (const row of (data || []) as { id: string; chain_root_id: string | null }[]) {
      if (row.chain_root_id && row.chain_root_id !== row.id) out.set(row.id, row.chain_root_id);
    }
  } catch (e) {
    console.warn('[activityChatThread] erro inesperado no lote', e);
  }
  return out;
}

/**
 * Qual ficha abrir quando a notificação do chat é clicada: a etapa VIVA da
 * cadeia, não a raiz (que costuma estar concluída). Sem isso, o aviso levaria
 * sempre para a ficha mais velha da sequência.
 */
export async function resolveOpenActivityOfChain(activityId: string): Promise<string> {
  if (!activityId) return activityId;
  try {
    await ensureExternalSession();
    const { data: self, error: selfErr } = await (externalSupabase as any)
      .from('lead_activities')
      .select('id, chain_root_id')
      .eq('id', activityId)
      .maybeSingle();
    if (selfErr || !self) return activityId;
    const rootId: string = self.chain_root_id || activityId;

    const { data, error } = await (externalSupabase as any)
      .from('lead_activities')
      .select('id, status, created_at')
      .or(`chain_root_id.eq.${rootId},id.eq.${rootId}`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error || !data?.length) return activityId;

    const elos = data as { id: string; status: string | null }[];
    const abertos = elos.filter(e => e.status !== 'concluida' && e.status !== 'cancelada');
    // A etapa aberta mais recente; sem nenhuma aberta, o último elo da sequência.
    return (abertos.length ? abertos[abertos.length - 1] : elos[elos.length - 1]).id;
  } catch (e) {
    console.warn('[activityChatThread] falha ao achar a etapa viva', e);
    return activityId;
  }
}

/** Só para os testes: zera o cache entre casos. */
export function __clearActivityChatThreadCache() {
  cache.clear();
  inflight.clear();
}

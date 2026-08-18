/**
 * De quem é o chat interno de uma ficha — ago/2026.
 *
 * Regra decidida com o usuário (18/08/2026): **o chat da atividade é do
 * PROCESSO**. Atividade e processo costumam ter o mesmo nome na tela (no CASO
 * 180 os dois se chamam "ACIDENTE DE TRABALHO"), então quem escrevia no chat do
 * processo achava que estava falando com o responsável pela atividade — e a
 * mensagem nunca aparecia pra ele. Foi o que aconteceu em 10/08/2026: um @ pro
 * Abderaman ficou no chat do processo, invisível na atividade dele.
 *
 * A partir daqui, atividade com `process_id`:
 *  - ESCREVE em `entity_type='process'`, `entity_id=<processo>`;
 *  - LÊ o processo + todas as atividades dele (o legado, gravado por atividade,
 *    continua à vista sem sair do lugar);
 *  - o chat do processo lê exatamente o mesmo conjunto — os dois docks mostram
 *    a mesma conversa e dividem o mesmo cache.
 *
 * Atividade SEM processo mantém o comportamento da cadeia
 * (`activityChatThread.ts`): lê os elos, escreve na raiz.
 *
 * Sem backfill: nada é movido de lugar, o que existe é lido de onde está.
 */
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { resolveActivityChatThread } from './activityChatThread';

/** Um par (entity_type, entity_id[]) da leitura. */
export interface ChatReadScope {
  type: string;
  ids: string[];
}

export interface ChatScope {
  /** Onde as mensagens novas são gravadas. */
  writeType: string;
  writeId: string;
  /** `entity_name` a carimbar na escrita; null = usar o nome que a ficha passou. */
  writeName: string | null;
  /** Tudo que a conversa mostra, por tipo de entidade. */
  read: ChatReadScope[];
  /** Preenchido só quando a conversa é de um processo — alimenta o aviso na tela. */
  processLabel: string | null;
}

/**
 * Teto do `IN` de atividades do processo. Hoje o processo mais movimentado tem
 * 51 atividades (p95 = 18), então nunca é atingido — está aqui para que um
 * processo anômalo degrade a leitura em vez de estourar a URL do PostgREST.
 */
const MAX_ATIVIDADES_DO_PROCESSO = 200;

const TTL_MS = 60_000;
const cache = new Map<string, { scope: ChatScope; at: number }>();
const inflight = new Map<string, Promise<ChatScope>>();

const now = () => Date.now();
const keyOf = (type: string, id: string) => `${type}:${id}`;

/** Escopo trivial: a ficha é o próprio thread (lead, contato, WhatsApp, POP…). */
export const soloScope = (type: string, id: string): ChatScope => ({
  writeType: type,
  writeId: id,
  writeName: null,
  read: [{ type, ids: [id] }],
  processLabel: null,
});

/** O que já está em cache, sem ida ao banco — evita o flicker do primeiro render. */
export function peekChatScope(entityType: string, entityId: string): ChatScope | null {
  const hit = cache.get(keyOf(entityType, entityId));
  if (!hit) return null;
  if (now() - hit.at > TTL_MS) {
    cache.delete(keyOf(entityType, entityId));
    return null;
  }
  return hit.scope;
}

function cacheScope(scope: ChatScope, alsoKeys: string[]) {
  const at = now();
  // Indexado pelo destino da escrita e por toda ficha que cai nele: abrir o
  // processo ou qualquer atividade dele resolve para o mesmo escopo.
  for (const k of new Set([keyOf(scope.writeType, scope.writeId), ...alsoKeys])) {
    cache.set(k, { scope, at });
  }
}

/** Nº do processo (o que a equipe usa para se referir a ele) ou o título. */
async function loadProcessLabel(processId: string): Promise<string | null> {
  try {
    const { data } = await (externalSupabase as any)
      .from('lead_processes')
      .select('process_number, title')
      .eq('id', processId)
      .maybeSingle();
    const p = data as { process_number?: string | null; title?: string | null } | null;
    return p?.process_number || p?.title || null;
  } catch {
    return null;
  }
}

/**
 * Atividades que compõem a leitura do processo: as que apontam para ele hoje,
 * mais os elos da cadeia aberta (uma etapa pode ter perdido o vínculo depois de
 * a conversa acontecer nela).
 */
async function activityIdsOfProcess(processId: string, chainRootId?: string | null): Promise<string[]> {
  const filtro = chainRootId
    ? `process_id.eq.${processId},chain_root_id.eq.${chainRootId},id.eq.${chainRootId}`
    : `process_id.eq.${processId}`;
  const { data, error } = await (externalSupabase as any)
    .from('lead_activities')
    .select('id')
    .or(filtro)
    .is('deleted_at', null)
    .limit(MAX_ATIVIDADES_DO_PROCESSO);
  if (error) {
    console.warn('[entityChatScope] falha ao listar as atividades do processo', error);
    return [];
  }
  const ids = ((data || []) as { id: string }[]).map(a => a.id);
  if (ids.length === MAX_ATIVIDADES_DO_PROCESSO) {
    console.warn(
      `[entityChatScope] processo ${processId} bateu o teto de ${MAX_ATIVIDADES_DO_PROCESSO} atividades — ` +
      'a conversa pode estar escondendo mensagens gravadas em atividades antigas.'
    );
  }
  return ids;
}

/** Monta o escopo de um processo a partir das atividades já resolvidas. */
function processScope(processId: string, activityIds: string[], label: string | null): ChatScope {
  const read: ChatReadScope[] = [{ type: 'process', ids: [processId] }];
  if (activityIds.length) read.push({ type: 'activity', ids: activityIds });
  return {
    writeType: 'process',
    writeId: processId,
    writeName: label,
    read,
    processLabel: label,
  };
}

/**
 * Escopo do chat de uma ficha qualquer. Só `activity` e `process` têm resolução
 * própria; o resto é a própria ficha.
 */
export async function resolveChatScope(entityType: string, entityId: string): Promise<ChatScope> {
  if (!entityId) return soloScope(entityType, entityId);
  if (entityType !== 'activity' && entityType !== 'process') return soloScope(entityType, entityId);

  const cached = peekChatScope(entityType, entityId);
  if (cached) return cached;
  const running = inflight.get(keyOf(entityType, entityId));
  if (running) return running;

  const task = (async (): Promise<ChatScope> => {
    try {
      await ensureExternalSession();

      if (entityType === 'process') {
        const [ids, label] = await Promise.all([
          activityIdsOfProcess(entityId),
          loadProcessLabel(entityId),
        ]);
        const scope = processScope(entityId, ids, label);
        cacheScope(scope, ids.map(id => keyOf('activity', id)));
        return scope;
      }

      // ---- atividade ----
      const { data: self, error } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, chain_root_id, process_id')
        .eq('id', entityId)
        .maybeSingle();

      const row = self as { chain_root_id?: string | null; process_id?: string | null } | null;
      // Coluna ausente (42703) ou ficha ilegível: cai na cadeia, como antes.
      if (error || !row?.process_id) {
        const thread = await resolveActivityChatThread(entityId);
        const scope: ChatScope = {
          writeType: 'activity',
          writeId: thread.rootId,
          writeName: null,
          read: [{ type: 'activity', ids: thread.ids }],
          processLabel: null,
        };
        cacheScope(scope, thread.ids.map(id => keyOf('activity', id)));
        return scope;
      }

      const processId = row.process_id;
      const [ids, label] = await Promise.all([
        activityIdsOfProcess(processId, row.chain_root_id || entityId),
        loadProcessLabel(processId),
      ]);
      // A ficha aberta entra sempre: atividade apagada ainda mostra o que foi dito nela.
      if (!ids.includes(entityId)) ids.push(entityId);
      const scope = processScope(processId, ids, label);
      cacheScope(scope, ids.map(id => keyOf('activity', id)));
      return scope;
    } catch (e) {
      console.warn('[entityChatScope] erro inesperado', e);
      return soloScope(entityType, entityId);
    } finally {
      inflight.delete(keyOf(entityType, entityId));
    }
  })();

  inflight.set(keyOf(entityType, entityId), task);
  return task;
}

/**
 * Processo de várias atividades de uma vez — usado por quem acompanha threads
 * (`team_chat_thread_followers`) para não perder as linhas legadas, gravadas com
 * o id da atividade antes de a conversa passar a morar no processo.
 */
export async function resolveActivityProcessIds(activityIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pendentes = Array.from(new Set(activityIds.filter(Boolean)));
  if (pendentes.length === 0) return out;
  try {
    await ensureExternalSession();
    const { data, error } = await (externalSupabase as any)
      .from('lead_activities')
      .select('id, process_id')
      .in('id', pendentes);
    if (error) {
      console.warn('[entityChatScope] falha ao resolver processos em lote', error);
      return out;
    }
    for (const row of (data || []) as { id: string; process_id: string | null }[]) {
      if (row.process_id) out.set(row.id, row.process_id);
    }
  } catch (e) {
    console.warn('[entityChatScope] erro inesperado no lote', e);
  }
  return out;
}

/** Só para os testes: zera o cache entre casos. */
export function __clearChatScopeCache() {
  cache.clear();
  inflight.clear();
}

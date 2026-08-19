/**
 * De quem é o chat interno de uma ficha — ago/2026.
 *
 * Regra decidida com o usuário (19/08/2026): **o chat da atividade é do CASO**
 * (o "CASO 180" / "PREV 1802" da tela). Atividade, processo e caso costumam ter
 * o mesmo nome (no CASO 180 a atividade e o processo se chamam os dois
 * "ACIDENTE DE TRABALHO"), então quem escrevia no chat do processo achava que
 * estava falando com o responsável pela atividade — e a mensagem nunca aparecia
 * pra ele. Foi o que aconteceu em 10/08/2026: um @ pro Abderaman ficou no chat
 * do processo, invisível na atividade dele.
 *
 * A partir daqui, atividade ou processo que pertence a um caso:
 *  - ESCREVE em `entity_type='case'`, `entity_id=<caso>`;
 *  - LÊ o caso + todos os processos dele + todas as atividades dele (o legado,
 *    gravado por atividade e por processo, continua à vista sem sair do lugar);
 *  - os três docks (atividade, processo, caso) mostram a mesma conversa e
 *    dividem o mesmo cache.
 *
 * Quem fica de fora do caso:
 *  - processo sem `case_id` — conversa do processo, como antes;
 *  - atividade sem caso e sem processo (20.296 das 35.009 em 19/08/2026) —
 *    mantém a cadeia de `activityChatThread.ts`: lê os elos, escreve na raiz.
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

/** Quem é o dono da conversa — decide o aviso que aparece no topo do painel. */
export type ChatScopeKind = 'case' | 'process' | 'chain' | 'solo';

export interface ChatScope {
  kind: ChatScopeKind;
  /** Onde as mensagens novas são gravadas. */
  writeType: string;
  writeId: string;
  /** `entity_name` a carimbar na escrita; null = usar o nome que a ficha passou. */
  writeName: string | null;
  /** Tudo que a conversa mostra, por tipo de entidade. */
  read: ChatReadScope[];
  /** Rótulo humano do dono ("CASO 180", "0016855-58.2023.5.16.0008"). */
  label: string | null;
}

/**
 * Tetos do `IN`. Em 19/08/2026 o caso mais movimentado tem 99 atividades
 * (p95 = 36, p99 = 64) e 16 processos, então nenhum dos dois é atingido —
 * estão aqui para que um caso anômalo degrade a leitura em vez de estourar a
 * URL do PostgREST.
 */
const MAX_ATIVIDADES_DO_CASO = 200;
const MAX_PROCESSOS_DO_CASO = 50;

const TTL_MS = 60_000;
const cache = new Map<string, { scope: ChatScope; at: number }>();
const inflight = new Map<string, Promise<ChatScope>>();

const now = () => Date.now();
const keyOf = (type: string, id: string) => `${type}:${id}`;

/** Escopo trivial: a ficha é o próprio thread (lead, contato, WhatsApp, POP…). */
export const soloScope = (type: string, id: string): ChatScope => ({
  kind: 'solo',
  writeType: type,
  writeId: id,
  writeName: null,
  read: [{ type, ids: [id] }],
  label: null,
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
  // caso, um processo dele ou qualquer atividade resolve para o mesmo escopo.
  for (const k of new Set([keyOf(scope.writeType, scope.writeId), ...alsoKeys])) {
    cache.set(k, { scope, at });
  }
}

/** Nº do caso (o que a equipe usa para se referir a ele) ou o título. */
async function loadCaseLabel(caseId: string): Promise<string | null> {
  try {
    const { data } = await (externalSupabase as any)
      .from('legal_cases')
      .select('case_number, title')
      .eq('id', caseId)
      .maybeSingle();
    const c = data as { case_number?: string | null; title?: string | null } | null;
    return c?.case_number || c?.title || null;
  } catch {
    return null;
  }
}

/** Nº do processo — só para o caso raro de processo sem caso. */
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

async function processIdsOfCase(caseId: string): Promise<string[]> {
  const { data, error } = await (externalSupabase as any)
    .from('lead_processes')
    .select('id')
    .eq('case_id', caseId)
    .limit(MAX_PROCESSOS_DO_CASO);
  if (error) {
    console.warn('[entityChatScope] falha ao listar os processos do caso', error);
    return [];
  }
  return ((data || []) as { id: string }[]).map(p => p.id);
}

/**
 * Atividades que compõem a leitura do caso: as que apontam para ele, as que
 * apontam para um processo dele, e os elos da cadeia aberta (uma etapa pode ter
 * perdido o vínculo depois de a conversa acontecer nela).
 */
async function activityIdsOfCase(
  caseId: string,
  processIds: string[],
  extras: string[],
): Promise<string[]> {
  const partes = [`case_id.eq.${caseId}`];
  if (processIds.length) partes.push(`process_id.in.(${processIds.join(',')})`);
  if (extras.length) {
    partes.push(`id.in.(${extras.join(',')})`);
    partes.push(`chain_root_id.in.(${extras.join(',')})`);
  }
  const { data, error } = await (externalSupabase as any)
    .from('lead_activities')
    .select('id')
    .or(partes.join(','))
    .is('deleted_at', null)
    .limit(MAX_ATIVIDADES_DO_CASO);
  if (error) {
    console.warn('[entityChatScope] falha ao listar as atividades do caso', error);
    return [];
  }
  const ids = ((data || []) as { id: string }[]).map(a => a.id);
  if (ids.length === MAX_ATIVIDADES_DO_CASO) {
    console.warn(
      `[entityChatScope] caso ${caseId} bateu o teto de ${MAX_ATIVIDADES_DO_CASO} atividades — ` +
      'a conversa pode estar escondendo mensagens gravadas em atividades antigas.'
    );
  }
  return ids;
}

/** Escopo completo de um caso. `extras` = ficha aberta + raiz da cadeia dela. */
async function buildCaseScope(caseId: string, extras: string[]): Promise<ChatScope> {
  const [processIds, label] = await Promise.all([
    processIdsOfCase(caseId),
    loadCaseLabel(caseId),
  ]);
  const activityIds = await activityIdsOfCase(caseId, processIds, extras);
  // A ficha aberta entra sempre: atividade apagada ainda mostra o que foi dito nela.
  for (const extra of extras) {
    if (extra && !activityIds.includes(extra)) activityIds.push(extra);
  }

  const read: ChatReadScope[] = [{ type: 'case', ids: [caseId] }];
  if (processIds.length) read.push({ type: 'process', ids: processIds });
  if (activityIds.length) read.push({ type: 'activity', ids: activityIds });

  const scope: ChatScope = {
    kind: 'case',
    writeType: 'case',
    writeId: caseId,
    writeName: label,
    read,
    label,
  };
  cacheScope(scope, [
    ...processIds.map(id => keyOf('process', id)),
    ...activityIds.map(id => keyOf('activity', id)),
  ]);
  return scope;
}

/** Fallback: processo órfão de caso (123 atividades em 19/08/2026 caem aqui). */
async function buildProcessScope(processId: string, extras: string[]): Promise<ChatScope> {
  const partes = [`process_id.eq.${processId}`];
  if (extras.length) {
    partes.push(`id.in.(${extras.join(',')})`);
    partes.push(`chain_root_id.in.(${extras.join(',')})`);
  }
  const [ids, label] = await Promise.all([
    (async () => {
      const { data, error } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id')
        .or(partes.join(','))
        .is('deleted_at', null)
        .limit(MAX_ATIVIDADES_DO_CASO);
      if (error) {
        console.warn('[entityChatScope] falha ao listar as atividades do processo', error);
        return [] as string[];
      }
      return ((data || []) as { id: string }[]).map(a => a.id);
    })(),
    loadProcessLabel(processId),
  ]);
  for (const extra of extras) {
    if (extra && !ids.includes(extra)) ids.push(extra);
  }

  const read: ChatReadScope[] = [{ type: 'process', ids: [processId] }];
  if (ids.length) read.push({ type: 'activity', ids });

  const scope: ChatScope = {
    kind: 'process',
    writeType: 'process',
    writeId: processId,
    writeName: label,
    read,
    label,
  };
  cacheScope(scope, ids.map(id => keyOf('activity', id)));
  return scope;
}

/** Caso do processo, ou null se ele for órfão / ilegível. */
async function caseIdOfProcess(processId: string): Promise<string | null> {
  try {
    const { data } = await (externalSupabase as any)
      .from('lead_processes')
      .select('case_id')
      .eq('id', processId)
      .maybeSingle();
    return (data as { case_id?: string | null } | null)?.case_id || null;
  } catch {
    return null;
  }
}

const RESOLVIVEIS = new Set(['activity', 'process', 'case']);

/**
 * Escopo do chat de uma ficha qualquer. Só `activity`, `process` e `case` têm
 * resolução própria; o resto é a própria ficha.
 */
export async function resolveChatScope(entityType: string, entityId: string): Promise<ChatScope> {
  if (!entityId) return soloScope(entityType, entityId);
  if (!RESOLVIVEIS.has(entityType)) return soloScope(entityType, entityId);

  const cached = peekChatScope(entityType, entityId);
  if (cached) return cached;
  const running = inflight.get(keyOf(entityType, entityId));
  if (running) return running;

  const task = (async (): Promise<ChatScope> => {
    try {
      await ensureExternalSession();

      if (entityType === 'case') return await buildCaseScope(entityId, []);

      if (entityType === 'process') {
        const caseId = await caseIdOfProcess(entityId);
        return caseId ? await buildCaseScope(caseId, []) : await buildProcessScope(entityId, []);
      }

      // ---- atividade ----
      const { data: self, error } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, chain_root_id, process_id, case_id')
        .eq('id', entityId)
        .maybeSingle();

      const row = self as {
        chain_root_id?: string | null;
        process_id?: string | null;
        case_id?: string | null;
      } | null;

      const extras = Array.from(new Set([entityId, row?.chain_root_id].filter(Boolean) as string[]));

      // Coluna ausente (42703) ou ficha ilegível: cai na cadeia, como antes.
      if (!error && row?.case_id) return await buildCaseScope(row.case_id, extras);
      if (!error && row?.process_id) {
        const caseId = await caseIdOfProcess(row.process_id);
        return caseId
          ? await buildCaseScope(caseId, extras)
          : await buildProcessScope(row.process_id, extras);
      }

      const thread = await resolveActivityChatThread(entityId);
      const scope: ChatScope = {
        kind: 'chain',
        writeType: 'activity',
        writeId: thread.rootId,
        writeName: null,
        read: [{ type: 'activity', ids: thread.ids }],
        label: null,
      };
      cacheScope(scope, thread.ids.map(id => keyOf('activity', id)));
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
 * Para onde as fichas seguidas apontam hoje — usado por quem acompanha threads
 * (`team_chat_thread_followers`) para não perder as linhas legadas, gravadas com
 * o id da atividade (ou do processo) antes de a conversa passar a morar no caso.
 *
 * Devolve chaves prontas no formato `case:<id>` / `process:<id>`.
 */
export async function resolveThreadKeys(input: {
  activityIds?: string[];
  processIds?: string[];
}): Promise<Set<string>> {
  const chaves = new Set<string>();
  const atividades = Array.from(new Set((input.activityIds || []).filter(Boolean)));
  const processos = new Set((input.processIds || []).filter(Boolean));

  if (atividades.length === 0 && processos.size === 0) return chaves;

  try {
    await ensureExternalSession();

    if (atividades.length) {
      const { data, error } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, case_id, process_id')
        .in('id', atividades);
      if (error) {
        console.warn('[entityChatScope] falha ao resolver atividades em lote', error);
      } else {
        for (const row of (data || []) as { case_id: string | null; process_id: string | null }[]) {
          if (row.case_id) chaves.add(`case:${row.case_id}`);
          else if (row.process_id) processos.add(row.process_id);
        }
      }
    }

    if (processos.size) {
      const lista = Array.from(processos);
      for (const id of lista) chaves.add(`process:${id}`);
      const { data, error } = await (externalSupabase as any)
        .from('lead_processes')
        .select('id, case_id')
        .in('id', lista);
      if (error) {
        console.warn('[entityChatScope] falha ao resolver processos em lote', error);
      } else {
        for (const row of (data || []) as { case_id: string | null }[]) {
          if (row.case_id) chaves.add(`case:${row.case_id}`);
        }
      }
    }
  } catch (e) {
    console.warn('[entityChatScope] erro inesperado no lote', e);
  }
  return chaves;
}

/** Só para os testes: zera o cache entre casos. */
export function __clearChatScopeCache() {
  cache.clear();
  inflight.clear();
}

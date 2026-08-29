/**
 * Vínculo mensagem do WhatsApp -> atividade criada a partir dela.
 *
 * Mesmo desenho já usado no chat interno (`team_message_activities`): a bolha
 * ganha o selo "Virou atividade" e um atalho que abre a ficha no painel lateral.
 *
 * Banco: Externo (kmedldlepwiityjsdahz) — onde vivem `whatsapp_messages` e
 * `lead_activities`. Sem a tabela o chat continua funcionando: só perde o selo.
 */
import { db, ensureExternalSession } from '@/integrations/supabase';

export interface WhatsAppMessageActivityLink {
  activity_id: string;
  activity_title: string | null;
}

/** message_id -> atividade que nasceu daquela mensagem. */
export type WhatsAppMessageActivityMap = Record<string, WhatsAppMessageActivityLink>;

const TABLE = 'whatsapp_message_activities';
const LINKED_EVENT = 'whatsapp-message-activity:linked';

export interface WhatsAppMessageActivityLinkedDetail {
  phone: string;
  messageIds: string[];
  activityId: string;
  activityTitle: string | null;
}

interface LinkRow {
  message_id: string;
  activity_id: string;
  activity_title: string | null;
}

/** Conversa do WhatsApp que originou uma atividade (caminho inverso do selo). */
export interface ActivityMessageOrigin {
  /**
   * Bolha exata de origem. Nulo quando a atividade nasceu da conversa mas não de
   * uma mensagem específica (menu do topo): aí o atalho abre a conversa no fim.
   */
  message_id: string | null;
  phone: string | null;
  instance_name: string | null;
  /** Quantas mensagens originaram a atividade (o atalho leva à primeira). */
  total: number;
}

/**
 * A tabela é nova e ainda não está nos types gerados do Externo — o acesso vai
 * por esta ponte mínima, em vez de espalhar `as any` pelo arquivo.
 */
type UntypedQuery<Row> = PromiseLike<{ data: Row[] | null; error: unknown }> & {
  eq: (column: string, value: string) => UntypedQuery<Row>;
  order: (column: string, options: { ascending: boolean }) => UntypedQuery<Row>;
  limit: (count: number) => UntypedQuery<Row>;
};

type UntypedTable = {
  select: <Row>(columns: string) => UntypedQuery<Row>;
  upsert: (rows: Record<string, unknown>[], options: { onConflict: string }) => PromiseLike<{ error: unknown }>;
};

const linkTable = () => (db as unknown as { from: (table: string) => UntypedTable }).from(TABLE);

/** Teto de vínculos lidos de uma vez — evita varrer a tabela inteira quando ela crescer. */
const MAX_LINKS = 5000;
/** Tamanho do lote no `in (...)` de status — URL do PostgREST tem limite prático. */
const STATUS_CHUNK = 400;

/**
 * Carrega os vínculos da conversa inteira (filtro por telefone, que é indexado).
 * Filtrar por `in (message_ids)` estouraria a URL em conversas longas.
 */
export async function loadWhatsAppMessageActivities(phone: string): Promise<WhatsAppMessageActivityMap> {
  if (!phone) return {};
  await ensureExternalSession();
  const { data, error } = await linkTable().select<LinkRow>('message_id, activity_id, activity_title').eq('phone', phone);
  if (error) throw error;
  const map: WhatsAppMessageActivityMap = {};
  for (const row of data || []) {
    map[row.message_id] = { activity_id: row.activity_id, activity_title: row.activity_title };
  }
  return map;
}

/**
 * Grava de quais mensagens a atividade nasceu e avisa o chat aberto.
 * Nunca derruba o fluxo de criação: falha vira warning no console.
 */
export async function linkWhatsAppMessagesToActivity(params: {
  messageIds: string[];
  phone: string;
  instanceName?: string | null;
  activityId: string;
  activityTitle?: string | null;
  createdBy?: string | null;
}): Promise<boolean> {
  const { messageIds, phone, instanceName, activityId, activityTitle, createdBy } = params;
  if (!activityId || messageIds.length === 0) return false;
  try {
    await ensureExternalSession();
    const rows = messageIds.map(mid => ({
      message_id: mid,
      phone: phone || null,
      instance_name: instanceName || null,
      activity_id: activityId,
      activity_title: activityTitle || null,
      created_by: createdBy || null,
    }));
    const { error } = await linkTable().upsert(rows, { onConflict: 'message_id,activity_id' });
    if (error) throw error;
    notifyWhatsAppMessageActivityLinked({
      phone,
      messageIds,
      activityId,
      activityTitle: activityTitle || null,
    });
    return true;
  } catch (e) {
    console.warn('[whatsappMessageActivities] não consegui registrar a origem da atividade:', e);
    return false;
  }
}

/**
 * Telefones com pelo menos uma atividade **em aberto** nascida de mensagem.
 * Usado pelo filtro "Com atividade pendente" da lista de conversas.
 *
 * Duas consultas em vez de embed: o volume de vínculos é baixo (um por atividade
 * criada de mensagem) e o `in (...)` vai em lotes, então o custo é previsível.
 */
export async function loadPhonesWithPendingActivity(): Promise<Set<string>> {
  await ensureExternalSession();
  const { data, error } = await linkTable()
    .select<{ phone: string | null; activity_id: string }>('phone, activity_id')
    .order('created_at', { ascending: false })
    .limit(MAX_LINKS);
  if (error) throw error;

  const links = (data || []).filter(r => r.phone);
  if (links.length === 0) return new Set();

  const ids = Array.from(new Set(links.map(r => r.activity_id)));
  const pending = new Set<string>();
  for (let i = 0; i < ids.length; i += STATUS_CHUNK) {
    const chunk = ids.slice(i, i + STATUS_CHUNK);
    const { data: rows, error: statusError } = await (db as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (col: string, values: string[]) => {
            neq: (col: string, value: string) => PromiseLike<{ data: { id: string }[] | null; error: unknown }>;
          };
        };
      };
    })
      .from('lead_activities')
      .select('id')
      .in('id', chunk)
      // "Pendente" aqui = ainda não concluída — inclui `em_andamento`.
      .neq('status', 'concluida');
    if (statusError) throw statusError;
    for (const row of rows || []) pending.add(row.id);
  }

  const phones = new Set<string>();
  for (const link of links) {
    if (pending.has(link.activity_id) && link.phone) phones.add(link.phone);
  }
  return phones;
}

/**
 * Caminho inverso do selo: de qual mensagem do WhatsApp a atividade nasceu.
 * Devolve a primeira mensagem de origem (as demais são do mesmo bloco selecionado).
 */
export async function loadActivityMessageOrigin(activityId: string): Promise<ActivityMessageOrigin | null> {
  if (!activityId) return null;
  await ensureExternalSession();
  const { data, error } = await linkTable()
    .select<{ message_id: string; phone: string | null; instance_name: string | null }>('message_id, phone, instance_name')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return null;
  return {
    message_id: rows[0].message_id,
    phone: rows[0].phone,
    instance_name: rows[0].instance_name,
    total: rows.length,
  };
}

export function notifyWhatsAppMessageActivityLinked(detail: WhatsAppMessageActivityLinkedDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WhatsAppMessageActivityLinkedDetail>(LINKED_EVENT, { detail }));
}

export function subscribeWhatsAppMessageActivityLinked(
  handler: (detail: WhatsAppMessageActivityLinkedDetail) => void
) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<WhatsAppMessageActivityLinkedDetail>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(LINKED_EVENT, listener as EventListener);
  return () => window.removeEventListener(LINKED_EVENT, listener as EventListener);
}

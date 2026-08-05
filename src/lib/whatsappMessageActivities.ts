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

/**
 * A tabela é nova e ainda não está nos types gerados do Externo — o acesso vai
 * por esta ponte mínima, em vez de espalhar `as any` pelo arquivo.
 */
type UntypedTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => PromiseLike<{ data: LinkRow[] | null; error: unknown }>;
  };
  upsert: (rows: Record<string, unknown>[], options: { onConflict: string }) => PromiseLike<{ error: unknown }>;
};

const linkTable = () => (db as unknown as { from: (table: string) => UntypedTable }).from(TABLE);

/**
 * Carrega os vínculos da conversa inteira (filtro por telefone, que é indexado).
 * Filtrar por `in (message_ids)` estouraria a URL em conversas longas.
 */
export async function loadWhatsAppMessageActivities(phone: string): Promise<WhatsAppMessageActivityMap> {
  if (!phone) return {};
  await ensureExternalSession();
  const { data, error } = await linkTable().select('message_id, activity_id, activity_title').eq('phone', phone);
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

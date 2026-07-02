import { externalSupabase } from './external-client';
import { normalizeWhatsAppConversationPhone } from '@/lib/whatsappPhone';

export interface ConversationSummary {
  phone: string;
  contact_name: string | null;
  contact_id: string | null;
  lead_id: string | null;
  last_message_text: string | null;
  last_message_at: string;
  last_direction: string;
  instance_name: string;
  unread_count: number;
  message_count: number;
  label_ids?: string[] | null;
}

export interface WhatsAppMessage {
  id: string;
  phone: string;
  instance_name: string;
  direction: 'inbound' | 'outbound';
  message_text: string | null;
  message_type: string;
  created_at: string;
  read_at: string | null;
  contact_name: string | null;
  contact_id: string | null;
  lead_id: string | null;
}

/**
 * Busca resumos de conversas. UMA chamada por instância em paralelo (cada uma
 * rápida graças à função inlineada que usa idx_wam_inst_phone_created).
 */
// Dedupe in-flight: chamadas concorrentes com a mesma chave compartilham a
// mesma Promise. Evita rajadas quando vários efeitos (polling + visibility +
// realtime fallback) disparam ao mesmo tempo. TTL curto (1.5s) só pra
// coalescer rajadas, não pra cachear dados.
const inFlightSummaries = new Map<string, { p: Promise<ConversationSummary[]>; at: number }>();
const INFLIGHT_TTL_MS = 1500;

// Corte de egress: só as N conversas mais recentes por instância. O retorno da
// RPC é ordenado por last_message_at DESC, então a primeira página é sempre o
// topo da sidebar. Antes buscávamos as ~33k conversas inteiras a cada refresh.
const MAX_CONVERSATIONS_PER_INSTANCE = 200;

export async function getConversationSummaries(
  instanceNames: string[],
  daysBack: number = 30
): Promise<ConversationSummary[]> {
  if (!instanceNames || instanceNames.length === 0) return [];

  const dedupeKey = JSON.stringify([[...instanceNames].sort(), daysBack]);
  const existing = inFlightSummaries.get(dedupeKey);
  if (existing && Date.now() - existing.at < INFLIGHT_TTL_MS) {
    return existing.p;
  }

  // Trace: detecta chamadas duplicadas/em rajada da RPC mais cara do Inbox
  try {
    const { traceHook } = await import('@/utils/hookTracer');
    traceHook('getConversationSummaries', {
      instanceCount: instanceNames?.length ?? 0,
      instances: instanceNames,
      daysBack,
    });
  } catch {}

  const callOne = async (name: string): Promise<ConversationSummary[]> => {
    // Webhook pode gravar instance_name em caixas diferentes (ex: "KAROLYNE ATENDIMENTO"
    // vs "Karolyne Atendimento" cadastrado). A RPC usa '=' case-sensitive, então
    // tentamos múltiplas variantes (original, UPPER, lower) e mesclamos.
    const variants = Array.from(new Set([name, name.toUpperCase(), name.toLowerCase()]));
    // A RPC ignora p_days_back e devolve TODAS as conversas da instância,
    // ordenadas por last_message_at DESC. Buscar tudo (paginando até o fim)
    // custava ~10 MB por refresh e estourou a cota de egress do projeto.
    // Uma página com as N mais recentes cobre o que a sidebar exibe.
    const { data, error } = await (externalSupabase as any)
      .rpc('get_conversation_summaries', {
        p_instance_names: variants,
        p_days_back: daysBack,
      })
      .range(0, MAX_CONVERSATIONS_PER_INSTANCE - 1);

    if (error) {
      console.warn(`[getConversationSummaries] failed for "${name}":`, error.message);
      return [];
    }

    const allRows = (data || []) as ConversationSummary[];
    console.log(`[getConversationSummaries] "${name}" → ${allRows.length} linhas (cap: ${MAX_CONVERSATIONS_PER_INSTANCE})`);
    // Normaliza instance_name de volta para o nome canônico cadastrado
    return allRows.map((row: ConversationSummary) => ({ ...row, instance_name: name }));
  };

  const run = (async () => {
    const results = await Promise.all(instanceNames.map(callOne));
    const merged = results.flat();
    merged.sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });
    return merged;
  })();

  inFlightSummaries.set(dedupeKey, { p: run, at: Date.now() });
  try {
    return await run;
  } finally {
    // Libera o slot logo após resolver — TTL só protege contra rajadas durante o await.
    setTimeout(() => {
      const cur = inFlightSummaries.get(dedupeKey);
      if (cur && cur.p === run) inFlightSummaries.delete(dedupeKey);
    }, INFLIGHT_TTL_MS);
  }
}

function instanceNameVariants(name: string): string[] {
  return Array.from(new Set([name, name.toUpperCase(), name.toLowerCase()]));
}

/**
 * Checagem barata pro poll de fallback: retorna o last_message_at mais recente
 * entre as instâncias (1 linha, ~200 bytes, coberto por
 * idx_conversations_instance_last). Se o valor não mudou desde o último poll,
 * o chamador pula o refresh completo de summaries.
 * Retorna null em erro — o chamador decide o fallback.
 */
export async function getLatestConversationActivity(
  instanceNames: string[]
): Promise<string | null> {
  if (!instanceNames || instanceNames.length === 0) return null;
  const variants = Array.from(new Set(instanceNames.flatMap(instanceNameVariants)));
  const { data, error } = await (externalSupabase as any)
    .from('conversations')
    .select('last_message_at')
    .in('instance_name', variants)
    .order('last_message_at', { ascending: false })
    .limit(1);
  if (error) {
    console.warn('[getLatestConversationActivity] failed:', error.message);
    return null;
  }
  return (data?.[0] as { last_message_at: string } | undefined)?.last_message_at ?? null;
}

export async function getConversationMessages(
  phone: string,
  instanceName: string,
  limit = 50
): Promise<WhatsAppMessage[]> {
  const normalizedPhone = normalizeWhatsAppConversationPhone(phone);
  const phoneVariants = Array.from(new Set([phone, normalizedPhone, `${normalizedPhone}@g.us`].filter(Boolean)));
  const { data, error } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .select('*')
    .in('phone', phoneVariants)
    .in('instance_name', instanceNameVariants(instanceName))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function markMessagesAsRead(
  phone: string,
  instanceName: string
): Promise<void> {
  const { error } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('phone', phone)
    .in('instance_name', instanceNameVariants(instanceName))
    .eq('direction', 'inbound')
    .is('read_at', null);
  if (error) throw error;
}

export async function linkMessagesToLead(
  phone: string,
  instanceName: string,
  leadId: string
): Promise<void> {
  const { error } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .update({ lead_id: leadId })
    .eq('phone', phone)
    .in('instance_name', instanceNameVariants(instanceName));
  if (error) throw error;
}

export async function linkConversationContactToLead(
  phone: string,
  instanceName: string,
  leadId: string
): Promise<string | null> {
  const variants = instanceNameVariants(instanceName);
  const { data: msg, error: msgError } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .select('contact_id, contact_name, phone')
    .eq('phone', phone)
    .in('instance_name', variants)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (msgError) throw msgError;
  let contactId = msg?.contact_id || null;
  if (!contactId) {
    const normalizedPhone = (msg?.phone || phone || '').replace(/\D/g, '');
    const last8 = normalizedPhone.slice(-8);
    const { data: existingContact, error: contactLookupError } = await (externalSupabase as any)
      .from('contacts')
      .select('id')
      .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
      .limit(1)
      .maybeSingle();
    if (contactLookupError) throw contactLookupError;

    if (existingContact?.id) {
      contactId = existingContact.id;
      await linkMessagesToContact(phone, instanceName, contactId);
    } else {
      const { data: createdContact, error: createContactError } = await (externalSupabase as any)
        .from('contacts')
        .insert({ full_name: msg?.contact_name || phone, phone })
        .select('id')
        .single();
      if (createContactError) throw createContactError;
      contactId = createdContact.id;
      await linkMessagesToContact(phone, instanceName, contactId);
    }
  }

  const { data: existing, error: existingError } = await (externalSupabase as any)
    .from('contact_leads')
    .select('id')
    .eq('contact_id', contactId)
    .eq('lead_id', leadId)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existing) {
    const { error: insertError } = await (externalSupabase as any)
      .from('contact_leads')
      .insert({ contact_id: contactId, lead_id: leadId, relationship_to_victim: 'Vítima' });
    if (insertError) throw insertError;
  }

  return contactId;
}

export async function linkMessagesToContact(
  phone: string,
  instanceName: string,
  contactId: string
): Promise<void> {
  const { error } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .update({ contact_id: contactId })
    .eq('phone', phone)
    .in('instance_name', instanceNameVariants(instanceName));
  if (error) throw error;
}

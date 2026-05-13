import { externalSupabase } from './external-client';

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
export async function getConversationSummaries(
  instanceNames: string[],
  daysBack: number = 30
): Promise<ConversationSummary[]> {
  // Trace: detecta chamadas duplicadas/em rajada da RPC mais cara do Inbox
  // (import dinâmico para evitar ciclo se um dia esse arquivo for usado fora do app)
  try {
    const { traceHook } = await import('@/utils/hookTracer');
    traceHook('getConversationSummaries', {
      instanceCount: instanceNames?.length ?? 0,
      instances: instanceNames,
      daysBack,
    });
  } catch {}
  if (!instanceNames || instanceNames.length === 0) return [];

  const callOne = async (name: string): Promise<ConversationSummary[]> => {
    // Webhook pode gravar instance_name em caixas diferentes (ex: "KAROLYNE ATENDIMENTO"
    // vs "Karolyne Atendimento" cadastrado). A RPC usa '=' case-sensitive, então
    // tentamos múltiplas variantes (original, UPPER, lower) e mesclamos.
    const variants = Array.from(new Set([name, name.toUpperCase(), name.toLowerCase()]));
    // O PostgREST do banco externo corta cada resposta em 1000 linhas, mesmo
    // quando o count exato informa mais. Então paginamos em blocos: é como
    // pegar várias caixas da prateleira, não só a primeira.
    const pageSize = 1000;
    const allRows: ConversationSummary[] = [];
    let exactCount: number | null = null;

    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error, count } = await (externalSupabase as any)
        .rpc('get_conversation_summaries', {
          p_instance_names: variants,
          p_days_back: daysBack,
        }, { count: from === 0 ? 'exact' : undefined })
        .range(from, to);

      if (error) {
        console.warn(`[getConversationSummaries] failed for "${name}" page ${from}-${to}:`, error.message);
        return allRows;
      }

      const rows = (data || []) as ConversationSummary[];
      allRows.push(...rows);
      if (from === 0 && typeof count === 'number') exactCount = count;
      if (rows.length < pageSize || (exactCount !== null && allRows.length >= exactCount)) break;
    }

    console.log(`[getConversationSummaries] "${name}" → ${allRows.length} linhas (count exato: ${exactCount ?? 'n/a'})`);
    // Normaliza instance_name de volta para o nome canônico cadastrado
    return allRows.map((row: ConversationSummary) => ({ ...row, instance_name: name }));
  };

  const results = await Promise.all(instanceNames.map(callOne));
  const merged = results.flat();
  // Mantém ordem por última mensagem desc (a RPC já ordena por instância)
  merged.sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });
  return merged;
}

function instanceNameVariants(name: string): string[] {
  return Array.from(new Set([name, name.toUpperCase(), name.toLowerCase()]));
}

export async function getConversationMessages(
  phone: string,
  instanceName: string,
  limit = 50
): Promise<WhatsAppMessage[]> {
  const { data, error } = await (externalSupabase as any)
    .from('whatsapp_messages')
    .select('*')
    .eq('phone', phone)
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

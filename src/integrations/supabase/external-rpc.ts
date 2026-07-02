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
// 500 (e não 200) porque nas instâncias mais movimentadas 200 cobria só ~1 dia
// de conversas — parecia "sumiço" do histórico na sidebar. Com 500, as mais
// movimentadas alcançam 3+ dias; o resto, semanas (medido em 02/07/2026).
const MAX_CONVERSATIONS_PER_INSTANCE = 500;

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
    // Unread em query separada (coberta por idx_conversations_instance_unread):
    // garante que conversa pendente antiga apareça mesmo fora do top-N do cap.
    const [results, unread] = await Promise.all([
      Promise.all(instanceNames.map(callOne)),
      fetchUnreadSummaries(instanceNames),
    ]);
    const merged = results.flat();
    const seen = new Set(merged.map(r => `${r.instance_name}|${r.phone}`));
    for (const row of unread) {
      const key = `${row.instance_name}|${row.phone}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(row);
      }
    }
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

// Colunas da tabela conversations que espelham o retorno da RPC.
const SUMMARY_COLUMNS =
  'phone, contact_name, contact_id, lead_id, last_message_text, last_message_at, last_direction, instance_name, unread_count, message_count';

// Mapeia variante de nome (UPPER/lower/original) de volta pro nome canônico.
function buildVariantMap(instanceNames: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of instanceNames) {
    for (const v of instanceNameVariants(name)) map.set(v, name);
  }
  return map;
}

// Normaliza linha crua de `conversations` pro shape da RPC (que faz COALESCE
// de null pra '' em contact_id/lead_id e converte ids pra text).
function mapConversationRow(row: any, variantToCanonical: Map<string, string>): ConversationSummary {
  return {
    phone: row.phone,
    contact_name: row.contact_name ?? '',
    contact_id: row.contact_id != null ? String(row.contact_id) : '',
    lead_id: row.lead_id != null ? String(row.lead_id) : '',
    last_message_text: row.last_message_text,
    last_message_at: row.last_message_at,
    last_direction: row.last_direction,
    instance_name: variantToCanonical.get(row.instance_name) || row.instance_name,
    unread_count: Number(row.unread_count) || 0,
    message_count: Number(row.message_count) || 0,
  };
}

// Janela de "pendência real": no banco há ~27k conversas com unread > 0
// acumulado há meses (o time não marca antigas como lidas), então unread
// sozinho não é sinal de pendência. Só unread com atividade recente entra.
const UNREAD_WINDOW_DAYS = 7;
const MAX_UNREAD_ROWS = 500;

/**
 * Conversas com unread pendente E atividade nos últimos UNREAD_WINDOW_DAYS.
 * Complementa o cap do top-N: pendência recente que já saiu do top-N da
 * instância continua visível na sidebar. Pendência mais antiga que a janela
 * fica de fora por decisão (são milhares de unread históricos sem valor).
 */
async function fetchUnreadSummaries(instanceNames: string[]): Promise<ConversationSummary[]> {
  if (!instanceNames || instanceNames.length === 0) return [];
  const variantToCanonical = buildVariantMap(instanceNames);
  const since = new Date(Date.now() - UNREAD_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await (externalSupabase as any)
    .from('conversations')
    .select(SUMMARY_COLUMNS)
    .in('instance_name', Array.from(variantToCanonical.keys()))
    .gt('unread_count', 0)
    .gte('last_message_at', since)
    // ASC de propósito: as unread mais recentes já entram pelo top-N do cap;
    // quem precisa de resgate são as mais antigas da janela (as esquecidas).
    .order('last_message_at', { ascending: true })
    .limit(MAX_UNREAD_ROWS);
  if (error) {
    console.warn('[fetchUnreadSummaries] failed:', error.message);
    return [];
  }
  const rows = (data || []) as any[];
  if (rows.length === MAX_UNREAD_ROWS) {
    console.warn(`[fetchUnreadSummaries] cap de ${MAX_UNREAD_ROWS} atingido — unread recente pode estar incompleto`);
  }
  return rows.map(r => mapConversationRow(r, variantToCanonical));
}

/**
 * Busca server-side de conversas por telefone/nome/última mensagem, pra
 * alcançar conversas fora do top-N carregado na sidebar. Limitada e ordenada
 * por atividade recente.
 */
export async function searchConversationSummaries(
  instanceNames: string[],
  term: string,
  limit = 50
): Promise<ConversationSummary[]> {
  const clean = term.trim().replace(/["\\]/g, '');
  if (!clean || !instanceNames || instanceNames.length === 0) return [];
  const variantToCanonical = buildVariantMap(instanceNames);
  // Escapa curingas do ilike; aspas duplas protegem vírgulas dentro do or()
  const pat = `%${clean.replace(/[%_]/g, m => `\\${m}`)}%`;
  const { data, error } = await (externalSupabase as any)
    .from('conversations')
    .select(SUMMARY_COLUMNS)
    .in('instance_name', Array.from(variantToCanonical.keys()))
    .or(`phone.ilike."${pat}",contact_name.ilike."${pat}",last_message_text.ilike."${pat}"`)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[searchConversationSummaries] failed:', error.message);
    return [];
  }
  return ((data || []) as any[]).map(r => mapConversationRow(r, variantToCanonical));
}

/**
 * Checagem barata pro poll de fallback: assinatura combinando o
 * last_message_at mais recente + count exato de conversas com unread recente
 * (head:true — só header HTTP, zero linhas de payload). Muda quando chega
 * mensagem nova OU quando alguém marca conversa como lida em outro
 * dispositivo (markMessagesAsRead zera a conversa inteira, então o count cai).
 * Retorna null em erro — o chamador decide o fallback.
 */
export async function getInboxActivitySignature(
  instanceNames: string[]
): Promise<string | null> {
  if (!instanceNames || instanceNames.length === 0) return null;
  const variants = Array.from(new Set(instanceNames.flatMap(instanceNameVariants)));
  // Truncado pra hora cheia: um `since` rolante faria o count mudar quando
  // conversa antiga sai da janela, disparando refresh sem nada novo. Com o
  // truncamento, isso acontece no máximo 1x/hora.
  const sinceMs = Math.floor((Date.now() - UNREAD_WINDOW_DAYS * 86_400_000) / 3_600_000) * 3_600_000;
  const since = new Date(sinceMs).toISOString();
  const [latestRes, unreadRes] = await Promise.all([
    (externalSupabase as any)
      .from('conversations')
      .select('last_message_at')
      .in('instance_name', variants)
      .order('last_message_at', { ascending: false })
      .limit(1),
    (externalSupabase as any)
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .in('instance_name', variants)
      .gt('unread_count', 0)
      .gte('last_message_at', since),
  ]);
  if (latestRes.error || unreadRes.error) {
    console.warn('[getInboxActivitySignature] failed:', latestRes.error?.message || unreadRes.error?.message);
    return null;
  }
  const latest = latestRes.data?.[0]?.last_message_at ?? 'none';
  return `${latest}|${unreadRes.count ?? 'n/a'}`;
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

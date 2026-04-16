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

export async function getConversationSummaries(
  instanceNames: string[]
): Promise<ConversationSummary[]> {
  const { data, error } = await (externalSupabase as any)
    .rpc('get_conversation_summaries', { p_instance_names: instanceNames });
  if (error) throw error;
  return data || [];
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
    .eq('instance_name', instanceName)
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
    .eq('instance_name', instanceName)
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
    .eq('instance_name', instanceName);
  if (error) throw error;
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
    .eq('instance_name', instanceName);
  if (error) throw error;
}

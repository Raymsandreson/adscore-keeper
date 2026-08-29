/**
 * Envio dos anexos "novos" do menu de anexo (contato/vCard e enquete) — usados
 * pelos dois chats (WhatsAppChat e DashboardChatPreview) via diálogos
 * compartilhados, sem duplicar o caminho de envio em cada host.
 *
 * O canal Cloud API da Meta (instância `cloud_gerencia`) não tem endpoint de
 * vCard/enquete na nossa integração — os diálogos bloqueiam com aviso.
 */
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';

export interface AttachSendTarget {
  /** Telefone/JID de destino (o mesmo `phone` que o chat usa pra enviar texto). */
  phone: string;
  chatId?: string | null;
  /** Instância preferida da conversa — a edge resolve o resto (fallbacks de grupo). */
  instanceName?: string | null;
  contactId?: string | null;
  leadId?: string | null;
}

export function isCloudChannelInstance(instanceName?: string | null): boolean {
  return (instanceName || '').trim().toLowerCase() === 'cloud_gerencia';
}

async function resolveInstanceId(instanceName?: string | null): Promise<string | undefined> {
  if (!instanceName) return undefined;
  const { data } = await supabase
    .from('whatsapp_instances')
    .select('id')
    .ilike('instance_name', instanceName)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data?.id;
}

interface SendResult {
  success: boolean;
  message_id?: string;
  instance_name?: string;
  error?: string;
}

export async function sendWhatsAppContact(
  target: AttachSendTarget,
  contact: { fullName: string; phoneNumber: string; organization?: string; email?: string }
): Promise<SendResult> {
  const instanceId = await resolveInstanceId(target.instanceName);
  const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
    body: {
      action: 'send_contact',
      phone: target.phone,
      chat_id: target.chatId || undefined,
      full_name: contact.fullName,
      phone_number: contact.phoneNumber,
      organization: contact.organization || undefined,
      email: contact.email || undefined,
      instance_id: instanceId,
      instance_name: target.instanceName || undefined,
      contact_id: target.contactId || undefined,
      lead_id: target.leadId || undefined,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erro ao enviar contato');
  return data as SendResult;
}

/** Texto simples pelo mesmo caminho dos diálogos (usado pelo Compartilhar ATV). */
export async function sendWhatsAppText(target: AttachSendTarget, message: string): Promise<SendResult> {
  const instanceId = await resolveInstanceId(target.instanceName);
  const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
    body: {
      phone: target.phone,
      chat_id: target.chatId || undefined,
      message,
      instance_id: instanceId,
      contact_id: target.contactId || undefined,
      lead_id: target.leadId || undefined,
      channel: isCloudChannelInstance(target.instanceName) ? 'cloud' : undefined,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erro ao enviar mensagem');
  return data as SendResult;
}

export async function sendWhatsAppPoll(
  target: AttachSendTarget,
  poll: { question: string; choices: string[]; selectableCount: number }
): Promise<SendResult> {
  const instanceId = await resolveInstanceId(target.instanceName);
  const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
    body: {
      action: 'send_poll',
      phone: target.phone,
      chat_id: target.chatId || undefined,
      question: poll.question,
      choices: poll.choices,
      selectable_count: poll.selectableCount,
      instance_id: instanceId,
      instance_name: target.instanceName || undefined,
      contact_id: target.contactId || undefined,
      lead_id: target.leadId || undefined,
    },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erro ao enviar enquete');
  return data as SendResult;
}

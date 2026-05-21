// Disparo automático quando uma etiqueta-gatilho é aplicada no WhatsApp.
//
// FLUXO NOVO (revisão pelo operador via link no WhatsApp):
// 1. IA extrai os campos do template a partir das mensagens da conversa.
// 2. Cria registro em `pending_label_documents` com status='awaiting_operator_review'
//    e gera um `review_token` curto e único.
// 3. Resolve a inst\u00e2ncia notificadora (configurada em label_review_notification_settings)
//    e o telefone destinat\u00e1rio (whatsapp_instances.review_notification_phone da inst\u00e2ncia
//    que recebeu a etiqueta).
// 4. Conta procurações geradas hoje pelo membro (pessoal) e pela equipe (total).
// 5. Envia mensagem WhatsApp para o destinat\u00e1rio com link de revisão:
//    https://adscore-keeper.lovable.app/revisar/{token}
// 6. NÃO envia nada para o cliente final — isso acontece só depois que o operador
//    confirma a revisão via submit-document-review.
//
// Body: { chatId, phone, instance, labelName, templateId, triggerId, createdBy? }
// Retorno HTTP 200 sempre: { success, pending_id?, review_token?, notification_sent?, error? }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import crypto from 'crypto';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

function normalizeInstance(name: string): string {
  return String(name || '').trim();
}
function normalizePhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}
function genReviewToken(): string {
  // 16 chars url-safe (alfanumérico)
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

async function callZapSign(action: string, body: Record<string, any>): Promise<any> {
  const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/zapsign-api`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUD_ANON_KEY}`,
      apikey: CLOUD_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  return await r.json().catch(() => ({}));
}

async function fetchRecentMessages(phone: string, instance: string, limit = 50): Promise<any[]> {
  const { data } = await ext
    .from('whatsapp_messages')
    .select('direction, message_text, media_url, media_type, message_type, created_at, transcription')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function fetchRecentMediaUrls(phone: string, instance: string, limit = 20): Promise<any[]> {
  const { data } = await ext
    .from('whatsapp_messages')
    .select('id, media_url, media_type, message_type, created_at, message_text')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .not('media_url', 'is', null)
    .in('message_type', ['image', 'document', 'audio'])
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).map((m: any) => ({
    id: m.id,
    url: m.media_url,
    type: m.media_type || m.message_type,
    caption: m.message_text || null,
    created_at: m.created_at,
  }));
}

async function fetchContactAndLead(phone: string): Promise<{ contact: any; lead: any; signerName: string }> {
  const { data: contact } = await ext
    .from('contacts')
    .select('id, full_name, phone, email, cpf, street, neighborhood, city, state, cep, profession')
    .eq('phone', phone)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  let lead: any = null;
  if (contact?.id) {
    const { data: lc } = await ext
      .from('leads')
      .select('id, lead_name, phone, email, cpf')
      .eq('contact_id', contact.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = lc;
  }
  const signerName = lead?.lead_name || contact?.full_name || `Cliente ${phone.slice(-4)}`;
  return { contact, lead, signerName };
}

async function getInstanceCreds(instance: string): Promise<{ token?: string; baseUrl?: string; reviewPhone?: string }> {
  const { data } = await ext
    .from('whatsapp_instances')
    .select('instance_token, base_url, review_notification_phone')
    .ilike('instance_name', instance)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return {
    token: data?.instance_token,
    baseUrl: data?.base_url,
    reviewPhone: data?.review_notification_phone,
  };
}

async function getNotificationSettings(): Promise<{
  notifier_instance_name?: string;
  is_enabled: boolean;
  review_base_url: string;
  message_template: string;
}> {
  const { data } = await ext
    .from('label_review_notification_settings')
    .select('notifier_instance_name, is_enabled, review_base_url, message_template')
    .limit(1)
    .maybeSingle();
  return {
    notifier_instance_name: data?.notifier_instance_name,
    is_enabled: data?.is_enabled !== false,
    review_base_url: data?.review_base_url || 'https://adscore-keeper.lovable.app',
    message_template:
      data?.message_template ||
      '📋 Procuração *{label_name}* pronta pra revisão\n\nCliente: {contact_name} ({phone})\nGerada por: {member_name}\nCampos preenchidos: {filled_count}/{total_count}\n\n📊 Hoje: você {personal_count} | equipe {team_count}\n\n👉 {review_url}',
  };
}

async function getMemberName(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Sistema';
  // Tenta no Cloud via proxy
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/rest/v1/profiles?user_id=eq.${userId}&select=full_name`, {
      headers: { apikey: CLOUD_ANON_KEY, Authorization: `Bearer ${CLOUD_ANON_KEY}` },
    });
    const j = await r.json().catch(() => []);
    if (Array.isArray(j) && j[0]?.full_name) return j[0].full_name;
  } catch {}
  return 'Operador';
}

async function countToday(userId: string | null | undefined): Promise<{ personal: number; team: number }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isoStart = todayStart.toISOString();

  const teamQ = await ext
    .from('pending_label_documents')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', isoStart)
    .is('deleted_at', null);

  let personal = 0;
  if (userId) {
    const pq = await ext
      .from('pending_label_documents')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', isoStart)
      .eq('triggered_by_user_id', userId)
      .is('deleted_at', null);
    personal = pq.count || 0;
  }
  return { personal, team: teamQ.count || 0 };
}

async function sendWhatsAppText(instance: string, phone: string, text: string): Promise<boolean> {
  const creds = await getInstanceCreds(instance);
  if (!creds.token || !creds.baseUrl) {
    console.warn('[prepare-label-document-trigger] no creds for notifier instance', instance);
    return false;
  }
  try {
    const r = await fetch(`${creds.baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: creds.token },
      body: JSON.stringify({ number: phone, text }),
    });
    return r.ok;
  } catch (e: any) {
    console.error('[prepare-label-document-trigger] send-text error:', e?.message);
    return false;
  }
}

function countFilled(extracted: any[]): number {
  if (!Array.isArray(extracted)) return 0;
  return extracted.filter((f) => f?.para && String(f.para).trim() !== '').length;
}

function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { chatId, phone, instance, labelName, templateId, triggerId, createdBy } = (req.body || {}) as any;
    if (!chatId || !phone || !instance || !labelName) {
      return res.json({ success: false, error: 'chatId, phone, instance, labelName são obrigatórios' });
    }

    const normPhone = normalizePhone(phone);
    const normInstance = normalizeInstance(instance);

    // Anti-duplicação: já existe pending/awaiting/auto_generated recente?
    const { data: existing } = await ext
      .from('pending_label_documents')
      .select('id, status, review_token')
      .eq('chat_id', chatId)
      .ilike('label_name', labelName)
      .ilike('instance_name', normInstance)
      .in('status', ['pending', 'awaiting_operator_review', 'auto_generated'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log('[prepare-label-document-trigger] already exists:', existing.id, existing.status);
      return res.json({ success: true, pending_id: existing.id, reused: true, status: existing.status });
    }

    // Coleta contexto em paralelo
    const [messages, mediaUrls, ctx, settings] = await Promise.all([
      fetchRecentMessages(normPhone, normInstance, 50),
      fetchRecentMediaUrls(normPhone, normInstance, 20),
      fetchContactAndLead(normPhone),
      getNotificationSettings(),
    ]);

    let extractedArr: any[] = [];
    let templateFields: any[] = [];

    if (templateId) {
      try {
        const tmpl = await callZapSign('get_template', { template_token: templateId });
        if (tmpl?.success) {
          templateFields = tmpl.fields || [];
        }
      } catch (e: any) {
        console.warn('[prepare-label-document-trigger] get_template exception:', e?.message);
      }
    }

    if (templateFields.length > 0) {
      try {
        const extractRes = await callZapSign('extract_data', {
          messages,
          template_fields: templateFields,
          lead_data: ctx.lead || {},
          contact_data: ctx.contact || {},
          uploaded_documents: [],
          conservative_mode: true,
        });
        if (extractRes?.success) {
          extractedArr = extractRes.extracted_data || [];
        }
      } catch (e: any) {
        console.warn('[prepare-label-document-trigger] extract_data exception:', e?.message);
      }
    }

    const filledCount = countFilled(extractedArr);
    const totalFields = templateFields.length;

    const { count: msgCount } = await ext
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', normPhone)
      .ilike('instance_name', normInstance);

    const reviewToken = genReviewToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h

    // Insere registro awaiting_operator_review
    const { data: inserted, error: insErr } = await ext
      .from('pending_label_documents')
      .insert({
        chat_id: chatId,
        phone: normPhone,
        instance_name: normInstance,
        contact_name: ctx.signerName,
        label_name: labelName,
        zapsign_template_id: templateId || null,
        trigger_id: triggerId || null,
        extracted_fields: { fields: extractedArr, filled_count: filledCount, total_count: totalFields },
        extracted_documents: mediaUrls,
        message_count: msgCount || 0,
        status: 'awaiting_operator_review',
        triggered_by_user_id: createdBy || null,
        review_token: reviewToken,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      console.error('[prepare-label-document-trigger] insert falhou:', insErr);
      return res.json({ success: false, error: insErr?.message || 'insert falhou' });
    }

    // Envia notificação no WhatsApp
    let notificationSent = false;
    let notificationError: string | null = null;

    if (!settings.is_enabled) {
      notificationError = 'notifications_disabled';
    } else if (!settings.notifier_instance_name) {
      notificationError = 'no_notifier_instance_configured';
    } else {
      const creds = await getInstanceCreds(normInstance);
      const destPhone = creds.reviewPhone;
      if (!destPhone) {
        notificationError = `no_review_phone_for_instance_${normInstance}`;
      } else {
        const [memberName, counts] = await Promise.all([
          getMemberName(createdBy),
          countToday(createdBy),
        ]);

        const reviewUrl = `${settings.review_base_url.replace(/\/$/, '')}/revisar/${reviewToken}`;
        const msg = renderTemplate(settings.message_template, {
          label_name: labelName,
          contact_name: ctx.signerName,
          phone: normPhone,
          member_name: memberName,
          filled_count: filledCount,
          total_count: totalFields,
          personal_count: counts.personal,
          team_count: counts.team,
          review_url: reviewUrl,
        });

        notificationSent = await sendWhatsAppText(settings.notifier_instance_name, normalizePhone(destPhone), msg);

        if (notificationSent) {
          await ext
            .from('pending_label_documents')
            .update({
              review_notified_phone: normalizePhone(destPhone),
              review_notification_sent_at: new Date().toISOString(),
            })
            .eq('id', inserted.id);
        } else {
          notificationError = 'whatsapp_send_failed';
        }
      }
    }

    return res.json({
      success: true,
      pending_id: inserted.id,
      review_token: reviewToken,
      filled_count: filledCount,
      total_count: totalFields,
      notification_sent: notificationSent,
      notification_error: notificationError,
    });
  } catch (err: any) {
    console.error('[prepare-label-document-trigger] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};

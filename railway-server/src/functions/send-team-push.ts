// Envia Web Push (notificação nativa) para os participantes de um thread de chat
// de equipe. Destinatários = quem já participou do thread + mencionados, menos o
// remetente. Usa as assinaturas em push_subscriptions (Externo) e a chave privada
// VAPID (secret do Railway).
//
// Body: { entity_type, entity_id, sender_id, sender_name, content, is_urgent?,
//         mentioned_user_ids?: string[], url?: string }
// Retorno: HTTP 200 { success, sent?, failed?, error? }
//
// Env no Railway: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional).
import type { RequestHandler } from 'express';
import webpush from 'web-push';
import { supabase } from '../lib/supabase';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:processual@rprudencioadv.com';

let configured = false;
function ensureVapid(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    if (!ensureVapid()) {
      return res.json({ success: false, error: 'VAPID não configurado (defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY)' });
    }

    const {
      entity_type,
      entity_id,
      conversation_id,
      sender_id,
      sender_name,
      content,
      is_urgent,
      mentioned_user_ids,
      url,
    } = req.body || {};

    if (!entity_id && !conversation_id) {
      return res.json({ success: false, error: 'entity_id ou conversation_id obrigatório' });
    }

    // Destinatários: mencionados + participantes, menos o remetente.
    const recipients = new Set<string>();
    (Array.isArray(mentioned_user_ids) ? mentioned_user_ids : []).forEach((id: string) => {
      if (id) recipients.add(id);
    });

    if (conversation_id) {
      // Chat direto/grupo: todos os membros da conversa.
      const { data: members } = await supabase
        .from('team_conversation_members')
        .select('user_id')
        .eq('conversation_id', conversation_id);
      (members || []).forEach((m: { user_id: string | null }) => {
        if (m.user_id) recipients.add(m.user_id);
      });
    } else {
      // Chat de entidade (atv/lead/processo/contato): quem já participou do thread.
      const { data: parts } = await supabase
        .from('team_chat_messages')
        .select('sender_id')
        .eq('entity_type', entity_type)
        .eq('entity_id', entity_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      (parts || []).forEach((p: { sender_id: string | null }) => {
        if (p.sender_id) recipients.add(p.sender_id);
      });
    }

    if (sender_id) recipients.delete(sender_id);
    if (recipients.size === 0) return res.json({ success: true, sent: 0 });

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', Array.from(recipients));

    if (!subs || subs.length === 0) return res.json({ success: true, sent: 0 });

    const title = is_urgent ? `⚠ URGENTE — ${sender_name || 'Equipe'}` : (sender_name || 'Chat da equipe');
    const body = String(content || '')
      .replace(/\[(lead|contact|activity):[a-f0-9-]+:([^\]]+)\]/g, '$2')
      .slice(0, 180);
    const payload = JSON.stringify({
      title,
      body,
      url: url || '/',
      urgent: !!is_urgent,
      tag: conversation_id ? `team-conv-${conversation_id}` : `team-${entity_type}-${entity_id}`,
    });

    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent++;
        } catch (err: unknown) {
          failed++;
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            // Assinatura expirada/inválida — remove.
            await supabase.from('push_subscriptions').delete().eq('id', s.id);
          }
        }
      }),
    );

    return res.json({ success: true, sent, failed });
  } catch (err: unknown) {
    return res.json({ success: false, error: err instanceof Error ? err.message : 'unknown' });
  }
};

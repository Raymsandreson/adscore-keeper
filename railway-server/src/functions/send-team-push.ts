// Envia Web Push (notificação nativa) para os participantes de um thread de chat
// de equipe. Destinatários = quem já participou do thread + mencionados, menos o
// remetente. Usa as assinaturas em push_subscriptions (Externo) e a chave privada
// VAPID (secret do Railway).
//
// Body: { entity_type, entity_id, sender_id, sender_name, content, is_urgent?,
//         mentioned_user_ids?: string[], url?: string }
// Também aceita `user_ids: string[]` — destinatários diretos, sem thread nenhum
// (usado pelo alerta da gestão no painel "Time agora", que precisa alcançar
// quem está com o sistema fechado). Nesse caso `title` e `tag` são opcionais.
// Retorno: HTTP 200 { success, sent?, failed?, error? }
//
// Env no Railway: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional).
import type { RequestHandler } from 'express';
import webpush from 'web-push';
import { supabase } from '../lib/supabase';
import { enviarExpo, type ExpoMensagem } from '../lib/expo-push';

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
      // Chat de atividade é da CADEIA: quem participou pode ter falado numa
      // etapa anterior, com outro entity_id. O cliente manda os elos.
      entity_ids,
      conversation_id,
      sender_id,
      sender_name,
      content,
      is_urgent,
      mentioned_user_ids,
      user_ids,
      title: titleOverride,
      tag: tagOverride,
      url,
    } = req.body || {};

    const directIds = (Array.isArray(user_ids) ? user_ids : []).filter(Boolean) as string[];

    if (!entity_id && !conversation_id && directIds.length === 0) {
      return res.json({ success: false, error: 'entity_id, conversation_id ou user_ids obrigatório' });
    }

    // Destinatários: mencionados + participantes, menos o remetente.
    const recipients = new Set<string>(directIds);
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
    } else if (entity_id) {
      // Chat de entidade (atv/lead/processo/contato): quem já participou do thread.
      const elos = (Array.isArray(entity_ids) ? entity_ids : []).filter(Boolean) as string[];
      if (!elos.includes(entity_id)) elos.push(entity_id);
      const { data: parts } = await supabase
        .from('team_chat_messages')
        .select('sender_id')
        .eq('entity_type', entity_type)
        .in('entity_id', elos)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      (parts || []).forEach((p: { sender_id: string | null }) => {
        if (p.sender_id) recipients.add(p.sender_id);
      });
    }

    // Chat de passo de POP: além dos participantes, notifica o GERENTE do time
    // responsável pelo POP (responsável = gerente do time em settings.responsible_team_id).
    // Também injeta a URL de deep-link pra notificação cair direto no passo.
    let pushUrl: string | undefined = url;
    if (entity_type === 'pop_step' && entity_id) {
      try {
        // step.id → template (items @> [{id}]) → checklist_stage_links.board_id
        const { data: tmpl } = await (supabase as any)
          .from('checklist_templates')
          .select('id')
          .contains('items', [{ id: entity_id }])
          .limit(1)
          .maybeSingle();
        let boardId: string | null = null;
        if (tmpl?.id) {
          const { data: link } = await supabase
            .from('checklist_stage_links')
            .select('board_id')
            .eq('checklist_template_id', tmpl.id)
            .limit(1)
            .maybeSingle();
          boardId = (link as { board_id?: string } | null)?.board_id ?? null;
        }
        if (boardId) {
          pushUrl = `/workflow-progress?editBoard=${boardId}&openStep=${entity_id}&openStepChat=1`;
          const { data: board } = await supabase
            .from('kanban_boards')
            .select('settings')
            .eq('id', boardId)
            .maybeSingle();
          const teamId = (board?.settings as { responsible_team_id?: string } | null)?.responsible_team_id || null;
          if (teamId) {
            const { data: mgrs } = await supabase
              .from('team_managers')
              .select('manager_user_id')
              .eq('team_id', teamId);
            (mgrs || []).forEach((m: { manager_user_id: string | null }) => {
              if (m.manager_user_id) recipients.add(m.manager_user_id);
            });
          }
        }
      } catch (e) {
        console.error('pop_step: falha ao resolver gerente do POP:', e);
      }
    }

    if (sender_id) recipients.delete(sender_id);
    if (recipients.size === 0) return res.json({ success: true, sent: 0 });

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, provider')
      .in('user_id', Array.from(recipients));

    if (!subs || subs.length === 0) return res.json({ success: true, sent: 0 });

    // Duas famílias de assinatura na mesma tabela: navegador (VAPID) e app
    // (token Expo). `provider` nulo é linha anterior à migration — Web Push.
    type Sub = { id: string; endpoint: string; p256dh: string | null; auth: string | null; provider: string | null };
    const todas = subs as Sub[];
    const web = todas.filter((s) => (s.provider || 'webpush') === 'webpush' && s.p256dh && s.auth);
    const expo = todas.filter((s) => s.provider === 'expo');

    const title = titleOverride
      || (is_urgent ? `⚠ URGENTE — ${sender_name || 'Equipe'}` : (sender_name || 'Chat da equipe'));
    const body = String(content || '')
      .replace(/\[(lead|contact|activity):[a-f0-9-]+:([^\]]+)\]/g, '$2')
      .slice(0, 180);
    const payload = JSON.stringify({
      title,
      body,
      url: pushUrl || '/',
      urgent: !!is_urgent,
      tag: tagOverride
        || (conversation_id ? `team-conv-${conversation_id}` : `team-${entity_type}-${entity_id}`),
    });

    let sent = 0;
    let failed = 0;
    await Promise.all(
      web.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
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

    // Canal do app. O corpo é o mesmo do Web Push — quem muda é o transporte —,
    // e a `url` viaja em `data` para o deep link abrir a tela certa no toque.
    if (expo.length > 0) {
      const mensagens: ExpoMensagem[] = expo.map((s) => ({
        to: s.endpoint,
        title,
        body,
        urgente: !!is_urgent,
        data: { url: pushUrl || '/', tag: JSON.parse(payload).tag },
      }));

      const r = await enviarExpo(mensagens);
      sent += r.enviados;
      failed += r.falhas;

      if (r.tokensMortos.length > 0) {
        // App desinstalado ou token rotacionado: mesma limpeza que o 404/410 do
        // Web Push faz. Sem isso a tabela só cresce e o `sent` mente.
        await supabase.from('push_subscriptions').delete().in('endpoint', r.tokensMortos);
      }
    }

    return res.json({ success: true, sent, failed });
  } catch (err: unknown) {
    return res.json({ success: false, error: err instanceof Error ? err.message : 'unknown' });
  }
};

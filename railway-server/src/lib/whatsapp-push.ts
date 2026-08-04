// Push de mensagem nova do WhatsApp — notificação nativa no celular, com deep
// link direto na conversa dentro do WhatsJUD.
//
// Quem recebe (escopo definido com o Raym em 04/08/2026):
//   1) o DONO da instância que recebeu a mensagem (whatsapp_instances.owner_user_id);
//   2) o RESPONSÁVEL do processo, quando a mensagem vem de um grupo vinculado a
//      um lead (leads.processual_responsible_id + lead_processes.responsible_user_id).
//
// Chamado em fire-and-forget pelo whatsapp-webhook depois de gravar a mensagem.
// NUNCA lança: falha de push não pode derrubar a gravação da mensagem.
//
// O controle de volume e de duplicata vive no Postgres (wa_push_claim), porque
// as 4 cópias da mesma mensagem de grupo chegam em milissegundos e precisam ser
// resolvidas por lock, não por lógica no processo.
import webpush from 'web-push';
import { supabase } from './supabase';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:processual@rprudencioadv.com';

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
  return true;
}

export interface NewMessagePushInput {
  phone: string;                 // telefone do contato OU JID do grupo (como gravado)
  instanceName: string;
  contactName?: string | null;   // no grupo, é o nome do grupo
  messageText?: string | null;
  messageType?: string | null;
  externalMessageId?: string | null;
  messageId: string;             // id da linha em whatsapp_messages (fallback de chave)
  isGroup: boolean;
  leadId?: string | null;
}

interface Prefs {
  user_id: string;
  enabled: boolean;
  notify_owned_instance: boolean;
  notify_process_groups: boolean;
  group_window_minutes: number;
  quiet_start_hour: number;
  quiet_end_hour: number;
  weekdays_only: boolean;
  muted_chats: string[] | null;
}

const DEFAULT_PREFS: Omit<Prefs, 'user_id'> = {
  enabled: true,
  notify_owned_instance: true,
  notify_process_groups: true,
  group_window_minutes: 5,
  quiet_start_hour: 22,
  quiet_end_hour: 7,
  weekdays_only: false,
  muted_chats: [],
};

/** Só dígitos — o JID de grupo chega ora com @g.us, ora sem. */
function digits(raw: string | null | undefined): string {
  return (raw || '').replace(/@[a-z.]+$/i, '').replace(/\D/g, '');
}

/**
 * ID canônico da mensagem no WhatsApp.
 *
 * O external_message_id vem prefixado pelo telefone da instância que recebeu
 * ("558681595991:AC0DA1DF..."). O trecho após ":" é o ID real da mensagem e é o
 * MESMO nas cópias gravadas por cada instância da casa que está no grupo — é
 * ele que impede o responsável de levar 4 pushes do mesmo "Ok".
 */
function canonicalMessageKey(externalMessageId: string | null | undefined, fallback: string): string {
  const raw = (externalMessageId || '').trim();
  if (!raw) return `row:${fallback}`;
  const parts = raw.split(':');
  const tail = parts[parts.length - 1].trim();
  return tail || raw;
}

/** Hora e dia da semana em São Paulo, sem depender do TZ do container. */
function nowInSaoPaulo(): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const wdRaw = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: hour === 24 ? 0 : hour, weekday: map[wdRaw] ?? 1 };
}

/** Silêncio noturno: start = end desliga. Janela pode cruzar a meia-noite. */
function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Prévia curta da mensagem, com rótulo para mídia (nunca vaza conteúdo longo). */
function previewBody(text: string | null | undefined, type: string | null | undefined): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const kind = (type || 'text').toLowerCase();
  if (clean) return clean.slice(0, 140);
  if (kind.includes('image')) return '📷 Foto';
  if (kind.includes('video')) return '🎥 Vídeo';
  if (kind.includes('audio') || kind.includes('ptt')) return '🎤 Áudio';
  if (kind.includes('document')) return '📄 Documento';
  if (kind.includes('sticker')) return '🏷️ Figurinha';
  if (kind.includes('location')) return '📍 Localização';
  if (kind.includes('contact')) return '👤 Contato';
  return 'Nova mensagem';
}

/**
 * Responsáveis pelo processo do grupo.
 * grupo → lead_whatsapp_groups.group_jid → lead → responsável processual do lead
 * e responsável de cada processo do lead.
 */
async function resolveGroupResponsibles(groupDigits: string, leadIdHint?: string | null): Promise<string[]> {
  const out = new Set<string>();
  try {
    let leadId = leadIdHint || null;

    if (!leadId) {
      // group_jid é gravado ora "1203...@g.us", ora só dígitos — cobre os dois.
      const { data: links } = await supabase
        .from('lead_whatsapp_groups')
        .select('lead_id, group_jid')
        .in('group_jid', [`${groupDigits}@g.us`, groupDigits])
        .limit(5);
      leadId = (links || []).find((l: { lead_id?: string }) => l.lead_id)?.lead_id ?? null;
    }

    if (!leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .in('whatsapp_group_id', [`${groupDigits}@g.us`, groupDigits])
        .limit(1)
        .maybeSingle();
      leadId = (lead as { id?: string } | null)?.id ?? null;
    }

    if (!leadId) return [];

    const [leadRes, procRes] = await Promise.all([
      supabase.from('leads').select('processual_responsible_id').eq('id', leadId).maybeSingle(),
      supabase.from('lead_processes').select('responsible_user_id').eq('lead_id', leadId).is('deleted_at', null),
    ]);

    const leadResp = (leadRes.data as { processual_responsible_id?: string } | null)?.processual_responsible_id;
    if (leadResp) out.add(leadResp);
    (procRes.data || []).forEach((p: { responsible_user_id?: string | null }) => {
      if (p.responsible_user_id) out.add(p.responsible_user_id);
    });
  } catch (e) {
    console.error('[wa-push] falha ao resolver responsáveis do grupo:', e);
  }
  return Array.from(out);
}

async function loadPrefs(userIds: string[]): Promise<Map<string, Prefs>> {
  const map = new Map<string, Prefs>();
  userIds.forEach((id) => map.set(id, { user_id: id, ...DEFAULT_PREFS }));
  try {
    const { data } = await supabase
      .from('whatsapp_push_prefs')
      .select('user_id, enabled, notify_owned_instance, notify_process_groups, group_window_minutes, quiet_start_hour, quiet_end_hour, weekdays_only, muted_chats')
      .in('user_id', userIds);
    (data || []).forEach((row: Prefs) => map.set(row.user_id, { ...DEFAULT_PREFS, ...row }));
  } catch (e) {
    console.error('[wa-push] falha ao ler preferências, usando padrão:', e);
  }
  return map;
}

async function pushToUser(userId: string, payload: string): Promise<number> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return 0;

  let sent = 0;
  await Promise.all(
    subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
    }),
  );
  return sent;
}

/**
 * Dispara o push da mensagem nova. Fire-and-forget: sempre resolve, nunca rejeita.
 */
export async function notifyNewWhatsAppMessage(input: NewMessagePushInput): Promise<void> {
  try {
    if (!ensureVapid()) return;

    const convDigits = digits(input.phone);
    if (!convDigits) return;

    // ---- Destinatários ------------------------------------------------------
    const ownerIds = new Set<string>();
    const groupIds = new Set<string>();

    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('owner_user_id')
      .eq('instance_name', input.instanceName)
      .maybeSingle();
    const ownerId = (inst as { owner_user_id?: string | null } | null)?.owner_user_id ?? null;
    if (ownerId) ownerIds.add(ownerId);

    if (input.isGroup) {
      (await resolveGroupResponsibles(convDigits, input.leadId)).forEach((id) => groupIds.add(id));
    }

    const allIds = Array.from(new Set([...ownerIds, ...groupIds]));
    if (allIds.length === 0) return;

    // ---- Preferências -------------------------------------------------------
    const prefs = await loadPrefs(allIds);
    const { hour, weekday } = nowInSaoPaulo();

    const eligible = allIds.filter((id) => {
      const p = prefs.get(id);
      if (!p || !p.enabled) return false;

      // O motivo pelo qual a pessoa entrou na lista define qual chave manda.
      const byOwner = ownerIds.has(id) && p.notify_owned_instance;
      const byGroup = groupIds.has(id) && p.notify_process_groups;
      if (!byOwner && !byGroup) return false;

      if ((p.muted_chats || []).some((m) => digits(m) === convDigits)) return false;
      if (p.weekdays_only && (weekday === 0 || weekday === 6)) return false;
      if (inQuietHours(hour, p.quiet_start_hour, p.quiet_end_hour)) return false;
      return true;
    });

    if (eligible.length === 0) return;

    // ---- Reserva atômica + envio -------------------------------------------
    const msgKey = canonicalMessageKey(input.externalMessageId, input.messageId);
    const title = (input.contactName || '').trim() || convDigits;
    const preview = previewBody(input.messageText, input.messageType);
    const url = `/whatsapp?openChat=${encodeURIComponent(input.phone)}&instance=${encodeURIComponent(input.instanceName)}`;

    await Promise.all(
      eligible.map(async (userId) => {
        try {
          const p = prefs.get(userId)!;
          const { data: claim, error } = await supabase.rpc('wa_push_claim', {
            p_user_id: userId,
            p_conv_key: convDigits,
            p_msg_key: msgKey,
            p_window_minutes: p.group_window_minutes,
          });
          if (error) {
            console.error('[wa-push] wa_push_claim falhou:', error.message);
            return;
          }

          const row = Array.isArray(claim) ? claim[0] : claim;
          if (!row?.should_send) return;

          const pending = Number(row.pending_count || 1);
          const body = pending > 1 ? `${pending} mensagens novas — ${preview}` : preview;

          const payload = JSON.stringify({
            title,
            body,
            url,
            // tag por conversa: o sistema SUBSTITUI a notificação anterior em vez
            // de empilhar uma por mensagem.
            tag: `wa-${convDigits}`,
            urgent: false,
          });

          const sent = await pushToUser(userId, payload);
          if (sent > 0) {
            console.log(`[wa-push] ${sent} push(es) → user ${userId} · conversa ${convDigits} · ${pending} msg(s)`);
          }
        } catch (e) {
          console.error('[wa-push] falha no envio para', userId, e);
        }
      }),
    );
  } catch (e) {
    console.error('[wa-push] erro geral (ignorado):', e);
  }
}

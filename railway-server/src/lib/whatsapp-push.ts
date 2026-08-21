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
import { enviarExpo } from './expo-push';

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
 * Quem responde por um grupo: responsável do processo OU acolhedor do lead.
 *
 * grupo → lead_whatsapp_groups.group_jid → lead, e daí:
 *   - leads.processual_responsible_id  (responsável processual)
 *   - lead_processes.responsible_user_id  (responsável de cada processo)
 *   - leads.acolhedor (texto) resolvido por wa_resolve_acolhedor
 *
 * O dono da instância NÃO entra aqui de propósito: grupo é 94% do volume
 * (2.343 de 2.481 mensagens/dia na instância "Raym"), então notificar o dono de
 * tudo que passa nos grupos dele é exatamente o que faz a pessoa desligar.
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
      supabase.from('leads').select('processual_responsible_id, acolhedor, acolhedor_user_id').eq('id', leadId).maybeSingle(),
      supabase.from('lead_processes').select('responsible_user_id').eq('lead_id', leadId).is('deleted_at', null),
    ]);

    const lead = leadRes.data as {
      processual_responsible_id?: string | null;
      acolhedor?: string | null;
      acolhedor_user_id?: string | null;
    } | null;
    if (lead?.processual_responsible_id) out.add(lead.processual_responsible_id);
    (procRes.data || []).forEach((p: { responsible_user_id?: string | null }) => {
      if (p.responsible_user_id) out.add(p.responsible_user_id);
    });

    // acolhedor_user_id é a fonte da verdade desde a padronização (96,5% dos
    // leads). O texto só é consultado no que sobrou sem id.
    if (lead?.acolhedor_user_id) {
      out.add(lead.acolhedor_user_id);
    } else if (lead?.acolhedor && lead.acolhedor.trim()) {
      const { data: acolhedorId, error } = await supabase.rpc('wa_resolve_acolhedor', { p_name: lead.acolhedor });
      if (error) {
        console.error('[wa-push] wa_resolve_acolhedor falhou:', error.message);
      } else if (acolhedorId) {
        out.add(acolhedorId as unknown as string);
      }
    }
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

/**
 * Traduz um user_id do Externo para o do Cloud.
 *
 * Os dois bancos têm auth próprio e a MESMA pessoa tem ids diferentes em 26 dos
 * 51 cadastros. Tudo que este módulo resolve (owner_user_id, responsável do
 * processo, acolhedor_user_id) vive no Externo, mas push_subscriptions é gravada
 * pelo front com o id do CLOUD — as 22 inscrições estão todas assim. Sem esta
 * tradução, procurar a inscrição pelo id do Externo só acha as pessoas em que os
 * dois ids por acaso coincidem, e as outras 26 nunca recebem nada.
 */
async function toCloudUserId(extUserId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('auth_uuid_mapping')
      .select('cloud_uuid')
      .eq('ext_uuid', extUserId)
      .maybeSingle();
    return (data as { cloud_uuid?: string } | null)?.cloud_uuid || extUserId;
  } catch {
    return extUserId;
  }
}

/**
 * O aviso antes de virar payload — os dois canais dizem a mesma coisa, cada um
 * na sua embalagem.
 */
interface Aviso {
  title: string;
  body: string;
  /** Rota no web; é o que o service worker abre. */
  url: string;
  /** Rota no app; outra árvore de rotas (ver `rotaDoApp`). */
  urlApp: string;
  tag: string;
}

/**
 * A rota da conversa DENTRO DO APP.
 *
 * O web abre `/whatsapp?openChat=…`: uma tela de lista mais um parâmetro. O app
 * tem a conversa como rota própria (`/conversa/[telefone]`) e ignoraria aquele
 * parâmetro — o toque abriria a lista, não o papo. São duas árvores de rotas
 * para a mesma notificação, então o endereço viaja em dobro: `url` no payload
 * do navegador, `data.url` na mensagem do Expo.
 *
 * O telefone vai em dígitos porque é assim que o app identifica a conversa
 * (`telefoneDaConversa`), inclusive grupo — lá o `@g.us` é retirado. A
 * instância viaja junto porque a thread não a adivinha: sem ela, quem é
 * atendido por dois números da firma abre com as conversas misturadas.
 */
function rotaDoApp(convDigits: string, instanceName: string, nome: string): string {
  // `encodeURIComponent` e não `URLSearchParams`: este último escreve espaço
  // como "+", e quem lê do outro lado é o parser de rotas do expo-router, não
  // um formulário. Nome de grupo tem espaço em quase todos ("LEAD290 | ..."),
  // e o "+" apareceria cru no cabeçalho da conversa.
  const q = `instancia=${encodeURIComponent(instanceName)}&nome=${encodeURIComponent(nome)}`;
  return `/conversa/${encodeURIComponent(convDigits)}?${q}`;
}

async function pushToUser(userId: string, aviso: Aviso): Promise<number> {
  const cloudId = await toCloudUserId(userId);

  // Aceita os dois: quem tem cloud_uuid = ext_uuid cai no mesmo valor, e uma
  // inscrição antiga gravada com o id do Externo continua sendo encontrada.
  const ids = Array.from(new Set([cloudId, userId]));
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, provider')
    .in('user_id', ids);

  if (!subs || subs.length === 0) return 0;

  // Duas famílias de assinatura na MESMA tabela: navegador (VAPID) e app (token
  // Expo). `provider` nulo é linha anterior à migration — Web Push.
  //
  // Sem esta separação o token do app entrava no `webpush.sendNotification`
  // como se fosse endpoint de navegador, com as chaves nulas, e o envio morria
  // sem status HTTP nenhum. Era por isso que mensagem nova de WhatsApp nunca
  // chegava no celular: o único evento dos seis do §4.2 que não passa pelo
  // `send-team-push`, e portanto o único que ficou sem o canal do app.
  type Sub = { id: string; endpoint: string; p256dh: string | null; auth: string | null; provider: string | null };
  const todas = subs as Sub[];
  const web = todas.filter((s) => (s.provider || 'webpush') === 'webpush' && s.p256dh && s.auth);
  const expo = todas.filter((s) => s.provider === 'expo');

  let sent = 0;

  // O VAPID é do Web Push e só dele. A checagem mora aqui, e não na entrada de
  // `notifyNewWhatsAppMessage`, porque lá ela derrubava os dois canais: chave
  // do navegador faltando calava também o app, que não usa VAPID para nada.
  if (web.length > 0 && ensureVapid()) {
    const payload = JSON.stringify({
      title: aviso.title,
      body: aviso.body,
      url: aviso.url,
      tag: aviso.tag,
      urgent: false,
    });
    await Promise.all(
      web.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            payload,
          );
          sent++;
        } catch (err: unknown) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', s.id);
          }
        }
      }),
    );
  }

  if (expo.length > 0) {
    const r = await enviarExpo(
      expo.map((s) => ({
        to: s.endpoint,
        title: aviso.title,
        body: aviso.body,
        // Mensagem de cliente não é urgência da gestão: vai no canal normal.
        data: { url: aviso.urlApp, tag: aviso.tag },
      })),
    );
    sent += r.enviados;

    if (r.tokensMortos.length > 0) {
      // App desinstalado ou token rotacionado — a mesma limpeza que o 404/410
      // faz do lado do navegador.
      await supabase.from('push_subscriptions').delete().in('endpoint', r.tokensMortos);
    }
  }

  return sent;
}

/**
 * Dispara o push da mensagem nova. Fire-and-forget: sempre resolve, nunca rejeita.
 */
export async function notifyNewWhatsAppMessage(input: NewMessagePushInput): Promise<void> {
  try {
    // Nada de `ensureVapid()` aqui. Ele guardava a função inteira, então uma
    // chave de Web Push faltando calava também o canal do app — que é Expo e
    // não tem nada com VAPID. A checagem foi para dentro de `pushToUser`, no
    // ramo a que ela pertence.
    const convDigits = digits(input.phone);
    if (!convDigits) return;

    // ---- Destinatários ------------------------------------------------------
    // Regra, na ordem em que é aplicada:
    //   0) DONO DA CONVERSA, se houver — vale para grupo e privada;
    //   1) sem dono, conversa PRIVADA → dono da instância;
    //   2) sem dono, GRUPO → responsável do processo ou acolhedor do lead.
    // O dono da instância nunca recebe o que passa nos grupos dele: grupo é ~94%
    // do volume, e notificar tudo é o que faz a pessoa desligar o push.
    const ownerIds = new Set<string>();
    const groupIds = new Set<string>();

    // JID de grupo é gravado só em dígitos (18, começando em 1203) — a flag do
    // webhook é a fonte primária, o formato é a rede de segurança.
    const isGroupMsg = input.isGroup || convDigits.startsWith('1203') || convDigits.length >= 17;

    // Dono da conversa manda em tudo. É o único sinal que diz quem está de fato
    // cuidando DESTE papo — o resto (responsável do processo, acolhedor, dono da
    // instância) é atributo do cliente ou da linha telefônica. Vale para grupo e
    // para privada, e é o que resolve instância compartilhada.
    const { data: assignee } = await supabase
      .from('whatsapp_cloud_assignees')
      .select('assigned_user_id')
      .eq('phone', input.phone)
      .eq('instance_name', input.instanceName)
      .maybeSingle();
    const assignedId = (assignee as { assigned_user_id?: string | null } | null)?.assigned_user_id ?? null;

    if (assignedId) {
      // Entra pelos dois baldes: a pessoa recebe tanto se ligou "conversas
      // privadas" quanto "meus grupos", conforme o tipo da mensagem.
      (isGroupMsg ? groupIds : ownerIds).add(assignedId);
    } else if (isGroupMsg) {
      (await resolveGroupResponsibles(convDigits, input.leadId)).forEach((id) => groupIds.add(id));
    } else {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('owner_user_id')
        .eq('instance_name', input.instanceName)
        .maybeSingle();
      const ownerId = (inst as { owner_user_id?: string | null } | null)?.owner_user_id ?? null;
      if (ownerId) ownerIds.add(ownerId);
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
    const urlApp = rotaDoApp(convDigits, input.instanceName, title);

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

          const sent = await pushToUser(userId, {
            title,
            body,
            url,
            urlApp,
            // tag por conversa: o sistema SUBSTITUI a notificação anterior em vez
            // de empilhar uma por mensagem. Vale nos dois canais.
            tag: `wa-${convDigits}`,
          });
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

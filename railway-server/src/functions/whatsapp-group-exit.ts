// whatsapp-group-exit
// ============================================================
// Recebe webhook UazAPI do evento `group-participants-update`
// (action = remove | leave) e grava em `whatsapp_group_exits` no
// Externo, com lookup de contact_name / lead_name pelo phone.
//
// Como a UazAPI nem sempre marca o evento de forma padronizada,
// aceitamos várias formas de payload:
//   { event: 'group-participants-update', action: 'remove'|'leave',
//     groupJid|chatId, participants: ['55...@s.whatsapp.net'], by? }
//   { type: 'participants', action, group, members: [...] }
// ============================================================
import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

function digits(s: any): string {
  return String(s ?? '').replace(/\D/g, '');
}

function normalizePhone(raw: any): string {
  const d = digits(raw);
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// UazAPI (evento `groups`) repassa o GroupInfo do whatsmeow: quem sai fica
// no array `Leave` (jids), e `Sender` indica quem executou a ação.
export function eventObj(body: any): any {
  if (body?.event && typeof body.event === 'object') return body.event;
  if (body?.data && typeof body.data === 'object') return body.data;
  return {};
}

export function leaveList(body: any): string[] {
  const ev = eventObj(body);
  const arr = body?.Leave || ev?.Leave || ev?.leave || [];
  return Array.isArray(arr) ? arr : [];
}

export function extractPhones(body: any): string[] {
  const candidates: any[] = [];
  if (Array.isArray(body?.participants)) candidates.push(...body.participants);
  if (Array.isArray(body?.members)) candidates.push(...body.members);
  if (Array.isArray(body?.payload?.participants)) candidates.push(...body.payload.participants);
  if (body?.participant) candidates.push(body.participant);
  if (body?.phone) candidates.push(body.phone);
  candidates.push(...leaveList(body));
  return Array.from(new Set(candidates.map((p: any) => normalizePhone(typeof p === 'string' ? p : p?.id || p?.phone || p?.jid)).filter(Boolean)));
}

export function extractAction(body: any): string {
  const raw = body?.action || body?.payload?.action || (typeof body?.event === 'string' ? body.event : '');
  const a = String(raw || '').toLowerCase();
  if (a.includes('leave')) return 'leave';
  if (a.includes('remove') || a.includes('kick')) return 'remove';

  // Formato whatsmeow: Leave presente → saiu sozinho se o Sender é o próprio, removido caso contrário
  const leaves = leaveList(body);
  if (leaves.length) {
    const ev = eventObj(body);
    const senderDigits = digits(ev?.Sender || body?.Sender || '');
    if (!senderDigits) return 'leave';
    const allSelf = leaves.every((l: any) => {
      const d = digits(typeof l === 'string' ? l : l?.id || l?.jid);
      return d && d.slice(-10) === senderDigits.slice(-10);
    });
    return allSelf ? 'leave' : 'remove';
  }
  return a || 'unknown';
}

export function extractGroup(body: any): { jid: string; name: string | null } {
  const ev = eventObj(body);
  const jid = body?.groupJid || body?.chatId || body?.group?.id || body?.payload?.group?.id || body?.group_id
    || ev?.JID || ev?.jid || body?.JID || body?.id || '';
  const name = body?.groupName || body?.group?.name || body?.payload?.group?.subject
    || ev?.Name || ev?.GroupName || null;
  return { jid: String(jid || ''), name: name ? String(name) : null };
}

/**
 * Este payload é um evento de PARTICIPANTE de grupo?
 *
 * Existe porque o webhook principal (/webhooks/uazapi/:instance_name) é o
 * Único que a UazAPI de fato chama, e até 08/09/2026 ele jogava fora tudo que
 * não fosse mensagem ou chamada — inclusive `groups`. O endpoint dedicado
 * /webhooks/uazapi-group-exit existia numa URL que ninguém cadastrou, e a
 * `whatsapp_group_exits` estava com ZERO linhas desde que foi criada.
 *
 * Reconhece as três formas que já apareceram: o EventType `groups` da UazAPI,
 * o nome longo `group-participants-update`, e o payload cru do whatsmeow, que
 * não traz rótulo nenhum — só os arrays `Leave`/`Join`.
 *
 * NUNCA casa mensagem de grupo: mensagem chega como EventType `messages` e não
 * tem `Leave`/`Join`. Confundir as duas faria toda conversa de grupo cair no
 * gravador de saída, que é exatamente o erro que ninguém perceberia.
 */
export function isGroupParticipantEvent(eventType: string, body: any): boolean {
  const tipo = String(eventType || '').toLowerCase();
  if (tipo === 'groups') return true;

  const bruto = [body?.EventType, body?.eventType, body?.event_type, body?.type,
                 typeof body?.event === 'string' ? body.event : '']
    .map((v: any) => String(v || '').toLowerCase());
  if (bruto.some((v) => v.includes('group-participants') || v.includes('group_participants'))) return true;

  // Payload cru do whatsmeow: sem rótulo, mas com quem entrou ou saiu.
  const ev = eventObj(body);
  const temLeave = Array.isArray(body?.Leave || ev?.Leave || ev?.leave);
  const temJoin = Array.isArray(body?.Join || ev?.Join || ev?.join);
  return temLeave || temJoin;
}

export async function handler(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const action = extractAction(body);

    // Só nos interessam saídas de participantes
    if (!['leave', 'remove'].includes(action)) {
      // Loga o payload de eventos de grupo não reconhecidos pra mapear o formato real da UazAPI
      const et = String(body?.EventType || body?.eventType || body?.type || '').toLowerCase();
      if (et.includes('group')) {
        console.log('[whatsapp-group-exit] evento groups sem leave/remove:', JSON.stringify(body).slice(0, 2000));
      }
      return res.status(200).json({ success: true, skipped: true, reason: `action ${action} ignorado` });
    }

    const { jid: groupJid, name: groupName } = extractGroup(body);
    const phones = extractPhones(body);
    const instanceName = String(body?.instance_name || body?.instanceName || body?.instance || '') || null;
    const actor = body?.by || body?.author || body?.participant_actor || null;

    if (!groupJid || phones.length === 0) {
      return res.status(200).json({ success: false, error: 'groupJid + participants obrigatórios', body });
    }

    // Lookup nome do grupo se não veio
    let groupNameResolved = groupName;
    if (!groupNameResolved) {
      const { data: g } = await supabase
        .from('whatsapp_groups_index')
        .select('group_name')
        .eq('group_jid', groupJid)
        .maybeSingle();
      groupNameResolved = g?.group_name || null;
    }

    const rows: any[] = [];
    for (const phone of phones) {
      const last10 = phone.slice(-10);

      // Lookup contact + lead
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, full_name')
        .ilike('phone', `%${last10}`)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

      let leadId: string | null = null;
      let leadName: string | null = null;
      if (contact?.id) {
        const { data: cl } = await supabase
          .from('contact_leads')
          .select('lead_id, leads(id, lead_name)')
          .eq('contact_id', contact.id)
          .limit(1)
          .maybeSingle();
        const leadRow: any = (cl as any)?.leads;
        leadId = leadRow?.id || (cl as any)?.lead_id || null;
        leadName = leadRow?.lead_name || null;
      }

      rows.push({
        phone,
        instance_name: instanceName,
        group_jid: groupJid,
        group_name: groupNameResolved,
        contact_id: contact?.id || null,
        contact_name: contact?.full_name || null,
        lead_id: leadId,
        lead_name: leadName,
        exit_action: action,
        actor: actor ? String(actor) : null,
        raw: body,
      });
    }

    const { error } = await supabase.from('whatsapp_group_exits').insert(rows);
    if (error) {
      console.error('[whatsapp-group-exit] insert error', error);
      return res.status(200).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true, inserted: rows.length });
  } catch (err: any) {
    console.error('[whatsapp-group-exit] error', err);
    return res.status(200).json({ success: false, error: err?.message || 'unknown' });
  }
}

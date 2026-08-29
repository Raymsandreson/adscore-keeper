// sync-group-contacts
// ============================================================
// Sincroniza participantes de um grupo com os contatos do lead: vincula os
// que já existem, marca os da equipe e devolve os novos com nome sugerido.
//
// Portada da edge do Cloud (supabase/functions/sync-group-contacts) pelos
// mesmos motivos da get-group-participants, mais dois próprios:
// (1) a blocklist de equipe lia `whatsapp_instances` e `profiles` do Cloud —
//     essas tabelas moram no Externo, e a cópia do Cloud deixava número de
//     instância/equipe passar como "novo contato";
// (2) o match de contato existente usava `phone.ilike.%<últimos 8 dígitos>`,
//     que assume telefone gravado só com dígitos — contato salvo formatado
//     ("+55 86 9521-7786" tem hífen no meio dos 8 dígitos) nunca casava e o
//     modal oferecia criar duplicata de contato que já existe.
// Também aproveita o nome do roster (/group/info) e o mapa LID→telefone das
// mensagens do grupo, que a edge ignorava — membro "@lid" era descartado e
// nenhum nome era sugerido sem conversa 1:1 prévia.
//
// Body: { group_jid, lead_id, instance_id?, instance_name? }
// Resp: { success, results: { linked_existing, already_linked, needs_creation,
//         skipped_instances }, contact_suggestions: [...] }
// ============================================================
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  digits,
  extractParticipant,
  fetchGroupInfoAcrossInstances,
  buildLidMapFromMessages,
} from './get-group-participants';

const STAFF_CLASSIFICATIONS = ['staff', 'collaborator', 'lawyer', 'attendant'];

function normalizePhone(raw: string): string {
  const d = digits(raw);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length >= 10 && d.length <= 11) return '55' + d;
  return d;
}

// Chave canônica: últimos 10 dígitos (DDD + 8 do número), sem o 9º dígito de
// celular — a MESMA chave para "5586995217786" (13) e "558695217786" (12).
function phoneMatchKey(raw: string): string {
  const d = digits(raw);
  if (!d) return '';
  let local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11 && local[2] === '9') {
    local = local.slice(0, 2) + local.slice(3);
  }
  return local.slice(-10);
}

// Padrão ilike que sobrevive a telefone formatado: intercala % entre os
// dígitos ("%9%5%2%1%7%7%8%6%"), então "+55 86 9521-7786" casa mesmo com o
// hífen no meio. Falso positivo é raríssimo (8 dígitos ordenados) e o match
// exato por phoneMatchKey em memória descarta o que sobrar.
function interleavedPattern(last8: string): string {
  return '%' + last8.split('').join('%') + '%';
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { group_jid, lead_id, instance_id, instance_name } = req.body || {};
    if (!group_jid || !lead_id) {
      return res.json({ success: false, error: 'group_jid and lead_id are required' });
    }

    let groupJid = String(group_jid).trim();
    if (!groupJid.includes('@')) groupJid = `${groupJid}@g.us`;
    if (!groupJid.endsWith('@g.us')) {
      return res.json({ success: false, error: `Formato de JID inválido: ${groupJid}` });
    }

    // --- instâncias (Externo — fonte de verdade, ver db-routing.ts) ---
    const { data: allInst } = await ext
      .from('whatsapp_instances')
      .select('id, instance_name, owner_phone, base_url, instance_token, is_active');
    const instances = ((allInst as any[]) || []).filter((r) => r?.instance_token);
    if (instances.length === 0) {
      return res.json({ success: false, error: 'No active WhatsApp instance found' });
    }

    // `instance_id` vem de profiles.default_instance_id do Cloud e pode não
    // existir no Externo — sem preferida a varredura por instância resolve.
    const preferred =
      instances.find(
        (r) =>
          (instance_id && r.id === instance_id) ||
          (instance_name &&
            String(r.instance_name || '').toLowerCase() === String(instance_name).toLowerCase()),
      ) || null;

    // --- blocklist de equipe (tudo do Externo) ---
    const blocklistKeys = new Set<string>();
    for (const inst of (allInst as any[]) || []) {
      const k = phoneMatchKey(inst.owner_phone || '');
      if (k.length >= 10) blocklistKeys.add(k);
    }
    try {
      const { data: profiles } = await ext.from('profiles').select('phone').not('phone', 'is', null);
      for (const p of (profiles as any[]) || []) {
        const k = phoneMatchKey(p.phone || '');
        if (k.length >= 10) blocklistKeys.add(k);
      }
    } catch (e) {
      console.warn('[sync-group-contacts] profiles blocklist failed:', (e as Error)?.message);
    }
    try {
      const { data: staff } = await ext
        .from('contacts')
        .select('phone')
        .in('classification', STAFF_CLASSIFICATIONS);
      for (const c of (staff as any[]) || []) {
        const k = phoneMatchKey(c.phone || '');
        if (k.length >= 10) blocklistKeys.add(k);
      }
    } catch (e) {
      console.warn('[sync-group-contacts] staff blocklist failed:', (e as Error)?.message);
    }

    // --- roster + resolução LID→telefone ---
    const info = await fetchGroupInfoAcrossInstances(instances, preferred, groupJid);
    if (info.participants.length === 0) {
      return res.json({
        success: false,
        error: 'Nenhuma instância tem acesso ao grupo.',
        tried_instances: info.tried,
      });
    }
    const lidMap = await buildLidMapFromMessages(groupJid);

    type Member = { phone: string; key: string; name: string | null };
    const byKey = new Map<string, Member>();
    let blockedCount = 0;
    let unresolvedCount = 0;
    for (const raw of info.participants) {
      const e = extractParticipant(raw);
      const fromLid = e.lid ? lidMap.get(e.lid) : undefined;
      const phone = e.phone || fromLid?.phone || '';
      const name = e.display_name || fromLid?.name || null;
      if (!phone) { unresolvedCount++; continue; }
      const key = phoneMatchKey(phone);
      if (key.length < 10) { unresolvedCount++; continue; }
      if (blocklistKeys.has(key)) { blockedCount++; continue; }
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { phone: normalizePhone(phone), key, name });
      else if (!prev.name && name) prev.name = name;
    }
    const members = Array.from(byKey.values());
    console.log(
      `[sync-group-contacts] ${groupJid}: ${info.participants.length} no roster, ` +
      `${members.length} elegíveis, ${blockedCount} equipe, ${unresolvedCount} sem telefone`,
    );

    // --- contatos existentes (Externo), imune a telefone formatado ---
    const contactsByKey = new Map<string, any>();
    if (members.length > 0) {
      const last8Set = new Set(members.map((m) => m.key.slice(-8)));
      const orFilter = Array.from(last8Set)
        .map((k) => `phone.ilike.${interleavedPattern(k)}`)
        .join(',');
      const { data: candidates, error } = await ext
        .from('contacts')
        .select('id, phone, full_name, classification')
        .or(orFilter)
        .is('deleted_at', null);
      if (error) console.warn('[sync-group-contacts] contacts lookup failed:', error.message);
      for (const c of (candidates as any[]) || []) {
        const ckey = phoneMatchKey(c.phone || '');
        if (ckey && byKey.has(ckey) && !contactsByKey.has(ckey)) contactsByKey.set(ckey, c);
      }
    }

    // --- vínculos existentes deste lead ---
    const { data: existingLinks } = await ext
      .from('contact_leads')
      .select('contact_id')
      .eq('lead_id', lead_id);
    const linkedContactIds = new Set(((existingLinks as any[]) || []).map((l) => l.contact_id));

    const results = {
      linked_existing: 0,
      already_linked: 0,
      needs_creation: [] as { phone: string; jid: string }[],
      skipped_instances: blockedCount,
    };
    const pendingNew: Member[] = [];

    for (const m of members) {
      const existing = contactsByKey.get(m.key);
      if (!existing) {
        results.needs_creation.push({ phone: m.phone, jid: `${m.phone}@s.whatsapp.net` });
        pendingNew.push(m);
        continue;
      }
      if (linkedContactIds.has(existing.id)) {
        results.already_linked++;
        continue;
      }
      const { error } = await ext
        .from('contact_leads')
        .insert({ contact_id: existing.id, lead_id });
      if (!error) {
        results.linked_existing++;
        linkedContactIds.add(existing.id);
      } else {
        console.warn(`[sync-group-contacts] link failed for ${existing.id}:`, error.message);
      }
    }

    // --- sugestões para os novos: roster > cache de chat > mensagens 1:1 ---
    const detailsNameByPhone = new Map<string, string>();
    if (pendingNew.length > 0) {
      const { data: cachedDetails } = await ext
        .from('whatsapp_chat_details_cache')
        .select('phone, name')
        .in('phone', pendingNew.map((m) => m.phone));
      for (const d of (cachedDetails as any[]) || []) {
        if (d.name && !detailsNameByPhone.has(d.phone)) detailsNameByPhone.set(d.phone, d.name);
      }
    }

    const contactSuggestions = [];
    for (const m of pendingNew) {
      // Mensagens de conversa direta: no banco o phone é só dígitos, e os 8
      // últimos dígitos do número base são sufixo literal tanto no formato de
      // 12 quanto no de 13 dígitos (o 9º dígito entra ANTES deles).
      const { data: recent } = await ext
        .from('whatsapp_messages')
        .select('contact_name, message_text, direction, instance_name, phone')
        .ilike('phone', `%${m.key.slice(-8)}`)
        .order('created_at', { ascending: false })
        .limit(60);
      const matched = ((recent as any[]) || [])
        .filter((r) => phoneMatchKey(r.phone || '') === m.key)
        .slice(0, 30);

      const nameFreq: Record<string, number> = {};
      for (const r of matched) {
        const n = r.contact_name;
        if (n && n.trim() && n !== 'unknown' && n !== m.phone) nameFreq[n] = (nameFreq[n] || 0) + 1;
      }
      const bestMsgName = Object.entries(nameFreq)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || '';

      contactSuggestions.push({
        phone: m.phone,
        suggested_name: m.name || detailsNameByPhone.get(m.phone) || bestMsgName,
        message_count: matched.length,
        instances_seen: [...new Set(matched.map((r) => r.instance_name).filter(Boolean))],
        conversation_preview: matched
          .slice(0, 15)
          .map((r) => `[${r.direction}] ${r.message_text || ''}`.substring(0, 200))
          .join('\n')
          .substring(0, 1000),
      });
    }

    return res.json({
      success: true,
      group_jid: groupJid,
      group_name: info.name,
      used_instance: info.used_instance,
      total_participants: info.participants.length,
      unresolved_count: unresolvedCount,
      results,
      contact_suggestions: contactSuggestions,
    });
  } catch (e) {
    console.error('[sync-group-contacts] error:', e);
    return res.json({ success: false, error: String((e as Error)?.message || e) });
  }
};

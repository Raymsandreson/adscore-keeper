// get-group-participants
// ============================================================
// Lista participantes de UM grupo, enriquecidos via UazAPI /chat/details.
//
// Portada da edge do Cloud (supabase/functions/get-group-participants) por dois
// motivos: (1) lá ela lia `whatsapp_instances` e `whatsapp_groups_cache` do
// Cloud, e essas tabelas vivem no Externo — quando a cópia do Cloud não tinha a
// instância, a função devolvia {success:false} e o modal ficava sem roster;
// (2) participante identificado só por `@lid` era descartado, e a conta já está
// na migração LID do WhatsApp (as mensagens chegam com sender="...@lid").
//
// Body: { group_jid, instance_name, refresh?: boolean }
// Resp: { success, participants: [...], group_name, fetched_at }
// ============================================================
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const DEFAULT_BASE = 'https://abraci.uazapi.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — vale para roster e chat/details
const CONCURRENCY = 6;
const LID_NAME_LOOKUP_LIMIT = 500; // mensagens do grupo lidas para resolver LID→telefone

interface Extracted {
  phone: string;
  lid: string;
  jid: string;
  display_name: string | null;
  is_admin: boolean;
}

function digits(s: unknown): string {
  return String(s || '').replace(/\D/g, '');
}

function firstText(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function phoneFromPhoneField(value: unknown): string {
  const d = digits(value);
  return d.length >= 8 && d.length <= 15 ? d : '';
}

// Só aceita telefone de JID que comprovadamente carrega número (@s.whatsapp.net
// ou valor solto com cara de telefone). LID nunca vira telefone — os dígitos de
// um @lid não são discáveis e já foram exibidos como telefone no passado.
function phoneFromJid(value: unknown): string {
  const s = String(value || '');
  if (!s || /@lid\b|@g\.us\b/i.test(s)) return '';
  const d = digits(s);
  if (!d) return '';
  if (/@s\.whatsapp\.net\b/i.test(s)) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return d;
  if (d.length >= 8 && d.length <= 11) return d;
  return '';
}

function extractParticipant(p: any): Extracted {
  const jid = firstText(p?.JID, p?.jid, p?.id, p?.participant, typeof p === 'string' ? p : null) || '';
  const phone =
    phoneFromPhoneField(firstText(
      p?.PhoneNumber, p?.phoneNumber, p?.Phone, p?.phone,
      p?.Number, p?.number, p?.participantPn, p?.sender_pn,
      p?.Contact?.PhoneNumber, p?.contact?.phone,
    )) || phoneFromJid(jid);
  const lidRaw = firstText(p?.LID, p?.lid, /@lid\b/i.test(jid) ? jid : null) || '';
  const display_name = firstText(
    p?.DisplayName, p?.displayName, p?.Name, p?.name,
    p?.PushName, p?.pushName, p?.ContactName, p?.contactName,
    p?.NotifyName, p?.notifyName, p?.VerifiedName, p?.verifiedName,
    p?.Contact?.Name, p?.contact?.name,
  );
  const is_admin = !!(p?.IsAdmin || p?.isAdmin || p?.admin || p?.IsSuperAdmin || p?.superAdmin);
  return { phone, lid: digits(lidRaw), jid, display_name, is_admin };
}

async function fetchGroupInfo(baseUrl: string, token: string, groupJid: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/group/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ groupjid: groupJid, force: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`uazapi /group/info ${res.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await res.json().catch(() => null);
  const participants =
    data?.Participants || data?.participants ||
    data?.group?.Participants || data?.group?.participants || [];
  const name = data?.Name || data?.name || data?.subject || null;
  return { participants: Array.isArray(participants) ? participants : [], name };
}

async function fetchChatDetails(baseUrl: string, token: string, number: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number, preview: true }),
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

function parseCommonGroups(s: unknown): Array<{ name: string; jid: string }> {
  if (!s || typeof s !== 'string') return [];
  const out: Array<{ name: string; jid: string }> = [];
  const re = /([^,(]+)\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push({ name: m[1].trim(), jid: m[2].trim() });
  return out;
}

function pickName(d: any): string | null {
  return d?.lead_fullName || d?.lead_name || d?.wa_contactName || d?.wa_name || d?.name || null;
}

async function fetchDetailsAcrossInstances(instances: any[], preferred: string, number: string) {
  const ordered = [
    ...instances.filter((i) => String(i.instance_name || '').toLowerCase() === preferred.toLowerCase()),
    ...instances.filter((i) => String(i.instance_name || '').toLowerCase() !== preferred.toLowerCase()),
  ].filter((i) => i?.instance_token);

  for (const inst of ordered) {
    const details = await fetchChatDetails(inst.base_url || DEFAULT_BASE, inst.instance_token, number);
    if (details && (pickName(details) || details?.image || details?.imagePreview || details?.lead_email || details?.common_groups)) {
      return { details, source_instance: inst.instance_name };
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null as any; }
    }
  });
  await Promise.all(workers);
  return out;
}

// Mapa LID → { phone, name } montado a partir das mensagens do próprio grupo.
// A UazAPI manda `sender_lid` junto de `sender_pn` e `senderName`, então o
// histórico já resolve o telefone real de quem o /group/info só identifica por
// LID — sem gastar chamada de API.
async function buildLidMapFromMessages(groupJid: string) {
  const chatId = groupJid.replace('@g.us', '');
  const map = new Map<string, { phone: string; name: string | null }>();
  try {
    const { data } = await ext
      .from('whatsapp_messages')
      .select('metadata')
      .eq('phone', chatId)
      .order('created_at', { ascending: false })
      .limit(LID_NAME_LOOKUP_LIMIT);

    for (const row of (data as any[]) || []) {
      const msg = row?.metadata?.message;
      if (!msg) continue;
      const lid = digits(msg.sender_lid || (String(msg.sender || '').includes('@lid') ? msg.sender : ''));
      if (!lid) continue;
      const phone = phoneFromJid(msg.sender_pn) || phoneFromPhoneField(msg.sender_pn);
      const name = firstText(msg.senderName);
      const prev = map.get(lid);
      // Primeira ocorrência ganha (mais recente); só completa o que faltar.
      if (!prev) map.set(lid, { phone, name });
      else if (!prev.phone && phone) map.set(lid, { phone, name: prev.name || name });
    }
  } catch (e) {
    console.warn('[get-group-participants] lid map from messages failed:', (e as Error)?.message);
  }
  return map;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { group_jid, instance_name, refresh } = req.body || {};
    if (!group_jid || !instance_name) {
      return res.json({ success: false, error: 'group_jid and instance_name are required' });
    }

    // --- instâncias (Externo — fonte de verdade, ver db-routing.ts) ---
    const { data: allInst } = await ext
      .from('whatsapp_instances')
      .select('instance_name, owner_phone, base_url, instance_token');
    const instances = ((allInst as any[]) || []).filter((r) => r?.instance_token);

    const instRow = instances.find(
      (r) => String(r.instance_name || '').toLowerCase() === String(instance_name).toLowerCase(),
    );
    if (!instRow) {
      return res.json({ success: false, error: `instance not found: ${instance_name}` });
    }

    const ownerKeys = new Set(
      ((allInst as any[]) || [])
        .map((r) => digits(r.owner_phone).slice(-10))
        .filter((k) => k.length >= 8),
    );

    // --- roster: cache (TTL real) ou UazAPI ---
    const { data: cacheRow } = await ext
      .from('whatsapp_groups_cache')
      .select('group_name, participants, fetched_at')
      .ilike('instance_name', instance_name)
      .eq('group_jid', group_jid)
      .maybeSingle();

    const cacheAge = cacheRow?.fetched_at ? Date.now() - new Date(cacheRow.fetched_at).getTime() : Infinity;
    const cacheUsable =
      !refresh &&
      Array.isArray(cacheRow?.participants) &&
      (cacheRow!.participants as any[]).length > 0 &&
      cacheAge < CACHE_TTL_MS;

    let rawParts: any[] = [];
    let groupName: string | null = null;
    let fetchedAt = new Date().toISOString();
    let fromCache = false;

    if (cacheUsable) {
      rawParts = cacheRow!.participants as any[];
      groupName = (cacheRow as any).group_name;
      fetchedAt = (cacheRow as any).fetched_at;
      fromCache = true;
    } else {
      const info = await fetchGroupInfo(instRow.base_url || DEFAULT_BASE, instRow.instance_token, group_jid);
      rawParts = info.participants;
      groupName = info.name;
      const { error: upErr } = await ext.from('whatsapp_groups_cache').upsert({
        instance_name: instRow.instance_name,
        group_jid,
        group_name: groupName,
        participants: rawParts,
        participants_count: rawParts.length,
        fetched_at: fetchedAt,
      }, { onConflict: 'instance_name,group_jid' });
      if (upErr) console.warn('[get-group-participants] groups_cache upsert failed:', upErr.message);
    }

    // --- extração: LID entra na lista em vez de ser descartado ---
    const lidMap = await buildLidMapFromMessages(group_jid);

    const baseList = rawParts
      .map((p) => {
        const e = extractParticipant(p);
        const fromLid = e.lid ? lidMap.get(e.lid) : undefined;
        const phone = e.phone || fromLid?.phone || '';
        const key = phone || (e.lid ? `lid:${e.lid}` : '');
        if (!key) return null; // sem telefone e sem LID não há como identificar
        return {
          key,
          phone,
          lid: e.lid || null,
          raw: e.jid || phone,
          display_name: e.display_name || fromLid?.name || null,
          is_admin: e.is_admin,
        };
      })
      .filter(Boolean) as Array<{
        key: string; phone: string; lid: string | null; raw: string;
        display_name: string | null; is_admin: boolean;
      }>;

    // Dedup: o mesmo membro pode aparecer via LID e via telefone.
    const byKey = new Map<string, (typeof baseList)[number]>();
    for (const p of baseList) {
      const prev = byKey.get(p.key);
      if (!prev) byKey.set(p.key, p);
      else byKey.set(p.key, { ...prev, ...p, display_name: prev.display_name || p.display_name, is_admin: prev.is_admin || p.is_admin });
    }

    // Chips da própria operação são marcados, não removidos: o contador do modal
    // precisa bater com o do WhatsApp, e boa parte dos membros desses grupos é
    // instância nossa. Quem separa cliente de equipe é o selo, não o filtro.
    const filtered = Array.from(byKey.values()).map((p) => {
      const k = p.phone ? p.phone.slice(-10) : '';
      return { ...p, is_team: !!(k.length >= 8 && ownerKeys.has(k)) };
    });
    const teamCount = filtered.filter((p) => p.is_team).length;

    // --- enriquecimento via /chat/details (só para quem tem telefone) ---
    // Instância nossa não precisa de enriquecimento — é chip interno, e cada
    // consulta dessas é uma chamada à UazAPI.
    const withPhone = filtered.filter((p) => p.phone && !p.is_team);
    const phones = withPhone.map((p) => p.phone);
    const cachedDetails: Record<string, any> = {};
    if (phones.length > 0) {
      const { data: cached } = await ext
        .from('whatsapp_chat_details_cache')
        .select('*')
        .ilike('instance_name', instance_name)
        .in('phone', phones);
      const cutoff = Date.now() - CACHE_TTL_MS;
      for (const c of (cached as any[]) || []) {
        if (new Date(c.fetched_at).getTime() >= cutoff) cachedDetails[c.phone] = c;
      }
    }

    const fetchTargets = refresh ? withPhone : withPhone.filter((p) => !cachedDetails[p.phone]);
    const newDetails = await mapWithConcurrency(fetchTargets, CONCURRENCY, async (p) => {
      const found = await fetchDetailsAcrossInstances(instances, instRow.instance_name, p.phone);
      const d = found?.details;
      if (!d) return null;
      const row = {
        instance_name: instRow.instance_name,
        phone: p.phone,
        name: pickName(d) || p.display_name || null,
        image: d?.image || d?.imagePreview || null,
        is_group: false,
        lead_email: d?.lead_email || null,
        lead_personalid: d?.lead_personalid || null,
        lead_name: d?.lead_name || null,
        lead_full_name: d?.lead_fullName || null,
        lead_status: d?.lead_status || null,
        lead_tags: Array.isArray(d?.lead_tags) ? d.lead_tags : null,
        lead_notes: d?.lead_notes || null,
        // Mapping fixo: 12=CPF, 13=RG, 14=Endereço, 15=Bairro, 16=CEP
        lead_field12: d?.lead_field12 || null,
        lead_field13: d?.lead_field13 || null,
        lead_field14: d?.lead_field14 || null,
        lead_field15: d?.lead_field15 || null,
        lead_field16: d?.lead_field16 || null,
        common_groups: parseCommonGroups(d?.common_groups),
        raw: { ...d, __source_instance: found?.source_instance || instRow.instance_name },
        fetched_at: new Date().toISOString(),
      };
      const { error } = await ext.from('whatsapp_chat_details_cache').upsert(row, { onConflict: 'instance_name,phone' });
      if (error) console.warn('[get-group-participants] chat_details upsert failed:', error.message);
      return row;
    });
    for (const r of newDetails.filter(Boolean) as any[]) cachedDetails[r.phone] = r;

    const participants = filtered.map((p) => {
      const d = (p.phone && cachedDetails[p.phone]) || {};
      return {
        key: p.key,
        phone: p.phone,
        raw: p.raw,
        lid: p.lid,
        is_admin: p.is_admin,
        is_team: p.is_team,
        name: d.name || p.display_name || null,
        image: d.image || null,
        lead_email: d.lead_email || null,
        lead_personalid: d.lead_personalid || null,
        lead_notes: d.lead_notes || null,
        lead_field12: d.lead_field12 || null,
        lead_field13: d.lead_field13 || null,
        lead_field14: d.lead_field14 || null,
        lead_field15: d.lead_field15 || null,
        lead_field16: d.lead_field16 || null,
        common_groups: d.common_groups || [],
        source_instance: d.raw?.__source_instance || null,
        enriched_from: d.name || d.image || d.lead_personalid ? 'chat' : null,
      };
    });

    return res.json({
      success: true,
      group_jid,
      group_name: groupName,
      fetched_at: fetchedAt,
      from_cache: fromCache,
      participants,
      team_count: teamCount,
      enriched_count: participants.filter((p) => p.name).length,
      // Quantos o /group/info trouxe mas não deram nem telefone nem LID.
      unresolved_count: rawParts.length - baseList.length,
      lid_only_count: participants.filter((p) => !p.phone).length,
    });
  } catch (e) {
    console.error('[get-group-participants] error:', e);
    return res.json({ success: false, error: String((e as Error)?.message || e) });
  }
};

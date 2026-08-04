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
import {
  fetchDetailsAcrossInstances,
  mapWithConcurrency,
  pickBestName,
  toCacheRow,
} from '../lib/uazapi-chat-details';

const DEFAULT_BASE = 'https://abraci.uazapi.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — vale para roster e chat/details
const CONCURRENCY = 6;
const LID_NAME_LOOKUP_LIMIT = 500; // mensagens do grupo lidas para resolver LID→telefone
// Teto de instâncias sondadas quando a da conversa não enxerga o grupo. Cada
// tentativa é uma chamada à UazAPI; com ~26 instâncias, varrer todas sairia caro
// para o caso (raro) de nenhuma ser membro.
const MAX_INSTANCE_PROBES = 8;

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
  // `id` pode ser objeto ({_serialized, user}) — por isso não entra direto no
  // firstText, que espera string/número.
  const jid = firstText(
    p?.JID, p?.jid,
    p?.id?._serialized, p?.id?.user,
    typeof p?.id === 'string' ? p.id : null,
    p?.participant,
    typeof p === 'string' ? p : null,
  ) || '';
  const phone =
    phoneFromPhoneField(firstText(
      p?.PhoneNumber, p?.phoneNumber, p?.Phone, p?.phone, p?.PN, p?.pn,
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

// A lista de participantes já apareceu em vários formatos nesta base. O
// recover-leads-phone-55 acumulou esses caminhos ao longo do tempo e é o que
// funciona hoje em produção — olhar só `Participants`/`participants` devolvia
// lista vazia quando a resposta vinha aninhada.
function toList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  // Algumas respostas mandam um mapa jid -> participante em vez de array.
  return raw && typeof raw === 'object' ? Object.values(raw) : [];
}

function extractParticipantList(data: any): any[] {
  // Encadear com `||` seria mais curto, mas `[]` é truthy em JS: um
  // `Participants: []` no topo interromperia a busca e esconderia a lista real
  // aninhada. Por isso: primeiro caminho que render lista NÃO VAZIA.
  const candidates = [
    data?.Participants,
    data?.participants,
    data?.data?.Participants,
    data?.data?.participants,
    data?.Group?.Participants,
    data?.group?.Participants,
    data?.group?.participants,
    data?.groupMetadata?.participants,
    data?.GroupMetadata?.Participants,
    data?.data?.groupMetadata?.participants,
    data?.data?.GroupMetadata?.Participants,
    data?.members,
    data?.data?.members,
  ];
  for (const c of candidates) {
    const list = toList(c);
    if (list.length > 0) return list;
  }
  return [];
}

function extractGroupName(data: any): string | null {
  return (
    data?.Name || data?.name || data?.subject ||
    data?.data?.Name || data?.data?.name || data?.data?.subject ||
    data?.group?.Name || data?.group?.name || data?.group?.subject ||
    null
  );
}

async function fetchGroupInfo(baseUrl: string, token: string, groupJid: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/group/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    // Mesmo corpo que o recover-leads-phone-55 usa. `groupjid` é o único campo
    // obrigatório segundo a doc do uazapiGO V2.
    body: JSON.stringify({
      groupjid: groupJid,
      getInviteLink: false,
      getRequestsParticipants: false,
      force: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`uazapi /group/info ${res.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await res.json().catch(() => null);
  const participants = extractParticipantList(data);

  // Diagnóstico sem vazar dado: só os NOMES das chaves, nunca os valores.
  // Se a lista vier vazia, é isso que diz se a resposta mudou de formato.
  console.log(
    `[get-group-participants] /group/info ${groupJid}: ` +
    `top_keys=${JSON.stringify(Object.keys(data || {}))} ` +
    `participants=${participants.length} ` +
    `participant_keys=${JSON.stringify(participants[0] ? Object.keys(participants[0]) : [])}`,
  );

  return { participants, name: extractGroupName(data) };
}

// A instância da conversa nem sempre é membro do grupo — nesse caso a UazAPI
// responde 404 ("grupo não encontrado"). get-whatsapp-group-info,
// recover-leads-phone-55 e sync-whatsapp-group-description já tratavam isso
// varrendo as instâncias ativas; este handler não, e uma instância fora do
// grupo bastava para o roster vir vazio.
async function fetchGroupInfoAcrossInstances(instances: any[], preferred: any, groupJid: string) {
  const others = instances
    .filter((i) => i.instance_name !== preferred.instance_name && i.is_active !== false)
    .slice(0, MAX_INSTANCE_PROBES);
  const tried: string[] = [];

  for (const inst of [preferred, ...others]) {
    try {
      const info = await fetchGroupInfo(inst.base_url || DEFAULT_BASE, inst.instance_token, groupJid);
      if (info.participants.length > 0) {
        return { ...info, used_instance: inst.instance_name as string, tried };
      }
      tried.push(`${inst.instance_name}: 0 participantes`);
    } catch (e) {
      tried.push(`${inst.instance_name}: ${(e as Error)?.message?.slice(0, 80)}`);
    }
  }
  console.warn(`[get-group-participants] nenhuma instância retornou roster de ${groupJid}: ${tried.join(' | ')}`);
  return { participants: [] as any[], name: null as string | null, used_instance: null, tried };
}

// O fetch/parse/cache do /chat/details vive em lib/uazapi-chat-details.ts.
// Este arquivo tinha a própria cópia, e ela carregava dois bugs: lia
// `common_groups` (o campo real é `wa_common_groups`) e gravava
// `lead_field12..16` em colunas que não existiam, o que derrubava o upsert
// inteiro e deixava o cache sem escrever desde maio.

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
      .select('instance_name, owner_phone, base_url, instance_token, is_active');
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
    let usedInstance: string | null = null;
    let triedInstances: string[] = [];

    if (cacheUsable) {
      rawParts = cacheRow!.participants as any[];
      groupName = (cacheRow as any).group_name;
      fetchedAt = (cacheRow as any).fetched_at;
      fromCache = true;
    } else {
      const info = await fetchGroupInfoAcrossInstances(instances, instRow, group_jid);
      rawParts = info.participants;
      groupName = info.name;
      usedInstance = info.used_instance;
      triedInstances = info.tried;
      // Roster vazio não vira cache: gravar [] só faria a próxima leitura
      // repetir a falha em vez de tentar de novo.
      if (rawParts.length > 0) {
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
      const found = await fetchDetailsAcrossInstances(instances, instRow.instance_name, p.phone, {
        preview: true, // listagem: imagem menor basta e economiza banda
      });
      if (!found) return null;
      // `display_name` do roster é o fallback: o /group/info às vezes traz um
      // nome que o /chat/details não tem.
      const row = {
        ...toCacheRow(instRow.instance_name, p.phone, found.details, found.source_instance),
        name: pickBestName(found.details) || p.display_name || null,
        is_group: false,
      };
      const { error } = await ext
        .from('whatsapp_chat_details_cache')
        .upsert(row as any, { onConflict: 'instance_name,phone' });
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
      used_instance: usedInstance,
      // Só preenchido quando nenhuma instância devolveu roster — diz qual falhou
      // e por quê, sem precisar abrir o log.
      tried_instances: participants.length === 0 ? triedInstances : undefined,
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

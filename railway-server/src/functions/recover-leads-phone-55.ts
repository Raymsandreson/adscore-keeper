// Recupera o telefone real de leads cujo lead_phone ficou como "55" (sem dígitos).
// Estratégia: pega o grupo do lead (leads.whatsapp_group_id ou lead_whatsapp_groups),
// primeiro cruza com outros leads já vinculados ao mesmo grupo e telefone válido.
// Se esse atalho não resolver, busca participantes via UazAPI /group/info, remove
// os números das instâncias do sistema (owner_phone de whatsapp_instances) e aplica a regra:
//   - 1 candidato sobrando -> atualiza lead_phone (a menos que dryRun)
//   - 0 ou >1            -> apenas loga em lead_enrichment_log, não toca no lead
//
// Modos:
//   - Single: { leadId: "uuid" }
//   - Lote:   { batchSize?: number (default 5, max 50) }  (sem leadId)
//
// Sempre opera em dryRun por padrão. Para escrever de verdade: { dryRun: false }.
//
// Body: { leadId?: string, batchSize?: number, dryRun?: boolean }
// Retorno 200: { success, dryRun, results: [{ lead_id, status, ...}], summary }

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const DEFAULT_BASE = 'https://abraci.uazapi.com';
const TIMEOUT_MS = 8000;
const DELAY_BETWEEN_LEADS_MS = 1500;

type ResultStatus =
  | 'recovered'
  | 'would_recover'
  | 'ambiguous'
  | 'no_candidates'
  | 'no_group'
  | 'group_fetch_failed'
  | 'lead_not_found'
  | 'already_valid'
  | 'error';

interface LeadResult {
  lead_id: string;
  status: ResultStatus;
  old_phone?: string;
  new_phone?: string;
  group_jid?: string;
  candidates?: string[];
  message?: string;
  source?: 'linked_lead' | 'group_participants';
  matched_lead_id?: string;
  matched_lead_name?: string | null;
  diagnostics?: Record<string, any>;
}

interface LinkedLeadPhoneCandidate {
  lead_id: string;
  lead_name: string | null;
  phone: string;
  source: 'leads.whatsapp_group_id' | 'lead_whatsapp_groups';
  group_jid?: string | null;
}

interface GroupFetchAttempt {
  instance_name: string;
  base_url: string;
  ok: boolean;
  http_status?: number;
  participant_count: number;
  response_keys?: string[];
  error?: string;
}

function normalize(p: any): string {
  return String(p || '').replace(/\D/g, '');
}

function normalizeGroupJid(group: any): string | null {
  const value = String(group || '').trim();
  if (!value || value.startsWith('PENDING:')) return null;
  if (value.includes('@g.us')) return value;
  const digits = normalize(value);
  return digits.length >= 10 ? `${digits}@g.us` : null;
}

function safeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return 'invalid_base_url';
  }
}

function extractParticipants(data: any): string[] {
  // UazAPI v2 documenta `Participants` com P maiúsculo.
  // Mantemos fallbacks porque algumas respostas antigas vinham minúsculas/aninhadas.
  const raw =
    data?.Participants ||
    data?.participants ||
    data?.data?.Participants ||
    data?.data?.participants ||
    data?.Group?.Participants ||
    data?.group?.participants ||
    data?.groupMetadata?.participants ||
    data?.GroupMetadata?.Participants ||
    data?.data?.groupMetadata?.participants ||
    data?.data?.GroupMetadata?.Participants ||
    data?.members ||
    data?.data?.members ||
    [];
  const out = new Set<string>();
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw ? Object.values(raw) : [];
  for (const p of list) {
    const item = p as any;
    const id =
      item?.JID ||
      item?.PhoneNumber ||
      item?.Phone ||
      item?.PN ||
      item?.LID ||
      item?.id?._serialized ||
      item?.id?.user ||
      item?.id ||
      item?.jid ||
      item?.participant ||
      item?.phone ||
      item?.number ||
      (typeof p === 'string' ? p : '');
    const digits = normalize(id);
    if (digits.length >= 10) out.add(digits);
  }
  return Array.from(out);
}

async function fetchGroupInfo(
  baseUrl: string,
  token: string,
  groupjid: string
): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({
        groupjid,
        getInviteLink: false,
        getRequestsParticipants: false,
        force: true,
      }),
      signal: ctrl.signal,
    });
    const body = await r.json().catch(async () => ({ raw: await r.text().catch(() => '') }));
    return { ok: r.ok, status: r.status, body };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch_failed' };
  } finally {
    clearTimeout(tid);
  }
}

async function getActiveInstances(): Promise<
  Array<{ instance_name: string; instance_token: string; base_url: string | null; owner_phone: string | null }>
> {
  const { data } = await ext
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url, owner_phone, is_active')
    .eq('is_active', true);
  return (data || []) as any;
}

async function getInstancePhones(): Promise<Set<string>> {
  const { data } = await ext.from('whatsapp_instances').select('owner_phone');
  const set = new Set<string>();
  for (const row of data || []) {
    const d = normalize((row as any).owner_phone);
    if (d.length >= 10) set.add(d);
  }
  return set;
}

async function getLeadGroupJid(leadId: string): Promise<{ groupJid: string | null; oldPhone: string }> {
  const { data: lead } = await ext
    .from('leads')
    .select('id, lead_phone, whatsapp_group_id')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return { groupJid: null, oldPhone: '' };
  let groupJid = normalizeGroupJid((lead as any).whatsapp_group_id);
  if (!groupJid) {
    const { data: linkRows } = await ext
      .from('lead_whatsapp_groups')
      .select('group_jid')
      .eq('lead_id', leadId)
      .limit(1);
    groupJid = normalizeGroupJid(((linkRows || [])[0] as any)?.group_jid);
  }
  return { groupJid, oldPhone: (lead as any).lead_phone || '' };
}

async function findLinkedLeadPhoneCandidates(
  leadId: string,
  groupJid: string,
  instancePhones: Set<string>
): Promise<LinkedLeadPhoneCandidate[]> {
  const groupDigits = normalize(groupJid);
  const groupVariants = Array.from(new Set([groupJid, groupDigits].filter(Boolean)));
  const byPhone = new Map<string, LinkedLeadPhoneCandidate>();

  const addLead = (row: any, source: LinkedLeadPhoneCandidate['source'], linkedGroupJid?: string | null) => {
    if (!row || row.id === leadId) return;
    const phone = normalize(row.lead_phone);
    if (phone.length < 10 || instancePhones.has(phone) || byPhone.has(phone)) return;
    byPhone.set(phone, {
      lead_id: row.id,
      lead_name: row.lead_name || null,
      phone,
      source,
      group_jid: linkedGroupJid || row.whatsapp_group_id || null,
    });
  };

  const { data: directRows } = await ext
    .from('leads')
    .select('id, lead_name, lead_phone, whatsapp_group_id')
    .in('whatsapp_group_id', groupVariants)
    .limit(20);
  for (const row of directRows || []) addLead(row, 'leads.whatsapp_group_id');

  const { data: linkRows } = await ext
    .from('lead_whatsapp_groups')
    .select('lead_id, group_jid')
    .in('group_jid', groupVariants)
    .neq('lead_id', leadId)
    .limit(20);
  const linkedIds = Array.from(new Set((linkRows || []).map((r: any) => r.lead_id).filter(Boolean)));

  if (linkedIds.length > 0) {
    const groupByLeadId = new Map((linkRows || []).map((r: any) => [r.lead_id, r.group_jid || null]));
    const { data: linkedLeads } = await ext
      .from('leads')
      .select('id, lead_name, lead_phone, whatsapp_group_id')
      .in('id', linkedIds);
    for (const row of linkedLeads || []) {
      addLead(row, 'lead_whatsapp_groups', groupByLeadId.get((row as any).id));
    }
  }

  return Array.from(byPhone.values());
}

async function logEnrichment(
  leadId: string,
  status: string,
  payload: Record<string, any>
) {
  try {
    await ext.from('lead_enrichment_log').insert({
      lead_id: leadId,
      source: 'recover-phone-55',
      status,
      details: payload,
    });
  } catch (e) {
    console.warn('[recover-leads-phone-55] log insert failed:', (e as Error)?.message);
  }
}

async function processOneLead(
  leadId: string,
  instances: Awaited<ReturnType<typeof getActiveInstances>>,
  instancePhones: Set<string>,
  dryRun: boolean
): Promise<LeadResult> {
  const { groupJid, oldPhone } = await getLeadGroupJid(leadId);

  // Sanidade: só processa leads com phone curto/vazio
  if (normalize(oldPhone).length >= 10) {
    return { lead_id: leadId, status: 'already_valid', old_phone: oldPhone };
  }

  if (!groupJid || !groupJid.includes('@g.us')) {
    await logEnrichment(leadId, 'no_group', { old_phone: oldPhone });
    return { lead_id: leadId, status: 'no_group', old_phone: oldPhone };
  }

  // Atalho seguro: se esse mesmo grupo já está vinculado a outro lead com telefone real,
  // usamos esse telefone antes de cair na lista bruta de participantes do grupo.
  // É como olhar a ficha já preenchida antes de tentar adivinhar pela sala cheia.
  const linkedCandidates = await findLinkedLeadPhoneCandidates(leadId, groupJid, instancePhones);
  if (linkedCandidates.length === 1) {
    const matched = linkedCandidates[0];
    if (dryRun) {
      return {
        lead_id: leadId,
        status: 'would_recover',
        old_phone: oldPhone,
        new_phone: matched.phone,
        group_jid: groupJid,
        candidates: [matched.phone],
        source: 'linked_lead',
        matched_lead_id: matched.lead_id,
        matched_lead_name: matched.lead_name,
        message: `Telefone encontrado em lead já vinculado ao mesmo grupo: ${matched.lead_name || matched.lead_id}`,
      };
    }

    const { error: updErr } = await ext
      .from('leads')
      .update({
        lead_phone: matched.phone,
        details: {
          recover_phone_55_snapshot: {
            old_phone: oldPhone,
            recovered_at: new Date().toISOString(),
            source_group: groupJid,
            source: 'linked_lead',
            matched_lead_id: matched.lead_id,
          },
        } as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updErr) {
      await logEnrichment(leadId, 'error', { error: updErr.message, group_jid: groupJid, source: 'linked_lead' });
      return { lead_id: leadId, status: 'error', old_phone: oldPhone, message: updErr.message };
    }

    await logEnrichment(leadId, 'recovered', {
      group_jid: groupJid,
      old_phone: oldPhone,
      new_phone: matched.phone,
      source: 'linked_lead',
      matched_lead_id: matched.lead_id,
      matched_lead_name: matched.lead_name,
    });

    return {
      lead_id: leadId,
      status: 'recovered',
      old_phone: oldPhone,
      new_phone: matched.phone,
      group_jid: groupJid,
      candidates: [matched.phone],
      source: 'linked_lead',
      matched_lead_id: matched.lead_id,
      matched_lead_name: matched.lead_name,
    };
  }

  if (linkedCandidates.length > 1) {
    await logEnrichment(leadId, 'ambiguous', {
      group_jid: groupJid,
      old_phone: oldPhone,
      candidates: linkedCandidates,
      source: 'linked_lead',
    });
    return {
      lead_id: leadId,
      status: 'ambiguous',
      old_phone: oldPhone,
      group_jid: groupJid,
      candidates: linkedCandidates.map((c) => c.phone),
      source: 'linked_lead',
      message: `${linkedCandidates.length} telefones encontrados em leads já vinculados ao mesmo grupo — revisão manual`,
      diagnostics: { linked_candidates: linkedCandidates },
    };
  }

  // Tenta cada instância ativa até alguma responder /group/info
  let participants: string[] = [];
  let usedInstance = '';
  const attempts: GroupFetchAttempt[] = [];
  for (const inst of instances) {
    const base = inst.base_url || DEFAULT_BASE;
    const info = await fetchGroupInfo(base, inst.instance_token, groupJid);
    const ps = info.body ? extractParticipants(info.body) : [];
    attempts.push({
      instance_name: inst.instance_name,
      base_url: safeBaseUrl(base),
      ok: info.ok,
      http_status: info.status,
      participant_count: ps.length,
      response_keys: info.body && typeof info.body === 'object' ? Object.keys(info.body).slice(0, 12) : undefined,
      error: info.error,
    });
    if (info.ok && ps.length > 0) {
      participants = ps;
      usedInstance = inst.instance_name;
      break;
    }
  }

  if (participants.length === 0) {
    await logEnrichment(leadId, 'group_fetch_failed', { group_jid: groupJid, old_phone: oldPhone, attempts });
    return {
      lead_id: leadId,
      status: 'group_fetch_failed',
      old_phone: oldPhone,
      group_jid: groupJid,
      message: 'Nenhuma instância retornou Participants para esse grupo.',
      diagnostics: { attempts },
    };
  }

  // Remove os números das instâncias do sistema
  const candidates = participants.filter((p) => !instancePhones.has(p));

  if (candidates.length === 0) {
    await logEnrichment(leadId, 'no_candidates', {
      group_jid: groupJid,
      old_phone: oldPhone,
      all_participants: participants,
      used_instance: usedInstance,
    });
    return { lead_id: leadId, status: 'no_candidates', old_phone: oldPhone, group_jid: groupJid };
  }

  if (candidates.length > 1) {
    await logEnrichment(leadId, 'ambiguous', {
      group_jid: groupJid,
      old_phone: oldPhone,
      candidates,
      used_instance: usedInstance,
    });
    return {
      lead_id: leadId,
      status: 'ambiguous',
      old_phone: oldPhone,
      group_jid: groupJid,
      candidates,
      message: `${candidates.length} candidatos — revisão manual`,
    };
  }

  // Exatamente 1 candidato → é o lead.
  const newPhone = candidates[0];

  if (dryRun) {
    return {
      lead_id: leadId,
      status: 'would_recover',
      old_phone: oldPhone,
      new_phone: newPhone,
      group_jid: groupJid,
      candidates,
    };
  }

  // Snapshot + update
  const { error: updErr } = await ext
    .from('leads')
    .update({
      lead_phone: newPhone,
      details: { recover_phone_55_snapshot: { old_phone: oldPhone, recovered_at: new Date().toISOString(), source_group: groupJid } } as any,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId);

  if (updErr) {
    await logEnrichment(leadId, 'error', { error: updErr.message, group_jid: groupJid });
    return { lead_id: leadId, status: 'error', old_phone: oldPhone, message: updErr.message };
  }

  await logEnrichment(leadId, 'recovered', {
    group_jid: groupJid,
    old_phone: oldPhone,
    new_phone: newPhone,
    used_instance: usedInstance,
  });

  return {
    lead_id: leadId,
    status: 'recovered',
    old_phone: oldPhone,
    new_phone: newPhone,
    group_jid: groupJid,
  };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { mode, leadId, batchSize, dryRun, page, pageSize, onlyWithGroup } = req.body || {};
    const isDry = dryRun !== false; // padrão é dryRun=true
    const size = Math.min(Math.max(Number(batchSize) || 5, 1), 50);

    // ===== Modo LIST: só lista leads candidatos com paginação, NÃO toca em nada =====
    if (mode === 'list') {
      const p = Math.max(Number(page) || 1, 1);
      const ps = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
      const from = (p - 1) * ps;
      const to = from + ps - 1;

      let query = ext
        .from('leads')
        .select('id, lead_name, lead_phone, whatsapp_group_id, created_at, lead_status, board_id', { count: 'exact' })
        .or('lead_phone.eq.55,lead_phone.is.null,lead_phone.eq.')
        .order('created_at', { ascending: false });

      if (onlyWithGroup === true) {
        query = query.not('whatsapp_group_id', 'is', null);
      } else if (onlyWithGroup === false) {
        query = query.is('whatsapp_group_id', null);
      }

      const { data: rows, count, error: listErr } = await query.range(from, to);
      if (listErr) return res.json({ success: false, error: listErr.message });

      // Filtra novamente em memória pra remover qualquer phone >=10 dígitos que escapou
      // e para alinhar o filtro visual com grupos realmente recuperáveis.
      const leads = (rows || []).filter((l: any) => {
        const hasValidGroup = !!normalizeGroupJid(l.whatsapp_group_id);
        if (normalize(l.lead_phone).length >= 10) return false;
        if (onlyWithGroup === true) return hasValidGroup;
        if (onlyWithGroup === false) return !hasValidGroup;
        return true;
      });

      return res.json({
        success: true,
        mode: 'list',
        page: p,
        pageSize: ps,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / ps),
        returned: leads.length,
        leads: leads.map((l: any) => ({
          id: l.id,
          lead_name: l.lead_name,
          lead_phone: l.lead_phone,
          has_group: !!normalizeGroupJid(l.whatsapp_group_id),
          whatsapp_group_id: normalizeGroupJid(l.whatsapp_group_id),
          lead_status: l.lead_status,
          created_at: l.created_at,
        })),
      });
    }

    const instances = await getActiveInstances();
    const instancePhones = await getInstancePhones();

    if (instances.length === 0) {
      return res.json({ success: false, error: 'nenhuma instância ativa encontrada' });
    }


    // Modo single
    if (leadId && typeof leadId === 'string') {
      const result = await processOneLead(leadId, instances, instancePhones, isDry);
      return res.json({
        success: true,
        dryRun: isDry,
        mode: 'single',
        result,
      });
    }

    // Modo lote: busca leads com lead_phone curto/vazio que tenham grupo
    const { data: candidates, error: fetchErr } = await ext
      .from('leads')
      .select('id, lead_phone, whatsapp_group_id')
      .or('lead_phone.eq.55,lead_phone.is.null,lead_phone.eq.')
      .not('whatsapp_group_id', 'is', null)
      .limit(size);

    if (fetchErr) {
      return res.json({ success: false, error: fetchErr.message });
    }

    const leads = (candidates || []).filter((l: any) => normalize(l.lead_phone).length < 10);
    const results: LeadResult[] = [];

    for (const lead of leads) {
      const r = await processOneLead(lead.id, instances, instancePhones, isDry);
      results.push(r);
      // delay anti rate-limit
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_LEADS_MS));
    }

    const summary = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      dryRun: isDry,
      mode: 'batch',
      processed: results.length,
      summary,
      results,
    });
  } catch (err: any) {
    console.error('[recover-leads-phone-55] error:', err);
    return res.json({ success: false, error: err?.message || 'Internal error' });
  }
};

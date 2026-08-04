// =============================================================================
// Responsável processual + acolhedor do caso por trás de um chat interno.
//
// Serve pro autocomplete do "@": quem cuida do caso aparece primeiro e rotulado,
// sem a pessoa precisar abrir a ficha do lead/processo pra descobrir.
//
// Fonte da verdade (Externo):
//  - responsável DO PROCESSO: lead_processes.responsible_user_id (UUID do
//    EXTERNO, remapeado pra Cloud porque o chat menciona por user_id do Cloud).
//    Cada processo do caso pode ter o seu — por isso o item traz o processo ao
//    lado do nome. Só ~10% dos processos têm esse campo preenchido hoje; quem
//    está sem cai no responsável processual do lead
//    (leads.processual_responsible_id), marcado como herdado do caso.
//  - acolhedor: leads.acolhedor — TEXTO livre ("Israel", "Edilan da silva
//    santos", às vezes o próprio e-mail). Por isso o casamento com o perfil é
//    tolerante e, quando ambíguo, o nome é mostrado sem virar menção.
//
// No chat do processo aparece só o responsável dele; no chat do lead/caso/
// conversa do WhatsApp aparecem os responsáveis de todos os processos do caso.
// =============================================================================
import { useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { ensureRemapCache, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { isWhatsAppGroupId, normalizeWhatsAppConversationPhone } from '@/lib/whatsappPhone';

export interface CaseOwnerPerson {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export type CaseOwnerRole = 'responsavel' | 'acolhedor';

export interface CaseOwner {
  /** Uma pessoa pode ser as duas coisas — nesse caso vem um item com dois papéis. */
  roles: CaseOwnerRole[];
  /** Cloud user_id — null quando o nome não casou com nenhum perfil (só informativo). */
  userId: string | null;
  name: string;
  /** De quais processos essa pessoa responde ("Seguro de vida judicial", "3 processos"). */
  detail?: string | null;
}

interface ProcessOwner {
  processId: string;
  processLabel: string;
  /** UUID do Externo do responsável — do processo ou herdado do lead. */
  responsibleExtId: string | null;
  /** true quando o processo não tem responsável próprio e usou o do lead. */
  inherited: boolean;
}

export interface RawOwners {
  leadId: string | null;
  leadName: string | null;
  /** Responsável processual do lead (fallback e rótulo "do caso"). */
  leadResponsibleExtId: string | null;
  processes: ProcessOwner[];
  /** ext_uuid → nome, para todos os responsáveis envolvidos. */
  namesByExtId: Record<string, string>;
  acolhedorText: string | null;
}

const EMPTY_RAW: RawOwners = {
  leadId: null,
  leadName: null,
  leadResponsibleExtId: null,
  processes: [],
  namesByExtId: {},
  acolhedorText: null,
};

/** Cache por entidade — reabrir o mesmo chat não refaz as queries. */
const ownersCache = new Map<string, RawOwners>();
const ownersInFlight = new Map<string, Promise<RawOwners>>();

function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tratamentos que aparecem no campo mas nunca no cadastro do perfil. */
const TITLES = new Set(['dr', 'dra', 'sr', 'sra', 'adv']);

/**
 * Casa o texto de `leads.acolhedor` com um perfil da equipe. Só aceita
 * casamento ÚNICO — dois "Maria" viram nenhum, porque marcar a pessoa errada é
 * pior do que não marcar ninguém.
 */
export function matchPersonByName(
  text: string | null | undefined,
  people: CaseOwnerPerson[],
): CaseOwnerPerson | null {
  const n = norm(text);
  if (!n) return null;

  const uniq = (list: CaseOwnerPerson[]) => (list.length === 1 ? list[0] : null);

  // 1) e-mail exato (o campo às vezes guarda o e-mail no lugar do nome)
  const byEmail = uniq(people.filter(p => norm(p.email) === n));
  if (byEmail) return byEmail;

  // 2) nome completo exato
  const byName = uniq(people.filter(p => norm(p.full_name) === n));
  if (byName) return byName;

  // 3) todos os pedaços do texto aparecem como palavras do nome do perfil.
  //    Tratamentos ("Dra. Luana Barros") não contam — o perfil é só "Luana Barros".
  const tokens = n
    .split(' ')
    .map(t => t.replace(/\.$/, ''))
    .filter(t => t.length >= 3 && !TITLES.has(t));
  if (tokens.length > 0) {
    const byTokens = uniq(
      people.filter(p => {
        const words = norm(p.full_name).split(' ');
        return tokens.every(t => words.includes(t));
      }),
    );
    if (byTokens) return byTokens;
  }

  // 4) primeiro nome (>=4 letras) contido no nome ou no e-mail — pega perfis
  //    cadastrados como "analyne.sousa71" pro acolhedor "Analyne Sousa..."
  const first = tokens[0];
  if (first && first.length >= 4) {
    const byPrefix = uniq(
      people.filter(p => norm(p.full_name).includes(first) || norm(p.email).includes(first)),
    );
    if (byPrefix) return byPrefix;
  }

  return null;
}

/**
 * Descobre o lead por trás da entidade do chat e, quando a entidade já é de um
 * processo específico (o próprio processo, ou a atividade de um), qual processo
 * interessa — aí só o responsável dele aparece.
 */
async function resolveContext(
  entityType: string,
  entityId: string,
): Promise<{ leadId: string | null; processId: string | null }> {
  const lead = (leadId: string | null) => ({ leadId, processId: null });

  const one = async (table: string, column: string, value: string) => {
    const { data } = await (db as any)
      .from(table)
      .select('lead_id')
      .eq(column, value)
      .limit(1)
      .maybeSingle();
    return (data?.lead_id as string | undefined) || null;
  };

  switch (entityType) {
    // WorkflowProgressPage abre o chat do POP com o id do próprio lead.
    case 'lead':
    case 'workflow':
      return lead(entityId);
    case 'process':
      return { leadId: await one('lead_processes', 'id', entityId), processId: entityId };
    case 'case':
      return lead(await one('legal_cases', 'id', entityId));
    case 'activity': {
      const { data } = await (db as any)
        .from('lead_activities')
        .select('lead_id, process_id')
        .eq('id', entityId)
        .maybeSingle();
      return {
        leadId: (data?.lead_id as string | undefined) || null,
        processId: (data?.process_id as string | undefined) || null,
      };
    }
    case 'contact':
      return lead(await one('contact_leads', 'contact_id', entityId));
    case 'whatsapp': {
      if (isWhatsAppGroupId(entityId)) {
        // group_jid ora é bare, ora tem @g.us — tentar as duas formas.
        const bare = normalizeWhatsAppConversationPhone(entityId);
        const { data: link } = await (db as any)
          .from('lead_whatsapp_groups')
          .select('lead_id')
          .in('group_jid', [entityId, bare, `${bare}@g.us`])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (link?.lead_id) return lead(link.lead_id as string);

        const { data: byField } = await (db as any)
          .from('leads')
          .select('id')
          .in('whatsapp_group_id', [entityId, bare, `${bare}@g.us`])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return lead((byField?.id as string | undefined) || null);
      }
      const phone = normalizeWhatsAppConversationPhone(entityId).replace(/\D/g, '');
      if (phone.length < 8) return lead(null);
      const last8 = phone.slice(-8);
      const { data: byPhone } = await (db as any)
        .from('leads')
        .select('id')
        .or(`lead_phone.eq.${phone},lead_phone.ilike.%${last8}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return lead((byPhone?.id as string | undefined) || null);
    }
    default:
      return lead(null);
  }
}

/** Rótulo curto do processo: título limpo, senão o número, senão o tipo. */
function processLabelOf(p: { title?: string | null; process_number?: string | null; process_type?: string | null }): string {
  const title = (p.title || '').replace(/^[\s-–—]+/, '').trim();
  if (title) return title;
  if (p.process_number) return p.process_number;
  return p.process_type === 'administrativo' ? 'Processo administrativo' : 'Processo';
}

async function fetchOwners(entityType: string, entityId: string): Promise<RawOwners> {
  await ensureExternalSession();
  const { leadId, processId } = await resolveContext(entityType, entityId);
  if (!leadId) return EMPTY_RAW;

  const [{ data: lead }, { data: procs }] = await Promise.all([
    (db as any)
      .from('leads')
      .select('id, lead_name, processual_responsible_id, acolhedor')
      .eq('id', leadId)
      .maybeSingle(),
    (db as any)
      .from('lead_processes')
      .select('id, title, process_number, process_type, responsible_user_id, created_at')
      .eq('lead_id', leadId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(30),
  ]);
  if (!lead) return EMPTY_RAW;

  const leadResponsibleExtId = (lead.processual_responsible_id as string | null) || null;

  // Chat de um processo específico (ou da atividade dele): só aquele processo.
  const rows = ((procs || []) as any[]).filter(p => !processId || p.id === processId);

  const processes: ProcessOwner[] = rows.map(p => ({
    processId: p.id as string,
    processLabel: processLabelOf(p),
    responsibleExtId: (p.responsible_user_id as string | null) || leadResponsibleExtId,
    inherited: !p.responsible_user_id && !!leadResponsibleExtId,
  })).filter(p => !!p.responsibleExtId);

  const extIds = Array.from(new Set([
    ...processes.map(p => p.responsibleExtId as string),
    ...(leadResponsibleExtId ? [leadResponsibleExtId] : []),
  ]));

  const namesByExtId: Record<string, string> = {};
  if (extIds.length > 0) {
    await ensureRemapCache();
    const { data: profs } = await (db as any)
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', extIds);
    for (const p of ((profs || []) as any[])) {
      namesByExtId[p.user_id] = p.full_name || p.email || '';
    }
  }

  return {
    leadId,
    leadName: lead.lead_name || null,
    leadResponsibleExtId,
    processes,
    namesByExtId,
    acolhedorText: lead.acolhedor || null,
  };
}

/**
 * Monta a lista exibida: um item por responsável (com os processos dele ao
 * lado) e o acolhedor por último. Pura, para poder ser testada sem banco.
 */
export function buildCaseOwners(raw: RawOwners, people: CaseOwnerPerson[]): CaseOwner[] {
  const owners: CaseOwner[] = [];

  // Quando o caso inteiro é da mesma pessoa, vira um item só — repetir três
  // vezes o mesmo nome não ajuda ninguém.
  const byExtId = new Map<string, ProcessOwner[]>();
  for (const p of raw.processes) {
    const ext = p.responsibleExtId as string;
    const list = byExtId.get(ext);
    if (list) list.push(p); else byExtId.set(ext, [p]);
  }

  // Caso sem nenhum processo cadastrado: mostra o responsável processual do lead.
  if (byExtId.size === 0 && raw.leadResponsibleExtId) {
    byExtId.set(raw.leadResponsibleExtId, []);
  }

  for (const [extId, procs] of byExtId) {
    const cloudId = remapToCloudSync(extId);
    const fromList = cloudId ? people.find(p => p.user_id === cloudId) : null;
    const name = fromList?.full_name || raw.namesByExtId[extId] || fromList?.email || null;
    if (!name) continue;

    const allInherited = procs.length > 0 && procs.every(p => p.inherited);
    const detail =
      procs.length === 0
        ? 'responsável do caso'
        : procs.length === 1
          ? `${procs[0].processLabel}${procs[0].inherited ? ' · herdado do caso' : ''}`
          : `${procs.length} processos${allInherited ? ' · herdado do caso' : ''}`;

    owners.push({
      roles: ['responsavel'],
      // Sem perfil correspondente no Cloud a menção não notificaria ninguém.
      userId: fromList ? fromList.user_id : null,
      name,
      detail,
    });
  }

  if (raw.acolhedorText) {
    const hit = matchPersonByName(raw.acolhedorText, people);
    const userId = hit?.user_id || null;
    const already = userId ? owners.find(o => o.userId === userId) : null;
    if (already) {
      already.roles = [...already.roles, 'acolhedor'];
    } else {
      owners.push({
        roles: ['acolhedor'],
        userId,
        name: hit?.full_name || hit?.email || raw.acolhedorText,
      });
    }
  }

  return owners;
}

/**
 * Responsável de cada processo do caso + acolhedor, já resolvidos para user_id
 * do Cloud (o mesmo usado nas menções). Ordem: responsáveis → acolhedor; quando
 * são a mesma pessoa, vem um item só com os dois papéis.
 */
export function useCaseOwners(entityType: string, entityId: string, people: CaseOwnerPerson[]) {
  const key = `${entityType}:${entityId}`;
  const [raw, setRaw] = useState<RawOwners>(() => ownersCache.get(key) || EMPTY_RAW);

  useEffect(() => {
    const cached = ownersCache.get(key);
    if (cached) {
      setRaw(cached);
      return;
    }
    setRaw(EMPTY_RAW);

    let alive = true;
    let promise = ownersInFlight.get(key);
    if (!promise) {
      promise = fetchOwners(entityType, entityId)
        .then(result => {
          ownersCache.set(key, result);
          return result;
        })
        .catch(err => {
          console.warn('[useCaseOwners] falha ao resolver responsável/acolhedor:', err);
          return EMPTY_RAW;
        })
        .finally(() => { ownersInFlight.delete(key); });
      ownersInFlight.set(key, promise);
    }
    promise.then(result => { if (alive) setRaw(result); });

    return () => { alive = false; };
  }, [key, entityType, entityId]);

  const owners = buildCaseOwners(raw, people);

  return { owners, leadId: raw.leadId, leadName: raw.leadName };
}

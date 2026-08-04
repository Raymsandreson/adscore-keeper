// =============================================================================
// Responsável processual + acolhedor do caso por trás de um chat interno.
//
// Serve pro autocomplete do "@": quem cuida do caso aparece primeiro e rotulado,
// sem a pessoa precisar abrir a ficha do lead/processo pra descobrir.
//
// Fonte da verdade (Externo):
//  - responsável processual: leads.processual_responsible_id (UUID do EXTERNO,
//    remapeado pra Cloud porque o chat menciona por user_id do Cloud)
//  - acolhedor: leads.acolhedor — TEXTO livre ("Israel", "Edilan da silva
//    santos", às vezes o próprio e-mail). Por isso o casamento com o perfil é
//    tolerante e, quando ambíguo, o nome é mostrado sem virar menção.
//
// Processo/caso/atividade/conversa herdam do lead (não têm responsável próprio
// preenchido — responsible_user_id/assigned_to estão vazios na base).
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
}

interface RawOwners {
  leadId: string | null;
  leadName: string | null;
  responsibleCloudId: string | null;
  responsibleName: string | null;
  acolhedorText: string | null;
}

const EMPTY_RAW: RawOwners = {
  leadId: null,
  leadName: null,
  responsibleCloudId: null,
  responsibleName: null,
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

/** Descobre o lead por trás da entidade do chat. */
async function resolveLeadId(entityType: string, entityId: string): Promise<string | null> {
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
      return entityId;
    case 'process':
      return one('lead_processes', 'id', entityId);
    case 'case':
      return one('legal_cases', 'id', entityId);
    case 'activity':
      return one('lead_activities', 'id', entityId);
    case 'contact':
      return one('contact_leads', 'contact_id', entityId);
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
        if (link?.lead_id) return link.lead_id as string;

        const { data: byField } = await (db as any)
          .from('leads')
          .select('id')
          .in('whatsapp_group_id', [entityId, bare, `${bare}@g.us`])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return (byField?.id as string | undefined) || null;
      }
      const phone = normalizeWhatsAppConversationPhone(entityId).replace(/\D/g, '');
      if (phone.length < 8) return null;
      const last8 = phone.slice(-8);
      const { data: byPhone } = await (db as any)
        .from('leads')
        .select('id')
        .or(`lead_phone.eq.${phone},lead_phone.ilike.%${last8}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (byPhone?.id as string | undefined) || null;
    }
    default:
      return null;
  }
}

async function fetchOwners(entityType: string, entityId: string): Promise<RawOwners> {
  await ensureExternalSession();
  const leadId = await resolveLeadId(entityType, entityId);
  if (!leadId) return EMPTY_RAW;

  const { data: lead } = await (db as any)
    .from('leads')
    .select('id, lead_name, processual_responsible_id, acolhedor')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return EMPTY_RAW;

  let responsibleCloudId: string | null = null;
  let responsibleName: string | null = null;

  if (lead.processual_responsible_id) {
    await ensureRemapCache();
    responsibleCloudId = remapToCloudSync(lead.processual_responsible_id);
    const { data: prof } = await (db as any)
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', lead.processual_responsible_id)
      .maybeSingle();
    responsibleName = prof?.full_name || prof?.email || null;
  }

  return {
    leadId,
    leadName: lead.lead_name || null,
    responsibleCloudId,
    responsibleName,
    acolhedorText: lead.acolhedor || null,
  };
}

/**
 * Responsável processual e acolhedor do caso por trás do chat, já resolvidos
 * para user_id do Cloud (o mesmo usado nas menções). Retorna na ordem
 * responsável → acolhedor; quando são a mesma pessoa, vem um item só com os
 * dois papéis.
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

  const owners: CaseOwner[] = [];

  if (raw.responsibleCloudId || raw.responsibleName) {
    const fromList = raw.responsibleCloudId
      ? people.find(p => p.user_id === raw.responsibleCloudId)
      : null;
    const name = fromList?.full_name || raw.responsibleName || fromList?.email || null;
    if (name) {
      owners.push({
        roles: ['responsavel'],
        // Sem perfil correspondente no Cloud a menção não notificaria ninguém.
        userId: fromList ? fromList.user_id : null,
        name,
      });
    }
  }

  if (raw.acolhedorText) {
    const hit = matchPersonByName(raw.acolhedorText, people);
    const userId = hit?.user_id || null;
    const already = userId ? owners.find(o => o.userId === userId) : null;
    if (already) {
      already.roles = ['responsavel', 'acolhedor'];
    } else {
      owners.push({
        roles: ['acolhedor'],
        userId,
        name: hit?.full_name || hit?.email || raw.acolhedorText,
      });
    }
  }

  return { owners, leadId: raw.leadId, leadName: raw.leadName };
}

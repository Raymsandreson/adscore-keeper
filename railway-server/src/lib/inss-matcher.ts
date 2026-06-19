import { supabase } from './supabase';

/**
 * Robô casamenteiro de processos INSS órfãos.
 *
 * Metáfora: é o detetive que recebe uma carta sem destinatário e tenta
 * descobrir o dono usando 6 pistas, em ordem do mais forte pro mais fraco:
 *   0) processo já cadastrado com aquele nº
 *   1) custom field "Nº Requerimento INSS"
 *   2) título de atividade contém o nº (ou o prefixo "PREV 690" bate com lead)
 *   3) CPF do segurado = leads.cpf
 *   4) CPF do segurado = contacts.cpf → lead vinculado
 *   5) nome do segurado = lead_name/victim_name
 *
 * Usado pelo gmail-inss-sync (na hora que o e-mail chega) e pelo
 * match-inss-orphans (varredura periódica / botão manual).
 */

export const INSS_REQUERIMENTO_FIELD_ID = '111f9a38-98c3-4f83-9095-5c469106a7bf';

export type MatchSource =
  | 'process_number'
  | 'benefit_number'
  | 'custom_field'
  | 'activity_title'
  | 'cpf_lead'
  | 'cpf_contact'
  | 'name_lead';

export interface MatchInput {
  requerimento?: string | null;
  cpf?: string | null;
  nome?: string | null;
  beneficio_num?: string | null;
}

export interface MatchResult {
  leadId: string | null;
  caseId: string | null;
  source: MatchSource | null;
}

export async function findInssOrphanMatch(input: MatchInput): Promise<MatchResult> {
  const requerimento = String(input.requerimento || '');
  const reqDigits = requerimento.replace(/\D/g, '');
  const cpfDigits = String(input.cpf || '').replace(/\D/g, '');
  const nome = String(input.nome || '').trim();
  const nbDigits = String(input.beneficio_num || '').replace(/\D/g, '');

  let leadId: string | null = null;
  let caseId: string | null = null;
  let source: MatchSource | null = null;

  // 0) processo/caso já cadastrado com o nº do requerimento
  if (reqDigits) {
    const { data: proc } = await supabase
      .from('lead_processes')
      .select('lead_id, case_id')
      .or(`process_number.ilike.%${reqDigits}%,title.ilike.%${reqDigits}%`)
      .not('case_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proc?.case_id || proc?.lead_id) {
      leadId = (proc as any).lead_id || null;
      caseId = (proc as any).case_id || null;
      source = 'process_number';
    }
  }

  // 0b) nº do BENEFÍCIO (NB) — bate em lead_processes.process_number/title,
  // descrição ou em lead_custom_field_values. NB é tão único quanto requerimento
  // e aparece em e-mails de cessação/revisão/etc onde o requerimento muda mas
  // o benefício é o mesmo.
  if (!leadId && nbDigits && nbDigits.length >= 6) {
    const { data: procByNb } = await supabase
      .from('lead_processes')
      .select('lead_id, case_id')
      .or(`process_number.ilike.%${nbDigits}%,title.ilike.%${nbDigits}%,description.ilike.%${nbDigits}%`)
      .not('case_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (procByNb?.case_id || procByNb?.lead_id) {
      leadId = (procByNb as any).lead_id || null;
      caseId = (procByNb as any).case_id || null;
      source = 'benefit_number';
    }
    if (!leadId) {
      const { data: cfvNb } = await supabase
        .from('lead_custom_field_values')
        .select('lead_id')
        .ilike('value_text', `%${nbDigits}%`)
        .limit(1)
        .maybeSingle();
      if (cfvNb?.lead_id) {
        leadId = cfvNb.lead_id;
        source = 'benefit_number';
      }
    }
  }


  // 1) custom field "Nº Requerimento INSS"
  if (!leadId && requerimento) {
    const { data: cfv } = await supabase
      .from('lead_custom_field_values')
      .select('lead_id')
      .eq('field_id', INSS_REQUERIMENTO_FIELD_ID)
      .eq('value_text', requerimento)
      .limit(1)
      .maybeSingle();
    if (cfv?.lead_id) {
      leadId = cfv.lead_id;
      source = 'custom_field';
    }
  }

  // 2) título de atividade contém o nº — ou o prefixo "PALAVRA NUM" bate com lead
  if (!leadId && !caseId && reqDigits) {
    const { data: acts } = await supabase
      .from('lead_activities')
      .select('lead_id, case_id, title')
      .ilike('title', `%${reqDigits}%`)
      .order('created_at', { ascending: false })
      .limit(5);
    for (const act of acts || []) {
      if ((act as any)?.lead_id || (act as any)?.case_id) {
        leadId = (act as any).lead_id || null;
        caseId = (act as any).case_id || null;
        source = 'activity_title';
        break;
      }
      const m = String((act as any)?.title || '').match(/([A-Za-zÀ-ÿ]{2,}\s*\d{1,6})/);
      const prefix = m?.[1]?.trim();
      if (!prefix) continue;
      const { data: leadByPrefix } = await supabase
        .from('leads')
        .select('id')
        .ilike('lead_name', `${prefix}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (leadByPrefix?.id) {
        leadId = leadByPrefix.id;
        source = 'activity_title';
        break;
      }
    }
  }

  // 3) CPF do segurado bate com leads.cpf
  if (!leadId && cpfDigits.length === 11) {
    const { data: leadByCpf } = await supabase
      .from('leads')
      .select('id')
      .eq('cpf', cpfDigits)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadByCpf?.id) {
      leadId = leadByCpf.id;
      source = 'cpf_lead';
    }
  }

  // 4) CPF do segurado bate com contato → pega lead vinculado
  if (!leadId && cpfDigits.length === 11) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('cpf', cpfDigits)
      .limit(1)
      .maybeSingle();
    if (contact?.id) {
      const { data: cl } = await supabase
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cl?.lead_id) {
        leadId = cl.lead_id;
        source = 'cpf_contact';
      }
    }
  }

  // 5) nome do segurado bate com lead_name/victim_name
  if (!leadId && nome.length >= 6) {
    const { data: leadByName } = await supabase
      .from('leads')
      .select('id')
      .or(`lead_name.ilike.${nome},victim_name.ilike.${nome}`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadByName?.id) {
      leadId = leadByName.id;
      source = 'name_lead';
    }
  }

  // Caso só tenha caseId, busca o lead_id pelo case
  if (!leadId && caseId) {
    const { data: c } = await supabase
      .from('legal_cases')
      .select('lead_id')
      .eq('id', caseId)
      .maybeSingle();
    leadId = c?.lead_id || null;
  }

  return { leadId, caseId, source };
}

/**
 * Aplica o match: atualiza inss_admin_processes, garante o custom field e
 * busca um legal_case se ainda não tiver. Retorna o caseId final (pode ser null).
 */
export async function applyInssMatch(params: {
  processId: string;
  requerimento: string;
  match: MatchResult;
}): Promise<{ leadId: string | null; caseId: string | null }> {
  const { processId, requerimento } = params;
  let { leadId, caseId, source } = params.match;

  if (!leadId && !caseId) return { leadId: null, caseId: null };

  if (source && source !== 'custom_field' && leadId) {
    await supabase
      .from('lead_custom_field_values')
      .upsert(
        { lead_id: leadId, field_id: INSS_REQUERIMENTO_FIELD_ID, value_text: requerimento },
        { onConflict: 'lead_id,field_id' },
      );
  }

  if (!caseId && leadId) {
    const { data: legalCase } = await supabase
      .from('legal_cases')
      .select('id')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    caseId = legalCase?.id || null;
  }

  await supabase
    .from('inss_admin_processes')
    .update({
      lead_id: leadId,
      case_id: caseId,
      linked_at: new Date().toISOString(),
    })
    .eq('id', processId);

  return { leadId, caseId };
}

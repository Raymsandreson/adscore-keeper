import { supabase } from '@/integrations/supabase/client';

export type PartyRole = 'autor' | 'reu' | 'testemunha' | 'advogado' | 'dependente' | 'perito' | 'outro';

export interface EscavadorEnvolvido {
  nome: string;
  nome_normalizado?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: string; // FISICA | JURIDICA
  tipo?: string; // APELANTE, RECLAMANTE, ADVOGADO, etc.
  tipo_normalizado?: string;
  tipo_participacao?: string; // legacy field
  polo?: string; // ATIVO, PASSIVO, ADVOGADO, NENHUM
  quantidade_processos?: number;
  oabs?: Array<{ uf: string; tipo: string; numero: number }>;
  advogados?: EscavadorEnvolvido[];
}

interface InternalLawyer {
  oab_number: string;
  oab_uf: string;
  full_name: string;
}

/**
 * Fetches all internal lawyers (users with OAB registered in their profiles).
 */
const fetchInternalLawyers = async (): Promise<InternalLawyer[]> => {
  const { data } = await supabase
    .from('profiles')
    .select('oab_number, oab_uf, full_name')
    .not('oab_number', 'is', null);
  return ((data || []) as any[]).filter(p => p.oab_number?.trim());
};

/**
 * Checks if an envolvido's OAB matches any internal lawyer.
 */
const isInternalLawyer = (env: EscavadorEnvolvido, internalLawyers: InternalLawyer[]): boolean => {
  if (!env.oabs?.length) return false;
  return env.oabs.some(oab =>
    internalLawyers.some(il =>
      il.oab_number?.trim() === String(oab.numero).trim() &&
      il.oab_uf?.toUpperCase() === oab.uf?.toUpperCase()
    )
  );
};

/**
 * Maps Escavador participation type and polo to our internal PartyRole.
 */
export const mapParticipationToRole = (env: EscavadorEnvolvido): PartyRole => {
  const tipo = (env.tipo || env.tipo_participacao || env.tipo_normalizado || '').toLowerCase();
  const polo = (env.polo || '').toUpperCase();

  if (tipo.includes('advogad') || polo === 'ADVOGADO') return 'advogado';
  if (tipo.includes('autor') || tipo.includes('reclamante') || tipo.includes('requerente') || tipo.includes('exequente') || tipo.includes('apelante') || polo === 'ATIVO') return 'autor';
  if (tipo.includes('réu') || tipo.includes('reu') || tipo.includes('reclamad') || tipo.includes('requerid') || tipo.includes('executad') || tipo.includes('apelad') || polo === 'PASSIVO') return 'reu';
  if (tipo.includes('testemunha')) return 'testemunha';
  if (tipo.includes('perit')) return 'perito';
  return 'outro';
};

/**
 * Format CPF string (11 digits) to XXX.XXX.XXX-XX
 */
const formatCpf = (cpf: string): string => {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length === 11 && clean !== '00000000000') {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return '';
};

/**
 * Format CNPJ string (14 digits) to XX.XXX.XXX/XXXX-XX
 */
const formatCnpj = (cnpj: string): string => {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length === 14 && clean !== '00000000000000') {
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return '';
};

/**
 * Build a notes string with all available Escavador metadata.
 */
const buildContactNotes = (env: EscavadorEnvolvido): string => {
  const parts: string[] = [];
  parts.push(`Cadastrado via Escavador`);
  
  const tipoLabel = env.tipo_normalizado || env.tipo || env.tipo_participacao || 'envolvido';
  parts.push(`Participação: ${tipoLabel}`);
  
  if (env.polo && env.polo !== 'NENHUM') {
    parts.push(`Polo: ${env.polo}`);
  }
  
  if (env.tipo_pessoa) {
    parts.push(`Tipo: ${env.tipo_pessoa === 'FISICA' ? 'Pessoa Física' : 'Pessoa Jurídica'}`);
  }

  if (env.oabs?.length) {
    const oabStr = env.oabs.map(o => `OAB ${o.uf} ${o.numero}`).join(', ');
    parts.push(oabStr);
  }

  if (env.quantidade_processos && env.quantidade_processos > 1) {
    parts.push(`${env.quantidade_processos} processos no Escavador`);
  }

  return parts.join(' | ');
};

/**
 * Extracts a document (CPF/CNPJ) from the envolvido, formatted.
 */
const extractDocument = (env: EscavadorEnvolvido): string | null => {
  const rawCpf = env.cpf?.replace(/\D/g, '') || '';
  if (rawCpf.length === 11 && rawCpf !== '00000000000') {
    return formatCpf(rawCpf);
  }
  const rawCnpj = (env as any).cnpj?.replace(/\D/g, '') || '';
  if (rawCnpj.length === 14 && rawCnpj !== '00000000000000') {
    return formatCnpj(rawCnpj);
  }
  return null;
};

/**
 * Determines the classification for a contact based on Escavador data.
 * - Internal lawyers (OAB matches profile) → "advogado_interno"
 * - External lawyers with OAB → "advogado_externo"
 * - Pessoa Jurídica → "Empresa" (kept as legacy for empresa)
 * - Everyone else → "parte_contraria"
 */
const determineClassification = (env: EscavadorEnvolvido, internalLawyers: InternalLawyer[]): string => {
  const role = mapParticipationToRole(env);
  if (role === 'advogado' || env.oabs?.length) {
    if (isInternalLawyer(env, internalLawyers)) return 'advogado_interno';
    return 'advogado_externo';
  }
  if (env.tipo_pessoa === 'JURIDICA') return 'parte_contraria';
  return 'parte_contraria';
};

/**
 * Creates or finds a contact for an envolvido and links as process party.
 * Returns true if a party was created.
 */
const createContactAndParty = async (
  processId: string,
  env: EscavadorEnvolvido,
  internalLawyers: InternalLawyer[],
  userId?: string
): Promise<boolean> => {
  if (!env.nome?.trim()) return false;

  const contactName = (env.nome_normalizado || env.nome).trim();
  const classification = determineClassification(env, internalLawyers);
  
  // Check existing contact by name
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, notes, classification')
    .ilike('full_name', contactName)
    .limit(1);

  let contactId: string;
  const document = extractDocument(env);
  const notes = buildContactNotes(env);

  if (existingContacts && existingContacts.length > 0) {
    contactId = existingContacts[0].id;
    
    // Update existing contact with new data
    const updates: Record<string, any> = {};
    if (document) {
      const existingNotes = existingContacts[0].notes || '';
      if (!existingNotes.includes(document)) {
        updates.notes = existingNotes 
          ? `${existingNotes}\nDoc: ${document}` 
          : `Doc: ${document}`;
      }
    }
    // Update classification if not already set
    if (!existingContacts[0].classification) {
      updates.classification = classification;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('contacts').update(updates).eq('id', contactId);
    }
  } else {
    // Build new contact data
    const contactData: Record<string, any> = {
      full_name: contactName,
      notes: document ? `${notes}\nDoc: ${document}` : notes,
      created_by: userId || null,
      classification,
    };

    // If advogado with OAB, add to profession
    if (env.oabs?.length || mapParticipationToRole(env) === 'advogado') {
      contactData.profession = 'Advogado(a)';
    }

    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert(contactData as any)
      .select('id')
      .single();

    if (contactError || !newContact) {
      console.error('Error creating contact:', contactError);
      return false;
    }
    contactId = newContact.id;
  }

  // Create process_party link
  const role = mapParticipationToRole(env);
  const tipoLabel = env.tipo_normalizado || env.tipo || env.tipo_participacao || null;
  const { error: partyError } = await supabase
    .from('process_parties')
    .insert({
      process_id: processId,
      contact_id: contactId,
      role,
      notes: tipoLabel,
    } as any);

  if (partyError) {
    if (partyError.code !== '23505') {
      console.error('Error creating party:', partyError);
    }
    return false;
  }
  return true;
};

/**
 * Processes all envolvidos (including nested advogados) from Escavador
 * and creates contacts + process parties.
 */
export const autoCreatePartiesFromEnvolvidos = async (
  processId: string,
  envolvidos: EscavadorEnvolvido[],
  userId?: string
): Promise<number> => {
  let partiesCreated = 0;

  // Fetch internal lawyers once for comparison
  const internalLawyers = await fetchInternalLawyers();

  for (const env of envolvidos) {
    // Create the main envolvido
    const created = await createContactAndParty(processId, env, internalLawyers, userId);
    if (created) partiesCreated++;

    // Also create nested advogados
    if (env.advogados?.length) {
      for (const adv of env.advogados) {
        if (!adv.nome?.trim()) continue;
        const advCreated = await createContactAndParty(processId, {
          ...adv,
          tipo: adv.tipo || 'ADVOGADO',
          polo: adv.polo || 'ADVOGADO',
        }, internalLawyers, userId);
        if (advCreated) partiesCreated++;
      }
    }
  }

  console.log(`Auto-created ${partiesCreated} parties from ${envolvidos.length} envolvidos for process ${processId}`);
  return partiesCreated;
};

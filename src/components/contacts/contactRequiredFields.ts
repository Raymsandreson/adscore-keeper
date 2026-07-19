// Regra única de campos obrigatórios do contato.
// Usada tanto na validação dos formulários (CreateContactDialog, ContactDetailSheet)
// quanto na sinalização de "cadastro incompleto" na lista de contatos.
//
// Decisão do produto (jul/2026): um contato só é considerado completo quando tem
// estado, cidade, bairro, profissão, relacionamento (classification) e rede social
// (Instagram). Contatos auto-criados pelo webhook do WhatsApp nascem sem esses
// campos e devem aparecer sinalizados para que o dono da instância os complete.

export interface ContactCompletenessInput {
  state?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  profession?: string | null;
  classification?: string | null;
  classifications?: string[] | null;
  instagram_username?: string | null;
}

export interface RequiredFieldStatus {
  label: string;
  filled: boolean;
}

const hasText = (v?: string | null): boolean => !!(v && String(v).trim());

// Relacionamento aceita tanto o campo legado `classification` (string única)
// quanto o novo `classifications` (array), pois cada tela usa um deles.
function hasRelationship(c: ContactCompletenessInput): boolean {
  return hasText(c.classification) || !!(c.classifications && c.classifications.length > 0);
}

export function getRequiredFieldStatuses(c: ContactCompletenessInput): RequiredFieldStatus[] {
  return [
    { label: 'Estado', filled: hasText(c.state) },
    { label: 'Cidade', filled: hasText(c.city) },
    { label: 'Bairro', filled: hasText(c.neighborhood) },
    { label: 'Profissão', filled: hasText(c.profession) },
    { label: 'Relacionamento', filled: hasRelationship(c) },
    { label: 'Rede social (Instagram)', filled: hasText(c.instagram_username) },
  ];
}

/** Lista dos rótulos dos campos obrigatórios que ainda estão vazios. */
export function getMissingRequiredContactFields(c: ContactCompletenessInput): string[] {
  return getRequiredFieldStatuses(c).filter(f => !f.filled).map(f => f.label);
}

/** True quando falta pelo menos um campo obrigatório. */
export function isContactIncomplete(c: ContactCompletenessInput): boolean {
  return getRequiredFieldStatuses(c).some(f => !f.filled);
}

/**
 * Generates a lead name following the standard pattern:
 * Cidade/Estado | Vítima x Empresa | (Data do Acidente) - Lesão
 */

interface LeadNameData {
  city?: string | null;
  state?: string | null;
  victim_name?: string | null;
  main_company?: string | null;
  contractor_company?: string | null;
  accident_date?: string | null;
  damage_description?: string | null;
  case_type?: string | null;
}

export function generateLeadName(data: LeadNameData, fallback?: string): string {
  const parts: string[] = [];

  // Part 1: Cidade/Estado
  const city = data.city?.trim();
  const state = data.state?.trim();
  if (city || state) {
    if (city && state) {
      parts.push(`${city}/${state}`);
    } else {
      parts.push(city || state || '');
    }
  }

  // Part 2: Vítima x Empresa
  const victim = data.victim_name?.trim();
  const company = (data.main_company || data.contractor_company)?.trim();
  if (victim || company) {
    if (victim && company) {
      parts.push(`${victim} x ${company}`);
    } else {
      parts.push(victim || company || '');
    }
  }

  // Part 3: (Data do Acidente) - Lesão
  let datePart = '';
  if (data.accident_date) {
    try {
      const d = new Date(data.accident_date);
      if (!isNaN(d.getTime())) {
        datePart = `(${d.toLocaleDateString('pt-BR')})`;
      }
    } catch {
      // ignore invalid dates
    }
  }
  const injury = (data.damage_description || data.case_type)?.trim();

  if (datePart || injury) {
    if (datePart && injury) {
      parts.push(`${datePart} - ${injury}`);
    } else {
      parts.push(datePart || injury || '');
    }
  }

  return parts.length > 0 ? parts.join(' | ') : (fallback || '');
}

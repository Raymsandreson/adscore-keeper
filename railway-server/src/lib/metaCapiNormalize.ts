// Normalização e hash dos dados de correspondência da Meta CAPI.
//
// Separado de `metaCapi.ts` de propósito: aqui não há banco nem rede, só
// funções puras. É o pedaço que decide se a Meta consegue casar o evento com
// uma pessoa — e um erro aqui não aparece em lugar nenhum: a Meta aceita o
// evento, responde 200, e simplesmente não atribui a conversão a ninguém.
// Por isso este arquivo tem teste.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
import crypto from 'node:crypto';

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/**
 * E.164 brasileiro (só dígitos, com DDI 55). Idempotente.
 * A Meta espera o código do país; sem ele o hash não bate e a correspondência
 * cai. Formato desconhecido passa intacto em vez de virar lixo.
 */
export function toE164BR(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/** Nome conforme a Meta: minúsculas, sem dígitos nem pontuação. Acento permanece. */
export function normalizaNome(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function emailValido(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((raw || '').trim().toLowerCase());
}

export interface DadosCorrespondencia {
  user_data_hash: Record<string, string>;
  match_keys: string[];
}

/**
 * Monta o bloco de correspondência já hasheado.
 *
 * `external_id` entra no hash (ajuda a Meta a deduplicar) mas fica FORA de
 * `match_keys`: é o id do nosso CRM, que a Meta não conhece, então não pode
 * contar como identificação de pessoa na hora de decidir se vale enviar.
 */
export function montaCorrespondencia(lead: {
  id: string;
  lead_email?: string | null;
  lead_phone?: string | null;
  lead_name?: string | null;
}): DadosCorrespondencia {
  const hash: Record<string, string> = {};
  const keys: string[] = [];

  const email = (lead.lead_email || '').trim().toLowerCase();
  if (email && emailValido(email)) {
    hash.em = sha256(email);
    keys.push('em');
  }

  const fone = toE164BR(lead.lead_phone || '');
  // Menos de 12 dígitos após o E.164 = número truncado; hash disso é ruído.
  if (fone && fone.length >= 12) {
    hash.ph = sha256(fone);
    keys.push('ph');
  }

  const nome = normalizaNome(lead.lead_name || '');
  if (nome) {
    const partes = nome.split(' ').filter(Boolean);
    if (partes[0]) {
      hash.fn = sha256(partes[0]);
      keys.push('fn');
    }
    if (partes.length > 1) {
      hash.ln = sha256(partes[partes.length - 1]);
      keys.push('ln');
    }
  }

  if (lead.id) hash.external_id = sha256(lead.id);
  return { user_data_hash: hash, match_keys: keys };
}

/**
 * Nome sozinho não sustenta correspondência — homônimo é regra, não exceção,
 * numa base de 23 mil leads. Exige e-mail ou telefone.
 */
export function temCorrespondenciaUtil(match_keys: string[]): boolean {
  return match_keys.includes('em') || match_keys.includes('ph');
}

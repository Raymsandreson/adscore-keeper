// Funções puras da planilha de Lead Ads. Módulo separado de propósito: o
// `bpc-sheet-sync` importa o cliente Supabase, e teste que só quer checar
// formato de string não deveria precisar de credencial para rodar. Mesmo
// padrão de `metaCapiNormalize`.

/**
 * Id do lead na Meta, como a Conversion Leads API espera: número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850` — com prefixo. Em
 * 04/09/2026 gravei 131 linhas assim e só percebi olhando o dado no banco:
 * `length = 18` em vez dos 15-17 dígitos do spec. Id com prefixo é o mesmo que
 * id nenhum, e falha lá na Meta, calada — nada estoura deste lado.
 */
export function normalizaLeadIdMeta(bruto: string | undefined | null): string {
  const digitos = String(bruto || '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : '';
}

// ---------------------------------------------------------------------------
// Abaixo: o que a planilha e a API da Meta PRECISAM compartilhar.
//
// Os dois caminhos criam lead no mesmo board e deduplicam por telefone. Se cada
// um normalizar telefone do seu jeito, o dedup de um nao enxerga o do outro e a
// mesma pessoa entra duas vezes. Por isso mora aqui, num lugar so, com teste.
// ---------------------------------------------------------------------------

/**
 * Telefone em digitos, com 55 quando aplicavel.
 *
 * O `p:` vem da exportacao de Lead Ads, mesma familia do `l:` do id.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = String(raw).replace(/^p:/i, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

/** Chave de dedup: os 8 ultimos digitos ignoram DDI, DDD e o 9 movel. */
export function phoneKey(digits: string): string {
  return digits.slice(-8);
}

export function isJunkName(s: string): boolean {
  const t = (s || '').trim();
  if (!t || t.length < 3) return true;
  if (t.startsWith('<test')) return true;
  if (/^\.+$/.test(t)) return true;
  if (!/[a-zà-ú]/i.test(t)) return true;
  return false;
}

/**
 * Mapeamento por PALAVRA-CHAVE, nao por nome exato.
 *
 * Vale para aba de planilha ("1LEADS EDILAN") e para nome de formulario da Meta
 * ("AUXILIO - ACIDENTE [EDILAN-3]", "MATEUS - BPC") — a mesma pessoa aparece
 * escrita de meia duzia de formas.
 */
export const OPERATOR_KEYWORDS: { keyword: string; operator: string }[] = [
  { keyword: 'israel', operator: 'Israel' },
  { keyword: 'cris', operator: 'Cris' },
  { keyword: 'mateus', operator: 'Mateus' },
  { keyword: 'edilan', operator: 'Edilan' },
  { keyword: 'karol', operator: 'Karolyne' },
  { keyword: 'andressa', operator: 'Andressa' },
  { keyword: 'keilane', operator: 'Keilane' },
  { keyword: 'api', operator: 'API' },
];

/** Operador de um texto livre, ou null. Null vira lista de pendencia, nao palpite. */
export function casaOperador(texto: string): string | null {
  const lower = String(texto || '').toLowerCase();
  const m = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
  return m ? m.operator : null;
}

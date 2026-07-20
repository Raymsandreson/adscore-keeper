import { normalizeDateInput } from './normalizeDateInput';

/**
 * Colunas do tipo `date` na tabela `leads` do Supabase Externo
 * (kmedldlepwiityjsdahz), conferidas no schema real via OpenAPI do PostgREST
 * em 20/07/2026. Colunas `timestamptz` ficam de fora de propósito: elas são
 * preenchidas por código (toISOString), não por texto livre de usuário/IA.
 */
export const LEAD_DATE_COLUMNS = [
  'accident_date',
  'became_client_date',
  'birth_date',
  'cancelled_date',
  'classification_date',
  'expected_birth_date',
  'in_progress_date',
  'inviavel_date',
] as const;

const LEAD_DATE_COLUMNS_SET = new Set<string>(LEAD_DATE_COLUMNS);

export function isLeadDateColumn(key: string): boolean {
  return LEAD_DATE_COLUMNS_SET.has(key);
}

/**
 * Normaliza toda coluna `date` de um payload de escrita em `leads`.
 *
 * Valor que não formar uma data completa e válida vira `null` — inclui os
 * casos que a IA de extração devolve com granularidade de ano ("2024") e que
 * o Postgres rejeita com 22007, derrubando o INSERT/UPDATE inteiro.
 *
 * Não inventa mês nem dia. Não toca em nenhuma outra chave do payload.
 */
export function sanitizeLeadDateFields<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((row) => sanitizeLeadDateFields(row)) as unknown as T;
  }
  if (!payload || typeof payload !== 'object') return payload;

  const row = payload as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (!isLeadDateColumn(key) || value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (value instanceof Date) {
      out[key] = Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
      if (out[key] !== value) changed = true;
      continue;
    }
    if (typeof value !== 'string') {
      // Tipo inesperado numa coluna date: descarta em vez de deixar o banco recusar.
      out[key] = null;
      changed = true;
      continue;
    }
    const normalized = normalizeDateInput(value);
    if (normalized !== value) {
      changed = true;
      // Loga só o nome da coluna — o valor pode ser data de nascimento (dado pessoal).
      console.warn(`[sanitizeLeadDateFields] valor de data inválido/parcial descartado em "${key}"`);
    }
    out[key] = normalized;
  }

  return (changed ? out : payload) as T;
}

import type { Uf } from './types';

export const UFS: readonly Uf[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const UF_SET = new Set<string>(UFS);

export const UF_NAMES: Record<Uf, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

/** Texto normalizado: sem acento, minúsculo, só letras/números separados por espaço. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas de acento separadas pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NAME_TO_UF = new Map<string, Uf>(
  (Object.entries(UF_NAMES) as [Uf, string][]).map(([uf, name]) => [normalizeName(name), uf]),
);

/**
 * Aceita o que o cadastro realmente contém: sigla ("pi", " PI "), nome por
 * extenso ("São Paulo") e lixo ("Não informado", "MG, PA" — ambos viram null).
 * Na base de 04/08/2026 eram 8 leads fora do padrão de sigla.
 */
export function normalizeUf(raw: string | null | undefined): Uf | null {
  if (!raw) return null;

  const trimmed = raw.trim().toUpperCase();
  if (UF_SET.has(trimmed)) return trimmed as Uf;

  return NAME_TO_UF.get(normalizeName(raw)) ?? null;
}

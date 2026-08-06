import { describe, expect, it } from 'vitest';
import { UFS, normalizeName, normalizeUf } from '../uf';

describe('normalizeUf', () => {
  it('aceita as 27 siglas', () => {
    expect(UFS).toHaveLength(27);
    for (const uf of UFS) expect(normalizeUf(uf)).toBe(uf);
  });

  it('tolera caixa e espaço em volta', () => {
    expect(normalizeUf(' pi ')).toBe('PI');
    expect(normalizeUf('sp')).toBe('SP');
  });

  // Na base de 04/08/2026 havia 8 leads com o estado por extenso.
  it('aceita nome por extenso, com e sem acento', () => {
    expect(normalizeUf('São Paulo')).toBe('SP');
    expect(normalizeUf('sao paulo')).toBe('SP');
    expect(normalizeUf('Espírito Santo')).toBe('ES');
    expect(normalizeUf('Distrito Federal')).toBe('DF');
  });

  it('devolve null para lixo de cadastro', () => {
    expect(normalizeUf('Não informado')).toBeNull();
    expect(normalizeUf('MG, PA')).toBeNull();
    expect(normalizeUf('XX')).toBeNull();
    expect(normalizeUf('')).toBeNull();
    expect(normalizeUf(null)).toBeNull();
    expect(normalizeUf(undefined)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(normalizeName('São Luís')).toBe('sao luis');
    expect(normalizeName('  BRASÍLIA  ')).toBe('brasilia');
    expect(normalizeName("Alta Floresta D'Oeste")).toBe('alta floresta d oeste');
    expect(normalizeName('Colíder')).toBe('colider');
  });

  it('trata vazio e nulo', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

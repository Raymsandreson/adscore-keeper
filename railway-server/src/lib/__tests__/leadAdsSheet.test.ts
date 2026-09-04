/**
 * O id do lead da Meta tem que sair da planilha como número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850`. A Conversion Leads API
 * espera 15-17 dígitos; com o prefixo ela não casa o fechamento com o
 * formulário e não reclama — falha do lado de lá, calada. Em 04/09/2026 foram
 * 131 linhas gravadas com prefixo antes de alguém olhar o dado no banco.
 */
import { describe, it, expect } from 'vitest';
import { normalizaLeadIdMeta } from '../leadAdsSheet';

describe('normalizaLeadIdMeta', () => {
  it('tira o prefixo l: da exportação da Meta', () => {
    expect(normalizaLeadIdMeta('l:1009263962139850')).toBe('1009263962139850');
  });

  it('deixa passar o id que já vem limpo', () => {
    expect(normalizaLeadIdMeta('1009263962139850')).toBe('1009263962139850');
  });

  it('devolve vazio para célula vazia, nula ou lixo curto', () => {
    expect(normalizaLeadIdMeta('')).toBe('');
    expect(normalizaLeadIdMeta(null)).toBe('');
    expect(normalizaLeadIdMeta(undefined)).toBe('');
    expect(normalizaLeadIdMeta('l:')).toBe('');
    expect(normalizaLeadIdMeta('n/a')).toBe('');
    expect(normalizaLeadIdMeta('123')).toBe('');
  });
});

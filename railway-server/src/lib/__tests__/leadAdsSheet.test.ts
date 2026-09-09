/**
 * O id do lead da Meta tem que sair da planilha como número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850`. A Conversion Leads API
 * espera 15-17 dígitos; com o prefixo ela não casa o fechamento com o
 * formulário e não reclama — falha do lado de lá, calada. Em 04/09/2026 foram
 * 131 linhas gravadas com prefixo antes de alguém olhar o dado no banco.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizaLeadIdMeta,
  normalizePhone,
  phoneKey,
  isJunkName,
  casaOperador,
} from '../leadAdsSheet';

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

describe('helpers compartilhados entre planilha e API da Meta', () => {
  it('normaliza telefone para dígitos com 55', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('5511987654321')).toBe('5511987654321');
    expect(normalizePhone('p:5511987654321')).toBe('5511987654321'); // prefixo da exportação
    expect(normalizePhone('')).toBe('');
  });

  it('dedup usa os 8 últimos dígitos, então planilha e API se enxergam', () => {
    // O mesmo humano escrito de dois jeitos precisa dar a MESMA chave, senão
    // ele entra uma vez por caminho.
    expect(phoneKey(normalizePhone('(11) 98765-4321'))).toBe(phoneKey(normalizePhone('5511987654321')));
  });

  it('nome só de dígitos é lixo', () => {
    // Regressão: ao mover isJunkName eu corrompi o range para [a-za-u00e0-ú],
    // que inclui dígitos — "12345" passava como nome válido.
    expect(isJunkName('12345')).toBe(true);
    expect(isJunkName('<test>')).toBe(true);
    expect(isJunkName('..')).toBe(true);
    expect(isJunkName('ab')).toBe(true);
    expect(isJunkName('Maria Aparecida')).toBe(false);
    expect(isJunkName('José')).toBe(false);
  });

  it('casa operador em aba de planilha e em nome de formulário da Meta', () => {
    expect(casaOperador('MATEUS - BPC')).toBe('Mateus');
    expect(casaOperador('AUXÍLIO - ACIDENTE [EDILAN-3]')).toBe('Edilan');
    expect(casaOperador('KAROL - BPC')).toBe('Karolyne');
    expect(casaOperador('1LEADS EDILAN')).toBe('Edilan');
  });

  it('formulário que não é de atendente devolve null, para virar decisão', () => {
    expect(casaOperador('[REPRESENTANTE COMERCIAL-SP]')).toBeNull();
    expect(casaOperador('[CAPTAÇÃO][CORRETOR]')).toBeNull();
  });

  it('CUIDADO DOCUMENTADO: "api" casa por substring', () => {
    // A palavra-chave 'api' existe para a aba "API" da planilha, mas casa dentro
    // de qualquer palavra. Hoje nenhum formulário colide; se alguém criar
    // "TERAPIA - BPC", o lead vai para o operador errado.
    expect(casaOperador('TERAPIA - BPC')).toBe('API');
  });
});

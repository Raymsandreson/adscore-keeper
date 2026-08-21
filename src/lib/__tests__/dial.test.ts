import { describe, it, expect } from 'vitest';
import {
  normalizarTelefone,
  telefoneDiscavel,
  comNonoDigito,
  paraE164,
  hrefTel,
  exibirTelefone,
} from '../dial';

describe('normalizarTelefone', () => {
  it('põe o 55 em número nacional de 10 e 11 dígitos', () => {
    expect(normalizarTelefone('(86) 98181-2709')).toBe('5586981812709');
    expect(normalizarTelefone('8632211234')).toBe('558632211234');
  });
  it('mantém quem já vem com 55', () => {
    expect(normalizarTelefone('+55 86 98181-2709')).toBe('5586981812709');
  });
  it('devolve vazio para lixo', () => {
    expect(normalizarTelefone(null)).toBe('');
    expect(normalizarTelefone('sem telefone')).toBe('');
  });
});

describe('telefoneDiscavel', () => {
  it('aceita 12 e 13 dígitos', () => {
    expect(telefoneDiscavel('5586981812709')).toBe(true); // celular
    expect(telefoneDiscavel('558632211234')).toBe(true); // fixo
  });
  it('recusa curto, longo e vazio', () => {
    expect(telefoneDiscavel('98181')).toBe(false);
    expect(telefoneDiscavel('5586981812709999')).toBe(false);
    expect(telefoneDiscavel('')).toBe(false);
  });
});

describe('comNonoDigito', () => {
  it('completa celular antigo de 8 dígitos', () => {
    expect(comNonoDigito('558681812709')).toBe('5586981812709');
  });
  it('não mexe em fixo (assinante começa em 2-5)', () => {
    expect(comNonoDigito('558632211234')).toBe('558632211234');
  });
  it('não mexe em quem já tem 13 dígitos', () => {
    expect(comNonoDigito('5586981812709')).toBe('5586981812709');
  });
});

describe('paraE164 e hrefTel', () => {
  it('devolve E.164 com o +', () => {
    expect(paraE164('(86) 98181-2709')).toBe('+5586981812709');
    expect(hrefTel('(86) 98181-2709')).toBe('tel:+5586981812709');
  });
  it('devolve vazio quando não é discável — a tela não pode montar link morto', () => {
    expect(paraE164('123')).toBe('');
    expect(hrefTel(null)).toBe('');
  });
});

describe('exibirTelefone', () => {
  it('formata celular e fixo', () => {
    expect(exibirTelefone('5586981812709')).toBe('(86) 98181-2709');
    expect(exibirTelefone('558632211234')).toBe('(86) 3221-1234');
  });
  it('devolve o original quando não sabe formatar', () => {
    expect(exibirTelefone('abc')).toBe('abc');
  });
});

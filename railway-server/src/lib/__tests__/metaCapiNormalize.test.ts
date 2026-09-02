// A correspondência da Meta falha em silêncio: payload errado é aceito com 200
// e simplesmente não casa ninguém. Estes testes prendem o formato.
import { describe, it, expect } from 'vitest';
import {
  toE164BR,
  normalizaNome,
  emailValido,
  montaCorrespondencia,
  temCorrespondenciaUtil,
  sha256,
} from '../metaCapiNormalize';

describe('toE164BR', () => {
  it('prefixa 55 em celular e fixo nacionais', () => {
    expect(toE164BR('11987654321')).toBe('5511987654321'); // 11 dígitos
    expect(toE164BR('1132654321')).toBe('551132654321'); // 10 dígitos
  });

  it('é idempotente: não duplica o 55 de quem já veio internacional', () => {
    expect(toE164BR('5511987654321')).toBe('5511987654321');
    expect(toE164BR('551132654321')).toBe('551132654321');
    expect(toE164BR(toE164BR('11987654321'))).toBe('5511987654321');
  });

  it('descarta máscara e deixa só dígitos', () => {
    expect(toE164BR('(11) 98765-4321')).toBe('5511987654321');
    expect(toE164BR('+55 11 98765-4321')).toBe('5511987654321');
  });

  it('não corrompe formato desconhecido nem estoura em vazio', () => {
    expect(toE164BR('')).toBe('');
    expect(toE164BR('abc')).toBe('');
    // 9 dígitos não é telefone brasileiro válido: passa intacto para ser
    // barrado adiante, em vez de virar um 55+lixo que a Meta aceitaria.
    expect(toE164BR('123456789')).toBe('123456789');
  });
});

describe('normalizaNome', () => {
  it('minúsculas, sem pontuação nem dígitos, espaços colapsados', () => {
    expect(normalizaNome('  José   da Silva Jr. 2 ')).toBe('josé da silva jr');
    expect(normalizaNome("O'Brien-Souza")).toBe('obriensouza');
  });

  it('preserva acento (a Meta aceita UTF-8)', () => {
    expect(normalizaNome('Conceição')).toBe('conceição');
  });
});

describe('emailValido', () => {
  it('aceita e-mail comum e recusa lixo', () => {
    expect(emailValido('alguem@exemplo.com.br')).toBe(true);
    expect(emailValido('sem-arroba.com')).toBe(false);
    expect(emailValido('a@b')).toBe(false);
    expect(emailValido('')).toBe(false);
  });
});

describe('montaCorrespondencia', () => {
  const lead = {
    id: '11111111-2222-3333-4444-555555555555',
    lead_email: '  Alguem@Exemplo.COM ',
    lead_phone: '(11) 98765-4321',
    lead_name: 'Maria da Silva',
  };

  it('hasheia o e-mail em minúsculas e sem espaço', () => {
    const { user_data_hash } = montaCorrespondencia(lead);
    expect(user_data_hash.em).toBe(sha256('alguem@exemplo.com'));
  });

  it('hasheia o telefone já em E.164', () => {
    const { user_data_hash } = montaCorrespondencia(lead);
    expect(user_data_hash.ph).toBe(sha256('5511987654321'));
  });

  it('usa primeiro e ÚLTIMO nome (o do meio não é sobrenome)', () => {
    const { user_data_hash } = montaCorrespondencia(lead);
    expect(user_data_hash.fn).toBe(sha256('maria'));
    expect(user_data_hash.ln).toBe(sha256('silva'));
  });

  it('nunca devolve dado em claro', () => {
    const { user_data_hash } = montaCorrespondencia(lead);
    const tudo = JSON.stringify(user_data_hash);
    expect(tudo).not.toContain('Alguem');
    expect(tudo).not.toContain('98765');
    expect(tudo).not.toContain('Maria');
    for (const v of Object.values(user_data_hash)) expect(v).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deixa external_id fora de match_keys: id do CRM não identifica ninguém na Meta', () => {
    const { user_data_hash, match_keys } = montaCorrespondencia({
      id: lead.id, lead_email: null, lead_phone: null, lead_name: null,
    });
    expect(user_data_hash.external_id).toBe(sha256(lead.id));
    expect(match_keys).toEqual([]);
  });

  it('ignora e-mail inválido e telefone truncado em vez de mandar hash de lixo', () => {
    const { user_data_hash, match_keys } = montaCorrespondencia({
      id: lead.id, lead_email: 'não-é-email', lead_phone: '9876', lead_name: null,
    });
    expect(user_data_hash.em).toBeUndefined();
    expect(user_data_hash.ph).toBeUndefined();
    expect(match_keys).toEqual([]);
  });

  it('nome de uma palavra só não inventa sobrenome', () => {
    const { user_data_hash, match_keys } = montaCorrespondencia({
      id: lead.id, lead_name: 'Madonna', lead_email: null, lead_phone: null,
    });
    expect(user_data_hash.fn).toBe(sha256('madonna'));
    expect(user_data_hash.ln).toBeUndefined();
    expect(match_keys).toEqual(['fn']);
  });
});

describe('temCorrespondenciaUtil', () => {
  it('exige e-mail ou telefone; nome sozinho não basta', () => {
    expect(temCorrespondenciaUtil(['em'])).toBe(true);
    expect(temCorrespondenciaUtil(['ph'])).toBe(true);
    expect(temCorrespondenciaUtil(['fn', 'ln'])).toBe(false);
    expect(temCorrespondenciaUtil([])).toBe(false);
  });
});

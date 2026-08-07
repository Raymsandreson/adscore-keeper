import { describe, expect, it } from 'vitest';
import {
  deriveVisitFromAccident,
  parseCityStateFromAddress,
  regionForUf,
  sanitizeExtractedRecord,
  sanitizeExtractedText,
} from '../visitFromAccident';

describe('sanitizeExtractedText', () => {
  it('mata a palavra "null" que a IA escreve quando não acha o dado', () => {
    expect(sanitizeExtractedText('null')).toBeNull();
    expect(sanitizeExtractedText('NULL')).toBeNull();
    expect(sanitizeExtractedText('undefined')).toBeNull();
    expect(sanitizeExtractedText('N/A')).toBeNull();
    expect(sanitizeExtractedText('Não informado')).toBeNull();
    expect(sanitizeExtractedText('   ')).toBeNull();
    expect(sanitizeExtractedText('-')).toBeNull();
  });

  it('preserva valor de verdade', () => {
    expect(sanitizeExtractedText('  Samambaia ')).toBe('Samambaia');
    expect(sanitizeExtractedText('Óbito')).toBe('Óbito');
    // "Nulidade" começa com "nul" mas não é placeholder.
    expect(sanitizeExtractedText('Nulidade contratual')).toBe('Nulidade contratual');
  });

  it('limpa o registro inteiro sem tocar em número', () => {
    expect(sanitizeExtractedRecord({ visit_city: 'null', victim_age: 42, victim_name: 'João' }))
      .toEqual({ visit_city: null, victim_age: 42, victim_name: 'João' });
  });
});

describe('parseCityStateFromAddress', () => {
  it('tira o descritor do lugar e fica com a cidade', () => {
    // Caso que motivou a mudança (post do Sindurb-DF).
    expect(parseCityStateFromAddress('Aterro Sanitário de Samambaia, DF'))
      .toEqual({ city: 'Samambaia', state: 'DF' });
    expect(parseCityStateFromAddress('Usina de Cana em Sertãozinho, SP'))
      .toEqual({ city: 'Sertãozinho', state: 'SP' });
  });

  it('usa o último segmento antes da UF', () => {
    expect(parseCityStateFromAddress('Mina de Carajás, Parauapebas, PA'))
      .toEqual({ city: 'Parauapebas', state: 'PA' });
    expect(parseCityStateFromAddress('Rodovia BR-163, km 20, Sinop, MT'))
      .toEqual({ city: 'Sinop', state: 'MT' });
  });

  it('aceita os separadores que aparecem no cadastro', () => {
    expect(parseCityStateFromAddress('Recife/PE')).toEqual({ city: 'Recife', state: 'PE' });
    expect(parseCityStateFromAddress('Sinop - MT')).toEqual({ city: 'Sinop', state: 'MT' });
    expect(parseCityStateFromAddress('Belo Horizonte-MG')).toEqual({ city: 'Belo Horizonte', state: 'MG' });
    expect(parseCityStateFromAddress('Samambaia, Distrito Federal'))
      .toEqual({ city: 'Samambaia', state: 'DF' });
  });

  it('não quebra cidade cujo nome tem conector', () => {
    expect(parseCityStateFromAddress('Rio de Janeiro, RJ'))
      .toEqual({ city: 'Rio de Janeiro', state: 'RJ' });
    expect(parseCityStateFromAddress('São José dos Campos, SP'))
      .toEqual({ city: 'São José dos Campos', state: 'SP' });
  });

  it('devolve só a UF quando o segmento não é nome de cidade', () => {
    expect(parseCityStateFromAddress('Rua das Palmeiras, 120, PE'))
      .toEqual({ city: null, state: 'PE' });
    expect(parseCityStateFromAddress('Avenida Paulista, SP'))
      .toEqual({ city: null, state: 'SP' });
  });

  it('sem UF não chuta cidade', () => {
    expect(parseCityStateFromAddress('Fábrica de tintas do interior'))
      .toEqual({ city: null, state: null });
    expect(parseCityStateFromAddress('null')).toEqual({ city: null, state: null });
    expect(parseCityStateFromAddress(null)).toEqual({ city: null, state: null });
  });
});

describe('regionForUf', () => {
  it('resolve por sigla e por nome', () => {
    expect(regionForUf('DF')).toBe('Centro-Oeste');
    expect(regionForUf('pe')).toBe('Nordeste');
    expect(regionForUf('São Paulo')).toBe('Sudeste');
    expect(regionForUf('XX')).toBe('');
    expect(regionForUf(null)).toBe('');
  });
});

describe('deriveVisitFromAccident', () => {
  it('preenche a aba Local com o acidente quando não há endereço da pessoa', () => {
    const { patch, derivedKeys } = deriveVisitFromAccident({
      accident_address: 'Aterro Sanitário de Samambaia, DF',
      visit_city: null,
      visit_state: null,
    });
    expect(patch).toEqual({
      visit_city: 'Samambaia',
      visit_state: 'DF',
      visit_region: 'Centro-Oeste',
      visit_address: 'Aterro Sanitário de Samambaia, DF',
    });
    expect(derivedKeys).toContain('visit_city');
  });

  it('trata "null" da IA como vazio', () => {
    const { patch } = deriveVisitFromAccident({
      accident_address: 'Sinop, MT',
      visit_city: 'null',
      visit_state: 'null',
    });
    expect(patch.visit_city).toBe('Sinop');
    expect(patch.visit_state).toBe('MT');
  });

  it('nunca sobrescreve o que já está preenchido', () => {
    const { patch, derivedKeys } = deriveVisitFromAccident({
      accident_address: 'Aterro Sanitário de Samambaia, DF',
      visit_city: 'Recife',
      visit_state: 'PE',
      visit_region: 'Nordeste',
      visit_address: 'Rua da Aurora, 100',
    });
    expect(patch).toEqual({});
    expect(derivedKeys).toEqual([]);
  });

  it('sem local do acidente não inventa nada', () => {
    expect(deriveVisitFromAccident({ accident_address: null, visit_city: null }))
      .toEqual({ patch: {}, derivedKeys: [] });
  });

  it('completa só o que falta', () => {
    const { patch, derivedKeys } = deriveVisitFromAccident({
      accident_address: 'Mina de Carajás, Parauapebas, PA',
      visit_city: 'Parauapebas',
      visit_state: null,
    });
    expect(patch).toEqual({
      visit_state: 'PA',
      visit_region: 'Norte',
      visit_address: 'Mina de Carajás, Parauapebas, PA',
    });
    expect(derivedKeys).not.toContain('visit_city');
  });
});

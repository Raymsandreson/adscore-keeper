import { describe, expect, it } from 'vitest';
import { resolveLeadLocation } from '../resolveLeadLocation';
import { sampleIndex } from './fixtures';

const index = sampleIndex();
const resolve = (lead: Parameters<typeof resolveLeadLocation>[0]) => resolveLeadLocation(lead, index);

describe('resolveLeadLocation — precedência dos campos', () => {
  it('usa a coordenada do lead quando existe, e ainda assim rotula o município', () => {
    const location = resolve({ city: 'Picos', state: 'PI', lead_lat: -7.05, lead_lng: -41.52 });
    expect(location.confidence).toBe('coordinate');
    expect(location.source).toBe('lead_coords');
    expect(location.point).toEqual({ lat: -7.05, lng: -41.52 });
    expect(location.municipality?.name).toBe('Picos');
    expect(location.uf).toBe('PI');
  });

  it('cai no centroide do município quando não há coordenada', () => {
    const location = resolve({ city: 'Teresina', state: 'PI' });
    expect(location.confidence).toBe('municipality');
    expect(location.source).toBe('city');
    expect(location.point).toEqual({ lat: -5.1027, lng: -42.7406 });
  });

  it('usa visit_city só quando city está vazio', () => {
    const location = resolve({ city: '', visit_city: 'Picos', visit_state: 'PI' });
    expect(location.source).toBe('visit_city');
    expect(location.municipality?.name).toBe('Picos');
  });

  it('prefere city a visit_city e avisa da divergência', () => {
    const location = resolve({
      city: 'Teresina', state: 'PI',
      visit_city: 'Picos', visit_state: 'PI',
    });
    expect(location.municipality?.name).toBe('Teresina');
    expect(location.warnings).toContainEqual({
      type: 'city_visit_divergence', city: 'Teresina', visitCity: 'Picos',
    });
  });

  it('não avisa divergência quando os dois campos dizem o mesmo', () => {
    const location = resolve({ city: 'Teresina', state: 'PI', visit_city: 'teresina' });
    expect(location.warnings).toHaveLength(0);
  });

  it('marca como inferida a cidade sem UF', () => {
    const location = resolve({ city: 'Teresina' });
    expect(location.confidence).toBe('inferred');
    expect(location.uf).toBe('PI');
  });
});

describe('resolveLeadLocation — casos de borda do cadastro', () => {
  it('sem nada aproveitável, devolve vazio com aviso', () => {
    const location = resolve({});
    expect(location.confidence).toBe('none');
    expect(location.point).toBeNull();
    expect(location.uf).toBeNull();
    expect(location.warnings).toEqual([{ type: 'no_data' }]);
  });

  it('só com UF, desenha o estado sem ponto', () => {
    const location = resolve({ state: 'PI' });
    expect(location.confidence).toBe('uf');
    expect(location.uf).toBe('PI');
    expect(location.point).toBeNull();
  });

  it('bairro no lugar da cidade: mantém a UF e avisa', () => {
    const location = resolve({ city: 'Botafogo', state: 'RJ' });
    expect(location.confidence).toBe('uf');
    expect(location.uf).toBe('RJ');
    expect(location.point).toBeNull();
    expect(location.warnings).toContainEqual({ type: 'unknown_city', city: 'Botafogo' });
  });

  it('UF incoerente: não escolhe município nenhum', () => {
    const location = resolve({ city: 'Colíder', state: 'MA' });
    expect(location.municipality).toBeNull();
    expect(location.uf).toBe('MA');
    expect(location.point).toBeNull();
    expect(location.warnings).toContainEqual({
      type: 'uf_mismatch', city: 'Colíder', informedUf: 'MA', possibleUfs: ['MT'],
    });
  });

  it('cidade ambígua sem UF: avisa e não decide', () => {
    const location = resolve({ city: 'Bom Jesus' });
    expect(location.municipality).toBeNull();
    expect(location.confidence).toBe('none');
    expect(location.warnings[0]).toMatchObject({ type: 'ambiguous_city', city: 'Bom Jesus' });
  });

  it('município sem centroide: reconhece, avisa e fica no nível de UF', () => {
    const location = resolve({ city: 'Boa Esperança do Norte', state: 'MT' });
    expect(location.municipality?.ibgeCode).toBe(5101837);
    expect(location.uf).toBe('MT');
    expect(location.point).toBeNull();
    expect(location.confidence).toBe('uf');
    expect(location.warnings).toContainEqual({
      type: 'municipality_without_center', city: 'Boa Esperança do Norte', uf: 'MT',
    });
  });

  it('região administrativa do DF resolve para Brasília', () => {
    const location = resolve({ city: 'Ceilândia', state: 'DF' });
    expect(location.municipality?.ibgeCode).toBe(5300108);
    expect(location.uf).toBe('DF');
    expect(location.point).not.toBeNull();
  });

  it('estado por extenso é aceito', () => {
    expect(resolve({ city: 'São Paulo', state: 'São Paulo' }).uf).toBe('SP');
  });

  it('descarta coordenada (0,0), que é sujeira de geocoding', () => {
    const location = resolve({ city: 'Teresina', state: 'PI', lead_lat: 0, lead_lng: 0 });
    expect(location.confidence).toBe('municipality');
    expect(location.point).toEqual({ lat: -5.1027, lng: -42.7406 });
  });

  it('ignora coordenada não numérica', () => {
    const location = resolve({
      city: 'Teresina', state: 'PI',
      lead_lat: Number.NaN, lead_lng: null,
    });
    expect(location.confidence).toBe('municipality');
  });
});

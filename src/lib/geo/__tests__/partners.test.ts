import { describe, expect, it } from 'vitest';
import municipios from '@/lib/geo/data/municipios.json';
import { createMunicipalityIndex, resolvePartnerReferences, type MunicipalityRow } from '..';

const index = createMunicipalityIndex(municipios as MunicipalityRow[]);

const resolve = (rows: Parameters<typeof resolvePartnerReferences>[1]) =>
  resolvePartnerReferences(index, rows);

describe('resolvePartnerReferences', () => {
  it('posiciona o parceiro pelo centroide do município', () => {
    const { references, unresolved } = resolve([
      { id: 'c1', full_name: 'Escritório Parceiro', city: 'Teresina', state: 'PI' },
    ]);

    expect(unresolved).toBe(0);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      key: 'partner:c1',
      name: 'Escritório Parceiro',
      city: 'Teresina',
      uf: 'PI',
      kind: 'partner',
      contactId: 'c1',
      ufMismatch: false,
    });
    expect(references[0].point.lat).toBeCloseTo(-5.09, 1);
  });

  it('aceita UF errada quando a cidade só existe num estado, e sinaliza', () => {
    // Caso real do cadastro: "Porto Velho/MT". Porto Velho é de RO e não existe
    // em nenhum outro estado, então dá para posicionar sem adivinhar.
    const { references, unresolved } = resolve([
      { id: 'c2', full_name: 'Correspondente', city: 'Porto Velho', state: 'MT' },
    ]);

    expect(unresolved).toBe(0);
    expect(references[0]).toMatchObject({ uf: 'RO', city: 'Porto Velho', ufMismatch: true });
  });

  it('não chuta quando a cidade sem UF existe em vários estados', () => {
    const { references, unresolved } = resolve([
      { id: 'c3', full_name: 'Indefinido', city: 'Bom Jesus', state: null },
    ]);

    expect(references).toHaveLength(0);
    expect(unresolved).toBe(1);
  });

  it('descarta bairro, cadastro vazio e texto sem correspondência', () => {
    const { references, unresolved } = resolve([
      { id: 'c4', full_name: 'Bairro', city: 'Botafogo', state: 'RJ' },
      { id: 'c5', full_name: 'Sem cidade', city: null, state: 'PI' },
      { id: 'c6', full_name: 'Vazio', city: '', state: '' },
    ]);

    expect(references).toHaveLength(0);
    expect(unresolved).toBe(3);
  });

  it('cai num rótulo neutro quando o contato está sem nome', () => {
    const { references } = resolve([{ id: 'c7', full_name: '   ', city: 'Sorriso', state: 'MT' }]);

    expect(references[0].name).toBe('Parceiro sem nome');
  });

  it('resolve uma lista mista preservando a ordem e contando as sobras', () => {
    const { references, unresolved } = resolve([
      { id: 'a', full_name: 'A', city: 'Timon', state: 'MA' },
      { id: 'b', full_name: 'B', city: 'Botafogo', state: 'RJ' },
      { id: 'c', full_name: 'C', city: 'Teresina', state: 'PI' },
    ]);

    expect(references.map((reference) => reference.contactId)).toEqual(['a', 'c']);
    expect(unresolved).toBe(1);
  });

  it('lista vazia não quebra', () => {
    expect(resolve([])).toEqual({ references: [], unresolved: 0 });
  });
});

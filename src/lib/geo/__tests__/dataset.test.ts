import { describe, expect, it } from 'vitest';
import municipios from '../data/municipios.json';
import { CAPITAL_IBGE_CODES, buildCapitalReferences } from '../capitals';
import { computeFraming } from '../framingMode';
import { createMunicipalityIndex, type MunicipalityRow } from '../municipalities';
import { resolveLeadLocation } from '../resolveLeadLocation';
import { UFS } from '../uf';

/**
 * Roda contra o dataset real gerado por `scripts/build-geo-dataset.mjs`.
 * Serve de trava: se alguém regerar o arquivo e algo vier torto, quebra aqui.
 */
const rows = municipios as MunicipalityRow[];
const index = createMunicipalityIndex(rows);
const references = buildCapitalReferences(index);

describe('dataset do IBGE', () => {
  it('tem os 5.571 municípios do país', () => {
    expect(rows).toHaveLength(5571);
    expect(index.size).toBe(5571);
  });

  it('toda linha tem código, nome e UF válida', () => {
    for (const [code, name, uf] of rows) {
      expect(Number.isInteger(code)).toBe(true);
      expect(name.length).toBeGreaterThan(0);
      expect(UFS).toContain(uf);
    }
  });

  it('as coordenadas caem dentro do território brasileiro', () => {
    for (const [, name, , lat, lng] of rows) {
      if (lat == null || lng == null) continue;
      expect(lat, name).toBeGreaterThan(-34); // Chuí
      expect(lat, name).toBeLessThan(6); // Monte Caburaí
      expect(lng, name).toBeGreaterThan(-74); // Serra do Divisor
      expect(lng, name).toBeLessThan(-28); // Ilhas de Trindade
    }
  });

  it('só Boa Esperança do Norte/MT segue sem centroide publicado', () => {
    const semCentro = rows.filter(([, , , lat]) => lat == null).map(([code]) => code);
    expect(semCentro).toEqual([5101837]);
  });
});

describe('capitais', () => {
  it('os 27 códigos existem e estão na UF declarada', () => {
    for (const uf of UFS) {
      const municipality = index.byIbgeCode.get(CAPITAL_IBGE_CODES[uf]);
      expect(municipality, `capital de ${uf}`).toBeDefined();
      expect(municipality!.uf, `capital de ${uf} é ${municipality!.name}`).toBe(uf);
    }
  });

  it('viram 27 pontos de referência com chave estável', () => {
    expect(references).toHaveLength(27);
    expect(references.find((r) => r.uf === 'PI')).toMatchObject({
      key: 'capital:PI',
      name: 'Teresina',
      kind: 'capital',
    });
    expect(new Set(references.map((r) => r.key)).size).toBe(27);
  });
});

describe('casos reais da base de leads', () => {
  const framingFor = (city: string, state: string) =>
    computeFraming(resolveLeadLocation({ city, state }, index), references);

  // Medidos em 04/08/2026 contra os leads geocodificados.
  it.each([
    ['Santana do Araguaia', 'PA', 'Palmas', 'TO'],
    ['Terra Santa', 'PA', 'Manaus', 'AM'],
    ['Formosa do Rio Preto', 'BA', 'Palmas', 'TO'],
    ['Tabatinga', 'AM', 'Rio Branco', 'AC'],
  ])('%s/%s é servida por %s/%s, de outro estado', (city, state, capital, capitalUf) => {
    const framing = framingFor(city, state);
    expect(framing.mode).toBe('TWO_STATES');
    expect(framing.target?.reference.name).toBe(capital);
    expect(framing.ufs).toEqual([state, capitalUf]);
  });

  it.each([
    ['Teresina', 'PI'],
    ['São Paulo', 'SP'],
    ['Belém', 'PA'],
  ])('%s/%s é a própria capital', (city, state) => {
    expect(framingFor(city, state).mode).toBe('AT_REFERENCE');
  });

  it('Picos/PI é servida por Teresina, do próprio estado', () => {
    const framing = framingFor('Picos', 'PI');
    expect(framing.mode).toBe('ONE_STATE');
    expect(framing.target?.reference.name).toBe('Teresina');
  });

  it('não há município cuja capital mais próxima fique absurdamente longe', () => {
    // Guarda contra coordenada trocada no dataset: nenhum município do Brasil
    // está a mais de ~1.100 km da capital mais próxima.
    for (const [, name, , lat, lng] of rows) {
      if (lat == null || lng == null) continue;
      const framing = computeFraming(
        { uf: 'PI', municipality: null, point: { lat, lng }, confidence: 'municipality', source: 'city', warnings: [] },
        references,
      );
      expect(framing.target!.km, name).toBeLessThan(1100);
    }
  });
});

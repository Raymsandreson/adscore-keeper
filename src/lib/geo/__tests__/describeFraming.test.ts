import { describe, expect, it } from 'vitest';
import municipios from '../data/municipios.json';
import { buildCapitalReferences } from '../capitals';
import { describeFramingLong, describeFramingShort, formatKm } from '../describeFraming';
import { computeFraming } from '../framingMode';
import { createMunicipalityIndex, type MunicipalityRow } from '../municipalities';
import { resolveLeadLocation, type LocatableLead } from '../resolveLeadLocation';

const index = createMunicipalityIndex(municipios as MunicipalityRow[]);
const references = buildCapitalReferences(index);

function describeLead(lead: LocatableLead) {
  const location = resolveLeadLocation(lead, index);
  const framing = computeFraming(location, references);
  return {
    short: describeFramingShort(location, framing),
    long: describeFramingLong(location, framing),
  };
}

describe('formatKm', () => {
  it('arredonda e usa separador de milhar pt-BR', () => {
    expect(formatKm(238.4)).toBe('238 km');
    expect(formatKm(1234.6)).toBe('1.235 km');
    expect(formatKm(0)).toBe('0 km');
  });
});

describe('describeFraming', () => {
  it('lead na capital não anuncia distância', () => {
    const { short, long } = describeLead({ city: 'Teresina', state: 'PI' });
    expect(short).toBe('PI · Teresina');
    expect(short).not.toMatch(/km/);
    expect(long).toBe('Teresina/PI é a capital do estado.');
  });

  it('interior do próprio estado mostra a distância até a capital', () => {
    const { short, long } = describeLead({ city: 'Picos', state: 'PI' });
    expect(short).toMatch(/^PI · Picos, \d+ km de Teresina$/);
    expect(long).toMatch(/^Picos\/PI fica a \d+ km de Teresina, a referência mais próxima\.$/);
  });

  // Sem a comparação, uma capital de outro estado parece erro de sistema.
  it('capital de outro estado vem com a UF e com a comparação no tooltip', () => {
    const { short, long } = describeLead({ city: 'Santana do Araguaia', state: 'PA' });
    expect(short).toMatch(/^PA · Santana do Araguaia, \d+ km de Palmas\/TO$/);
    expect(long).toMatch(/em outro estado\./);
    expect(long).toMatch(/A capital do próprio estado, Belém, fica a \d+ km\./);
  });

  it('sem cidade reconhecida, explica o motivo', () => {
    const { short, long } = describeLead({ city: 'Botafogo', state: 'RJ' });
    expect(short).toBe('RJ · Rio de Janeiro');
    expect(long).toBe('Rio de Janeiro — "Botafogo" não é um município reconhecido.');
  });

  it('só com UF, diz que falta a cidade', () => {
    expect(describeLead({ state: 'PI' }).long).toBe('Piauí — sem cidade no cadastro.');
  });

  it('sem nada, não inventa lugar', () => {
    const { short, long } = describeLead({});
    expect(short).toBe('Sem localização');
    expect(long).toBe('Lead sem cidade ou estado no cadastro.');
  });
});

import { describe, expect, it } from 'vitest';
import { buildCapitalReferences } from '../capitals';
import { computeFraming } from '../framingMode';
import { resolveLeadLocation } from '../resolveLeadLocation';
import type { ReferencePoint } from '../types';
import { sampleIndex } from './fixtures';

const index = sampleIndex();
const references = buildCapitalReferences(index);
const framingFor = (lead: Parameters<typeof resolveLeadLocation>[0], options = {}) =>
  computeFraming(resolveLeadLocation(lead, index), references, options);

describe('computeFraming — a regra de um ou dois estados', () => {
  // 87,5% dos leads geocodificados caem aqui: já estão na capital.
  it('lead na própria capital: AT_REFERENCE, sem distância na tela', () => {
    const framing = framingFor({ city: 'Teresina', state: 'PI' });
    expect(framing.mode).toBe('AT_REFERENCE');
    expect(framing.ufs).toEqual(['PI']);
    expect(framing.target?.reference.uf).toBe('PI');
    expect(framing.target?.km).toBeLessThan(5);
  });

  // Regressão: o ponto do lead vem do geocoder (centro urbano) e o da capital é o
  // centroide da área do município — em Teresina são ~7 km de diferença. Antes de
  // comparar por código IBGE, quem morava na capital caía em ONE_STATE, e a base
  // inteira ficava classificada como interior.
  it('lead geocodificado no centro da capital não vira interior por causa do raio', () => {
    const framing = framingFor({
      city: 'Teresina', state: 'PI',
      lead_lat: -5.0892, lead_lng: -42.8019, // centro de Teresina, não o centroide
    });
    expect(framing.mode).toBe('AT_REFERENCE');
    expect(framing.target!.km).toBeGreaterThan(5); // fora do raio, e ainda assim "na capital"
  });

  it('interior servido pela capital do próprio estado: ONE_STATE', () => {
    const framing = framingFor({ city: 'Picos', state: 'PI' });
    expect(framing.mode).toBe('ONE_STATE');
    expect(framing.ufs).toEqual(['PI']);
    expect(framing.target?.reference.name).toBe('Teresina');
  });

  // Caso real medido em 04/08/2026: 238 km até Palmas contra 900 km até Belém.
  it('interior mais perto da capital vizinha: TWO_STATES, na ordem lead → alvo', () => {
    const framing = framingFor({ city: 'Santana do Araguaia', state: 'PA' });
    expect(framing.mode).toBe('TWO_STATES');
    expect(framing.ufs).toEqual(['PA', 'TO']);
    expect(framing.target?.reference.name).toBe('Palmas');
    expect(framing.target!.km).toBeLessThan(framing.sameStateTarget!.km);
  });

  it('em TWO_STATES, guarda a capital do próprio estado para o rótulo comparativo', () => {
    const framing = framingFor({ city: 'Santana do Araguaia', state: 'PA' });
    expect(framing.sameStateTarget?.reference.name).toBe('Belém');
    expect(Math.round(framing.target!.km)).toBeLessThan(400);
    expect(Math.round(framing.sameStateTarget!.km)).toBeGreaterThan(700);
  });
});

describe('computeFraming — quando não há o que medir', () => {
  it('sem UF: NO_DATA', () => {
    const framing = framingFor({});
    expect(framing.mode).toBe('NO_DATA');
    expect(framing.ufs).toEqual([]);
    expect(framing.target).toBeNull();
  });

  it('só UF: STATE_ONLY, desenha o estado sem linha', () => {
    const framing = framingFor({ state: 'PI' });
    expect(framing.mode).toBe('STATE_ONLY');
    expect(framing.ufs).toEqual(['PI']);
    expect(framing.target).toBeNull();
  });

  it('bairro no lugar da cidade: STATE_ONLY, não inventa ponto', () => {
    const framing = framingFor({ city: 'Botafogo', state: 'RJ' });
    expect(framing.mode).toBe('STATE_ONLY');
    expect(framing.ufs).toEqual(['RJ']);
  });

  it('sem referência nenhuma cadastrada: STATE_ONLY', () => {
    const location = resolveLeadLocation({ city: 'Picos', state: 'PI' }, index);
    expect(computeFraming(location, []).mode).toBe('STATE_ONLY');
  });
});

describe('computeFraming — parâmetros', () => {
  it('o raio de "está na referência" é ajustável', () => {
    // Picos fica a ~250 km de Teresina: com raio de 300 km, conta como "na capital".
    expect(framingFor({ city: 'Picos', state: 'PI' }).mode).toBe('ONE_STATE');
    expect(framingFor({ city: 'Picos', state: 'PI' }, { atReferenceRadiusKm: 300 }).mode)
      .toBe('AT_REFERENCE');
  });

  it('lista as alternativas em ordem de distância, respeitando o limite', () => {
    const framing = framingFor({ city: 'Picos', state: 'PI' });
    expect(framing.alternatives).toHaveLength(3);
    const kms = framing.alternatives.map((a) => a.km);
    expect([...kms].sort((a, b) => a - b)).toEqual(kms);
    expect(framing.alternatives[0]).toEqual(framing.target);

    expect(framingFor({ city: 'Picos', state: 'PI' }, { alternativesLimit: 1 }).alternatives)
      .toHaveLength(1);
  });

  it('marca empate quando a segunda colocada está dentro da margem', () => {
    const twins: ReferencePoint[] = [
      { key: 'a', name: 'A', uf: 'PI', kind: 'capital', point: { lat: -7.0, lng: -41.0 } },
      { key: 'b', name: 'B', uf: 'CE', kind: 'capital', point: { lat: -7.0, lng: -42.05 } },
    ];
    const location = resolveLeadLocation({ city: 'Picos', state: 'PI' }, index);

    expect(computeFraming(location, twins).tie).toBe(true);
    expect(computeFraming(location, twins, { tieMarginPct: 1 }).tie).toBe(false);
  });

  it('considera bases próprias, não só capitais', () => {
    const office: ReferencePoint = {
      key: 'ref:escritorio-picos',
      name: 'Escritório Picos',
      uf: 'PI',
      kind: 'office',
      point: { lat: -7.0589, lng: -41.5223 },
    };
    const location = resolveLeadLocation({ city: 'Picos', state: 'PI' }, index);
    const framing = computeFraming(location, [...references, office]);

    expect(framing.mode).toBe('AT_REFERENCE');
    expect(framing.target?.reference.kind).toBe('office');
  });
});

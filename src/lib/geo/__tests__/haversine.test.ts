import { describe, expect, it } from 'vitest';
import { haversineKm } from '../haversine';

/**
 * Aferido contra propriedades geométricas verificáveis (arcos exatos da esfera
 * de raio 6371 km), não contra a saída da própria função.
 */
describe('haversineKm', () => {
  it('é zero para o mesmo ponto', () => {
    expect(haversineKm({ lat: -5.1027, lng: -42.7406 }, { lat: -5.1027, lng: -42.7406 })).toBe(0);
  });

  it('é simétrica', () => {
    const a = { lat: -23.6501, lng: -46.6481 };
    const b = { lat: -22.9255, lng: -43.458 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('um quarto do equador = 2πR/4 ≈ 10.007 km', () => {
    const quarter = (2 * Math.PI * 6371) / 4;
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo(quarter, 3);
  });

  it('polo a polo = πR ≈ 20.015 km', () => {
    expect(haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })).toBeCloseTo(Math.PI * 6371, 3);
  });

  it('1 grau de latitude ≈ 111,2 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });

  it('São Paulo–Rio de Janeiro fica na faixa conhecida de ~360 km em linha reta', () => {
    const km = haversineKm({ lat: -23.6501, lng: -46.6481 }, { lat: -22.9255, lng: -43.458 });
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(390);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import ufShapes from '../data/uf-malhas.json';
import { clearShapeCache, projectUfs, projectUfsCached, type UfShapes } from '../shapes';
import { UFS } from '../uf';

const shapes = ufShapes as unknown as UfShapes;

beforeEach(() => clearShapeCache());

describe('asset de malhas', () => {
  it('cobre as 27 UFs', () => {
    for (const uf of UFS) {
      expect(shapes[uf], uf).toBeDefined();
      expect(shapes[uf].rings.length, uf).toBeGreaterThan(0);
    }
  });

  it('todo anel é fechável e tem pontos suficientes para virar polígono', () => {
    for (const uf of UFS) {
      for (const ring of shapes[uf].rings) {
        expect(ring.length, uf).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('o bbox contém todos os pontos do estado', () => {
    for (const uf of UFS) {
      const [minLng, minLat, maxLng, maxLat] = shapes[uf].bbox;
      for (const ring of shapes[uf].rings) {
        for (const [lng, lat] of ring) {
          expect(lng, uf).toBeGreaterThanOrEqual(minLng);
          expect(lng, uf).toBeLessThanOrEqual(maxLng);
          expect(lat, uf).toBeGreaterThanOrEqual(minLat);
          expect(lat, uf).toBeLessThanOrEqual(maxLat);
        }
      }
    }
  });
});

describe('projectUfs', () => {
  it('gera um path por UF pedida', () => {
    const projected = projectUfs(['PI'], shapes, 100);
    expect(projected.paths).toHaveLength(1);
    expect(projected.paths[0].uf).toBe('PI');
    expect(projected.paths[0].d.startsWith('M')).toBe(true);
    expect(projected.paths[0].d.endsWith('Z')).toBe(true);
  });

  it('mantém tudo dentro do quadro', () => {
    for (const uf of UFS) {
      const projected = projectUfs([uf], shapes, 100);
      const numbers = projected.paths[0].d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (const n of numbers) {
        expect(n, uf).toBeGreaterThanOrEqual(0);
        expect(n, uf).toBeLessThanOrEqual(100);
      }
    }
  });

  it('projeta o extremo norte acima do extremo sul', () => {
    // y do SVG cresce para baixo: latitude maior tem de dar y menor.
    const projected = projectUfs(['PI'], shapes, 100);
    const [, minLat, , maxLat] = shapes.PI.bbox;
    const norte = projected.project({ lat: maxLat, lng: -42 });
    const sul = projected.project({ lat: minLat, lng: -42 });
    expect(norte.y).toBeLessThan(sul.y);
  });

  it('projeta o leste à direita do oeste', () => {
    const projected = projectUfs(['PI'], shapes, 100);
    const [minLng, , maxLng] = shapes.PI.bbox;
    expect(projected.project({ lat: -7, lng: maxLng }).x)
      .toBeGreaterThan(projected.project({ lat: -7, lng: minLng }).x);
  });

  it('não achata o estado: a proporção segue a da região, corrigida pela latitude', () => {
    const projected = projectUfs(['PI'], shapes, 100);
    const [minLng, minLat, maxLng, maxLat] = shapes.PI.bbox;
    const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const razaoReal = ((maxLng - minLng) * cos) / (maxLat - minLat);

    const xs = projected.project({ lat: -7, lng: maxLng }).x - projected.project({ lat: -7, lng: minLng }).x;
    const ys = projected.project({ lat: minLat, lng: -42 }).y - projected.project({ lat: maxLat, lng: -42 }).y;

    expect(xs / ys).toBeCloseTo(razaoReal, 5);
  });

  it('com duas UFs, enquadra as duas juntas', () => {
    const projected = projectUfs(['PA', 'TO'], shapes, 100);
    expect(projected.paths.map((p) => p.uf)).toEqual(['PA', 'TO']);

    // O ponto de Palmas/TO tem de cair dentro do quadro, e não fora dele.
    const palmas = projected.project({ lat: -10.2202, lng: -48.1521 });
    expect(palmas.x).toBeGreaterThanOrEqual(0);
    expect(palmas.x).toBeLessThanOrEqual(100);
    expect(palmas.y).toBeGreaterThanOrEqual(0);
    expect(palmas.y).toBeLessThanOrEqual(100);
  });

  it('UF inexistente não quebra', () => {
    const projected = projectUfs(['ZZ' as never], shapes, 100);
    expect(projected.paths).toEqual([]);
    expect(projected.project({ lat: 0, lng: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('projectUfsCached', () => {
  it('devolve a mesma instância para a mesma chave', () => {
    const a = projectUfsCached(['PI'], shapes, 20);
    const b = projectUfsCached(['PI'], shapes, 20);
    expect(b).toBe(a);
  });

  it('separa por tamanho e por conjunto de UFs', () => {
    const base = projectUfsCached(['PI'], shapes, 20);
    expect(projectUfsCached(['PI'], shapes, 28)).not.toBe(base);
    expect(projectUfsCached(['PI', 'MA'], shapes, 20)).not.toBe(base);
  });
});

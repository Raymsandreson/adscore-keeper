import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ufShapes from '../data/uf-malhas.json';
import { fetchMunicipalityShape, shapesToGeoJson, ufsToGeoJson } from '../ibgeMalhas';
import type { UfShapes } from '../shapes';

const shapes = ufShapes as unknown as UfShapes;

const polygon = (coords: [number, number][]) => ({
  features: [{ geometry: { type: 'Polygon', coordinates: [coords] } }],
});

// Códigos distintos por teste: o cache é global de propósito (vale pela sessão).
let nextCode = 9000001;
const freshCode = () => nextCode++;

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMunicipalityShape', () => {
  it('converte o GeoJSON do IBGE em contorno com bbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => polygon([[-42, -5], [-41, -5], [-41, -6], [-42, -6], [-42, -5]]),
    }));

    const shape = await fetchMunicipalityShape(freshCode());

    expect(shape?.rings).toHaveLength(1);
    expect(shape?.bbox).toEqual([-42, -6, -41, -5]);
  });

  it('achata MultiPolygon em vários anéis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [[[-42, -5], [-41, -5], [-41, -6], [-42, -5]]],
              [[[-40, -3], [-39, -3], [-39, -4], [-40, -3]]],
            ],
          },
        }],
      }),
    }));

    const shape = await fetchMunicipalityShape(freshCode());
    expect(shape?.rings).toHaveLength(2);
  });

  it('busca uma vez só: a segunda chamada vem do cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => polygon([[-42, -5], [-41, -5], [-41, -6], [-42, -5]]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const code = freshCode();
    await fetchMunicipalityShape(code);
    await fetchMunicipalityShape(code);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não dispara requisições paralelas para o mesmo município', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => polygon([[-42, -5], [-41, -5], [-41, -6], [-42, -5]]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const code = freshCode();
    await Promise.all([fetchMunicipalityShape(code), fetchMunicipalityShape(code)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persiste em sessionStorage para a próxima abertura da ficha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => polygon([[-42, -5], [-41, -5], [-41, -6], [-42, -5]]),
    }));

    const code = freshCode();
    await fetchMunicipalityShape(code);

    expect(sessionStorage.getItem(`geo:malha:mun:${code}`)).toBeTruthy();
  });

  // Município novo devolve 500 na API do IBGE — é falta de malha, não erro nosso.
  it('devolve null quando o IBGE não tem a malha, sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchMunicipalityShape(freshCode())).resolves.toBeNull();
  });

  it('devolve null quando a rede falha, sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchMunicipalityShape(freshCode())).resolves.toBeNull();
  });

  it('geometria vazia vira null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
    await expect(fetchMunicipalityShape(freshCode())).resolves.toBeNull();
  });
});

describe('conversão para GeoJSON', () => {
  it('monta FeatureCollection com uma feature por UF', () => {
    const geojson = ufsToGeoJson(['PI', 'MA'], shapes);

    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(2);
    expect(geojson.features.map((f) => f.properties!.uf)).toEqual(['PI', 'MA']);
    expect(geojson.features[0].geometry.type).toBe('MultiPolygon');
  });

  it('ignora UF sem malha em vez de gerar feature vazia', () => {
    expect(ufsToGeoJson(['PI', 'ZZ' as never], shapes).features).toHaveLength(1);
  });

  it('envelopa cada anel como polígono próprio', () => {
    const shape = { bbox: [-42, -6, -41, -5] as [number, number, number, number], rings: [[[-42, -5]] as [number, number][]] };
    const geojson = shapesToGeoJson([{ uf: 'PI', shape }]);
    expect((geojson.features[0].geometry as GeoJSON.MultiPolygon).coordinates).toEqual([[[[-42, -5]]]]);
  });
});

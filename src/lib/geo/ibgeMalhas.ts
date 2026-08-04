import type { UfShape, UfShapes } from './shapes';
import type { Uf } from './types';

/**
 * Malha (contorno) de um município, buscada no IBGE sob demanda.
 *
 * Diferente das UFs — que vêm embarcadas porque o kanban desenha uma por card —
 * a malha municipal só é necessária no painel da ficha, um município por vez.
 * Embarcar os 5.571 contornos custaria alguns MB para quase nunca serem usados.
 */

const MALHA_URL = (ibgeCode: number) =>
  `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${ibgeCode}?formato=application/vnd.geo+json`;

const STORAGE_PREFIX = 'geo:malha:mun:';

const memory = new Map<number, UfShape | null>();
const inFlight = new Map<number, Promise<UfShape | null>>();

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

function toShape(geojson: { features?: { geometry: GeoJsonGeometry }[] }): UfShape | null {
  const rings: [number, number][][] = [];

  for (const feature of geojson.features ?? []) {
    const { type, coordinates } = feature.geometry;
    if (type === 'Polygon') {
      rings.push((coordinates as [number, number][][])[0]);
    } else if (type === 'MultiPolygon') {
      for (const polygon of coordinates as [number, number][][][]) rings.push(polygon[0]);
    }
  }

  if (rings.length === 0) return null;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return { bbox: [minLng, minLat, maxLng, maxLat], rings };
}

function readCache(ibgeCode: number): UfShape | null | undefined {
  if (memory.has(ibgeCode)) return memory.get(ibgeCode);

  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${ibgeCode}`);
    if (raw) {
      const shape = JSON.parse(raw) as UfShape;
      memory.set(ibgeCode, shape);
      return shape;
    }
  } catch {
    // sessionStorage indisponível (modo privado, cota): segue sem cache.
  }

  return undefined;
}

/**
 * Contorno do município, ou `null` quando o IBGE não tem malha publicada.
 *
 * Município novo devolve HTTP 500 na API (é o caso de Boa Esperança do Norte/MT),
 * por isso a falha é tratada como "não existe" em vez de erro — o painel só
 * deixa de preencher o município e continua desenhando o estado.
 */
export async function fetchMunicipalityShape(ibgeCode: number): Promise<UfShape | null> {
  const cached = readCache(ibgeCode);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(ibgeCode);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(MALHA_URL(ibgeCode));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const shape = toShape(await response.json());
      memory.set(ibgeCode, shape);
      try {
        if (shape) sessionStorage.setItem(`${STORAGE_PREFIX}${ibgeCode}`, JSON.stringify(shape));
      } catch {
        // Cota estourada: o cache em memória já resolve a sessão.
      }
      return shape;
    } catch {
      // Não persiste a falha: pode ser rede, e a próxima abertura tenta de novo.
      memory.set(ibgeCode, null);
      return null;
    } finally {
      inFlight.delete(ibgeCode);
    }
  })();

  inFlight.set(ibgeCode, request);
  return request;
}

/** Converte contornos para GeoJSON, que é o formato que o Leaflet consome. */
export function shapesToGeoJson(
  entries: { uf: Uf | string; shape: UfShape }[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map(({ uf, shape }) => ({
      type: 'Feature',
      properties: { uf },
      geometry: {
        type: 'MultiPolygon',
        coordinates: shape.rings.map((ring) => [ring]),
      },
    })),
  };
}

/** Atalho para montar o GeoJSON das UFs a partir do asset embarcado. */
export function ufsToGeoJson(ufs: Uf[], shapes: UfShapes): GeoJSON.FeatureCollection {
  return shapesToGeoJson(ufs.filter((uf) => shapes[uf]).map((uf) => ({ uf, shape: shapes[uf] })));
}

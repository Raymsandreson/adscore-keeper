import type { LatLng } from './types';

/** Raio médio da Terra, em km (esfera de referência da IUGG). */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Distância em linha reta entre dois pontos, em quilômetros.
 *
 * É o que decide qual referência é a mais próxima e, portanto, o enquadramento
 * do mapa. Não é distância de estrada: no Brasil a rodoviária costuma ficar
 * 20–40% acima. Para o número real existe o cálculo sob demanda (Fase 4).
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

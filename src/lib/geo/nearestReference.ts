import { haversineKm } from './haversine';
import type { LatLng, ReferenceDistance, ReferencePoint, Uf } from './types';

/** Referências ordenadas da mais próxima para a mais distante. */
export function rankReferences(
  point: LatLng,
  references: readonly ReferencePoint[],
): ReferenceDistance[] {
  return references
    .map((reference) => ({ reference, km: haversineKm(point, reference.point) }))
    .sort((a, b) => a.km - b.km);
}

/** A referência mais próxima, ou `null` se a lista estiver vazia. */
export function nearestReference(
  point: LatLng,
  references: readonly ReferencePoint[],
): ReferenceDistance | null {
  let best: ReferenceDistance | null = null;

  for (const reference of references) {
    const km = haversineKm(point, reference.point);
    if (!best || km < best.km) best = { reference, km };
  }

  return best;
}

/** A referência mais próxima dentro de uma UF — sustenta o rótulo comparativo do modo TWO_STATES. */
export function nearestReferenceInUf(
  point: LatLng,
  references: readonly ReferencePoint[],
  uf: Uf,
): ReferenceDistance | null {
  return nearestReference(point, references.filter((r) => r.uf === uf));
}

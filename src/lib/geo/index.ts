/**
 * Camada geográfica de leads — Fase 1 do escopo (docs/escopo-mapa-regiao-leads.md).
 *
 * Tudo aqui é puro e síncrono, exceto `loadMunicipalityIndex`, que existe só
 * para manter os 275 KB do dataset do IBGE fora do bundle principal.
 */

import { createMunicipalityIndex, type MunicipalityIndex, type MunicipalityRow } from './municipalities';
import { buildCapitalReferences } from './capitals';
import type { UfShapes } from './shapes';
import type { ReferencePoint } from './types';

export type {
  Framing,
  FramingMode,
  LatLng,
  LeadLocation,
  LocationConfidence,
  LocationSource,
  LocationWarning,
  Municipality,
  ReferenceDistance,
  ReferenceKind,
  ReferencePoint,
  Uf,
} from './types';

export { haversineKm } from './haversine';
export { UFS, UF_NAMES, normalizeName, normalizeUf } from './uf';
export {
  createMunicipalityIndex,
  findMunicipality,
  type MunicipalityIndex,
  type MunicipalityMatch,
  type MunicipalityRow,
} from './municipalities';
export { CAPITAL_IBGE_CODES, buildCapitalReferences, capitalKey } from './capitals';
export {
  partnerKey,
  resolvePartnerReferences,
  type PartnerContactRow,
  type PartnerReference,
  type PartnerResolution,
} from './partners';
export { resolveLeadLocation, type LocatableLead, type ResolveOptions } from './resolveLeadLocation';
export {
  clearShapeCache,
  projectUfs,
  projectUfsCached,
  type ProjectedShapes,
  type UfShape,
  type UfShapes,
} from './shapes';
export { nearestReference, nearestReferenceInUf, rankReferences } from './nearestReference';
export { computeFraming, type FramingOptions } from './framingMode';

let cachedIndex: MunicipalityIndex | null = null;
let pendingIndex: Promise<MunicipalityIndex> | null = null;

/**
 * Carrega o índice dos 5.571 municípios do IBGE, uma vez por sessão.
 *
 * O dataset é gerado por `scripts/build-geo-dataset.mjs` e vem por import
 * dinâmico: o Vite o separa em chunk próprio, então quem nunca abre um mapa
 * nunca baixa os 275 KB.
 */
export function loadMunicipalityIndex(): Promise<MunicipalityIndex> {
  if (cachedIndex) return Promise.resolve(cachedIndex);

  if (!pendingIndex) {
    pendingIndex = import('./data/municipios.json')
      .then((module) => {
        const rows = ((module as { default?: unknown }).default ?? module) as MunicipalityRow[];
        cachedIndex = createMunicipalityIndex(rows);
        return cachedIndex;
      })
      .catch((error) => {
        // Sem isto, uma falha de rede deixaria a promise rejeitada em cache e
        // toda tentativa seguinte falharia junto, mesmo com a rede de volta.
        pendingIndex = null;
        throw error;
      });
  }

  return pendingIndex;
}

/** As 27 capitais, prontas para `computeFraming`. */
export async function loadCapitalReferences(): Promise<ReferencePoint[]> {
  return buildCapitalReferences(await loadMunicipalityIndex());
}

let cachedShapes: UfShapes | null = null;
let pendingShapes: Promise<UfShapes> | null = null;

/**
 * Carrega a silhueta das 27 UFs (85 KB), uma vez por sessão.
 *
 * Gerado por `scripts/build-geo-malhas.mjs`. Vem embarcado, e não do IBGE em
 * runtime, porque o kanban desenha uma silhueta por card: buscar por card seriam
 * 100+ requests a cada rolagem.
 */
export function loadUfShapes(): Promise<UfShapes> {
  if (cachedShapes) return Promise.resolve(cachedShapes);

  if (!pendingShapes) {
    pendingShapes = import('./data/uf-malhas.json')
      .then((module) => {
        cachedShapes = ((module as { default?: unknown }).default ?? module) as UfShapes;
        return cachedShapes;
      })
      .catch((error) => {
        pendingShapes = null;
        throw error;
      });
  }

  return pendingShapes;
}

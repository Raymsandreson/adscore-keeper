import { findMunicipality, type MunicipalityIndex } from './municipalities';
import type { LeadLocation, LocationWarning, Municipality } from './types';
import { normalizeName, normalizeUf } from './uf';

/** Só o que a resolução precisa — qualquer objeto de lead com estes campos serve. */
export interface LocatableLead {
  city?: string | null;
  state?: string | null;
  visit_city?: string | null;
  visit_state?: string | null;
  lead_lat?: number | null;
  lead_lng?: number | null;
}

const EMPTY_LOCATION: LeadLocation = {
  uf: null,
  municipality: null,
  point: null,
  confidence: 'none',
  source: 'none',
  warnings: [{ type: 'no_data' }],
};

const isUsableCoord = (lat?: number | null, lng?: number | null): boolean =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  // (0,0) fica no Atlântico, na costa da África: é sujeira de geocoding, não Brasil.
  !(lat === 0 && lng === 0);

/**
 * Resolve onde o lead está, a partir do que o cadastro tem.
 *
 * Precedência (§4.1 do escopo):
 *   1. `lead_lat`/`lead_lng`      — 21% dos leads; posição mais precisa que existe
 *   2. `city` + `state`           — centroide do município
 *   3. `visit_city`/`visit_state` — só quando `city` está vazio (+285 leads)
 *   4. `city` sem UF, nome único no país
 *   5. só `state`                 — desenha o estado, sem ponto
 *   6. nada
 *
 * Nunca inventa posição: quando o dado é ambíguo ou inconsistente, devolve o
 * aviso correspondente e deixa a decisão para quem edita o cadastro.
 */
export interface ResolveOptions {
  /**
   * Qual endereço manda quando o lead tem os dois preenchidos.
   *
   * `'city'` (padrão) é o endereço do cadastro, em 6.095 leads. `'visit'` é o
   * local da visita/acidente, em 847 — e é o que o card do kanban já exibe
   * (`DynamicKanbanBoard.tsx:1102`). Quem desenha ao lado daquele texto passa
   * `'visit'`, senão o card mostra uma cidade escrita e outra no mapa. São 55
   * leads em que os dois campos divergem.
   */
  prefer?: 'city' | 'visit';
}

export function resolveLeadLocation(
  lead: LocatableLead,
  index: MunicipalityIndex,
  options: ResolveOptions = {},
): LeadLocation {
  const preferVisit = options.prefer === 'visit';
  const warnings: LocationWarning[] = [];

  // O cadastro tem 58 leads com city e visit_city diferentes. A resolução segue
  // `city`, mas o conflito precisa aparecer na tela — pode ser endereço do
  // cliente contra local do acidente, e aí quem decide é quem atende.
  const city = lead.city?.trim() || '';
  const visitCity = lead.visit_city?.trim() || '';
  if (city && visitCity && normalizeName(city) !== normalizeName(visitCity)) {
    warnings.push({ type: 'city_visit_divergence', city, visitCity });
  }

  const usesVisit = preferVisit ? !!visitCity : !city && !!visitCity;
  const rawCity = usesVisit ? visitCity : city;
  const rawUf = usesVisit ? lead.visit_state : lead.state;
  const source = usesVisit ? 'visit_city' : 'city';

  const match = findMunicipality(index, rawCity, rawUf);
  let municipality: Municipality | null = null;
  let matchedByName = false;

  switch (match.status) {
    case 'exact':
    case 'alias':
      municipality = match.municipality;
      break;
    case 'inferred':
      municipality = match.municipality;
      matchedByName = true;
      break;
    case 'ambiguous':
      warnings.push({
        type: 'ambiguous_city',
        city: rawCity,
        possibleUfs: match.candidates.map((c) => c.uf),
      });
      break;
    case 'uf_mismatch':
      warnings.push({
        type: 'uf_mismatch',
        city: rawCity,
        informedUf: match.informedUf,
        possibleUfs: match.candidates.map((c) => c.uf),
      });
      break;
    case 'unknown':
      if (rawCity) warnings.push({ type: 'unknown_city', city: rawCity });
      break;
  }

  if (municipality && !municipality.center) {
    warnings.push({
      type: 'municipality_without_center',
      city: municipality.name,
      uf: municipality.uf,
    });
  }

  const uf = municipality?.uf ?? normalizeUf(rawUf) ?? normalizeUf(lead.state) ?? normalizeUf(lead.visit_state);

  // A coordenada do lead vence como posição, mas o município continua valendo
  // como rótulo e — o que importa mais — como origem da UF do enquadramento.
  if (isUsableCoord(lead.lead_lat, lead.lead_lng)) {
    return {
      uf: uf ?? null,
      municipality,
      point: { lat: lead.lead_lat as number, lng: lead.lead_lng as number },
      confidence: 'coordinate',
      source: 'lead_coords',
      warnings,
    };
  }

  if (municipality?.center) {
    return {
      uf: municipality.uf,
      municipality,
      point: municipality.center,
      confidence: matchedByName ? 'inferred' : 'municipality',
      source,
      warnings,
    };
  }

  if (uf) {
    return {
      uf,
      municipality,
      point: null,
      confidence: 'uf',
      source: 'state',
      warnings,
    };
  }

  return { ...EMPTY_LOCATION, warnings: warnings.length ? warnings : EMPTY_LOCATION.warnings };
}

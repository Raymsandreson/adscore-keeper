import type { Municipality, Uf } from './types';
import { normalizeName, normalizeUf } from './uf';

/** Formato compacto do dataset gerado por `scripts/build-geo-dataset.mjs`. */
export type MunicipalityRow = [
  ibgeCode: number,
  name: string,
  uf: string,
  lat: number | null,
  lng: number | null,
];

export interface MunicipalityIndex {
  byIbgeCode: Map<number, Municipality>;
  /** Chave `UF|nome normalizado`. */
  byUfAndName: Map<string, Municipality>;
  /** Nome normalizado → municípios homônimos em UFs diferentes. */
  byName: Map<string, Municipality[]>;
  size: number;
}

/**
 * Apelidos que aparecem no campo cidade do CRM em volume suficiente para valer
 * a pena resolver. Só entram casos sem ambiguidade real — bairros como
 * "Botafogo" ou "Morumbi" ficam de fora de propósito: adivinhar o município a
 * partir de um bairro é palpite, e palpite aqui vira distância errada na tela.
 *
 * `uf: null` significa que o apelido vale mesmo sem UF cadastrada.
 */
const ALIASES: { alias: string; uf: Uf | null; ibgeCode: number }[] = [
  { alias: 'rio', uf: 'RJ', ibgeCode: 3304557 }, // 11 leads
  { alias: 'rio', uf: null, ibgeCode: 3304557 }, // 5 leads sem UF
  { alias: 'rio de janeiro rj', uf: null, ibgeCode: 3304557 },
  { alias: 'bh', uf: 'MG', ibgeCode: 3106200 }, // 3 leads
  { alias: 'bh', uf: null, ibgeCode: 3106200 },
  { alias: 'belo horizonte mg', uf: null, ibgeCode: 3106200 },
  { alias: 'campos', uf: 'RJ', ibgeCode: 3301009 }, // Campos dos Goytacazes, 3 leads
  { alias: 'sao paulo sp', uf: null, ibgeCode: 3550308 },
  { alias: 'poa', uf: 'RS', ibgeCode: 4314902 },
  { alias: 'bsb', uf: 'DF', ibgeCode: 5300108 },
];

/** Brasília — único município do DF (Taguatinga, Ceilândia etc. são regiões administrativas). */
const BRASILIA_IBGE_CODE = 5300108;

export function createMunicipalityIndex(rows: MunicipalityRow[]): MunicipalityIndex {
  const byIbgeCode = new Map<number, Municipality>();
  const byUfAndName = new Map<string, Municipality>();
  const byName = new Map<string, Municipality[]>();

  for (const [ibgeCode, name, rawUf, lat, lng] of rows) {
    const uf = normalizeUf(rawUf);
    if (!uf) continue;

    const municipality: Municipality = {
      ibgeCode,
      name,
      uf,
      center: lat != null && lng != null ? { lat, lng } : null,
    };

    const key = normalizeName(name);
    byIbgeCode.set(ibgeCode, municipality);
    byUfAndName.set(`${uf}|${key}`, municipality);

    const homonyms = byName.get(key);
    if (homonyms) homonyms.push(municipality);
    else byName.set(key, [municipality]);
  }

  return { byIbgeCode, byUfAndName, byName, size: byIbgeCode.size };
}

export type MunicipalityMatch =
  /** Casou cidade + UF. */
  | { status: 'exact'; municipality: Municipality }
  /** Casou por apelido conhecido ou pela regra do DF. */
  | { status: 'alias'; municipality: Municipality }
  /** Sem UF no cadastro e o nome só existe em um estado. */
  | { status: 'inferred'; municipality: Municipality }
  /** Sem UF e o nome existe em vários estados. */
  | { status: 'ambiguous'; candidates: Municipality[] }
  /** A cidade existe, mas não na UF informada — cadastro inconsistente. */
  | { status: 'uf_mismatch'; informedUf: Uf; candidates: Municipality[] }
  /** Não é município. */
  | { status: 'unknown' };

/**
 * Casa o texto livre de cidade com um município do IBGE.
 *
 * Aferido em 04/08/2026 contra os 6.095 leads com cidade preenchida: 96,7%
 * casam como `exact`. O resto se divide entre bairro/sigla (`unknown`),
 * UF errada (`uf_mismatch`) e cidade sem UF (`inferred`/`ambiguous`).
 */
export function findMunicipality(
  index: MunicipalityIndex,
  rawCity: string | null | undefined,
  rawUf: string | null | undefined,
): MunicipalityMatch {
  const city = normalizeName(rawCity);
  const uf = normalizeUf(rawUf);

  if (!city) return { status: 'unknown' };

  if (uf) {
    const exact = index.byUfAndName.get(`${uf}|${city}`);
    if (exact) return { status: 'exact', municipality: exact };
  }

  const alias =
    ALIASES.find((a) => a.alias === city && a.uf === uf) ??
    ALIASES.find((a) => a.alias === city && a.uf === null);
  if (alias) {
    const municipality = index.byIbgeCode.get(alias.ibgeCode);
    if (municipality) return { status: 'alias', municipality };
  }

  // O DF tem um município só. Qualquer região administrativa cadastrada como
  // cidade (Taguatinga, Ceilândia, Itapoã, Planaltina...) resolve para Brasília.
  if (uf === 'DF') {
    const brasilia = index.byIbgeCode.get(BRASILIA_IBGE_CODE);
    if (brasilia) return { status: 'alias', municipality: brasilia };
  }

  const homonyms = index.byName.get(city);
  if (!homonyms || homonyms.length === 0) return { status: 'unknown' };

  if (uf) return { status: 'uf_mismatch', informedUf: uf, candidates: homonyms };
  if (homonyms.length === 1) return { status: 'inferred', municipality: homonyms[0] };
  return { status: 'ambiguous', candidates: homonyms };
}

import type { MunicipalityIndex } from './municipalities';
import type { ReferencePoint, Uf } from './types';

/**
 * Código IBGE da capital de cada UF.
 *
 * Só os códigos ficam aqui — nome e coordenada saem do dataset do IBGE, para
 * não existirem duas versões da mesma coordenada no repo. Um teste confere que
 * os 27 códigos existem e estão na UF certa.
 */
export const CAPITAL_IBGE_CODES: Record<Uf, number> = {
  AC: 1200401, // Rio Branco
  AL: 2704302, // Maceió
  AP: 1600303, // Macapá
  AM: 1302603, // Manaus
  BA: 2927408, // Salvador
  CE: 2304400, // Fortaleza
  DF: 5300108, // Brasília
  ES: 3205309, // Vitória
  GO: 5208707, // Goiânia
  MA: 2111300, // São Luís
  MT: 5103403, // Cuiabá
  MS: 5002704, // Campo Grande
  MG: 3106200, // Belo Horizonte
  PA: 1501402, // Belém
  PB: 2507507, // João Pessoa
  PR: 4106902, // Curitiba
  PE: 2611606, // Recife
  PI: 2211001, // Teresina
  RJ: 3304557, // Rio de Janeiro
  RN: 2408102, // Natal
  RS: 4314902, // Porto Alegre
  RO: 1100205, // Porto Velho
  RR: 1400100, // Boa Vista
  SC: 4205407, // Florianópolis
  SP: 3550308, // São Paulo
  SE: 2800308, // Aracaju
  TO: 1721000, // Palmas
};

/** Chave de referência de uma capital — também é a chave do cache de rota (Fase 4). */
export const capitalKey = (uf: Uf): string => `capital:${uf}`;

/** As 27 capitais como pontos de referência. Bases próprias entram depois, na Fase 4. */
export function buildCapitalReferences(index: MunicipalityIndex): ReferencePoint[] {
  const references: ReferencePoint[] = [];

  for (const [uf, ibgeCode] of Object.entries(CAPITAL_IBGE_CODES) as [Uf, number][]) {
    const municipality = index.byIbgeCode.get(ibgeCode);
    if (!municipality?.center) continue;

    references.push({
      key: capitalKey(uf),
      name: municipality.name,
      uf,
      kind: 'capital',
      point: municipality.center,
      ibgeCode,
    });
  }

  return references;
}

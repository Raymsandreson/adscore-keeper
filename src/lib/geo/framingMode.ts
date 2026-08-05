import { nearestReferenceInUf, rankReferences } from './nearestReference';
import type { Framing, LeadLocation, ReferencePoint } from './types';

export interface FramingOptions {
  /**
   * Abaixo desta distância o lead é tratado como estando *na* referência, e a
   * tela não mostra "0 km até a capital".
   *
   * Padrão 5 km, medido do centroide do município. Numa região metropolitana
   * pode fazer sentido subir para ~30 km ("é grande São Paulo") — decisão em
   * aberto no §13 do escopo, por isso é parâmetro e não constante.
   */
  atReferenceRadiusKm?: number;
  /** Diferença percentual abaixo da qual a segunda colocada conta como empate. */
  tieMarginPct?: number;
  /** Quantas referências devolver em `alternatives`. */
  alternativesLimit?: number;
}

const DEFAULTS = {
  atReferenceRadiusKm: 5,
  tieMarginPct: 10,
  alternativesLimit: 3,
} as const;

const NO_DATA: Framing = {
  mode: 'NO_DATA',
  ufs: [],
  target: null,
  alternatives: [],
  sameStateTarget: null,
  tie: false,
};

/**
 * Decide como a pré-visualização deve ser enquadrada.
 *
 * A regra que motiva a feature: **um** estado quando a referência mais próxima
 * é do próprio estado do lead, **dois** quando é de outro. Medido em 04/08/2026
 * sobre os leads geocodificados: 87,5% caem em AT_REFERENCE (já estão na
 * capital) e, entre os de interior, 22,1% caem em TWO_STATES.
 */
export function computeFraming(
  location: LeadLocation,
  references: readonly ReferencePoint[],
  options: FramingOptions = {},
): Framing {
  const { atReferenceRadiusKm, tieMarginPct, alternativesLimit } = { ...DEFAULTS, ...options };

  if (!location.uf) return NO_DATA;

  // UF conhecida mas sem ponto: dá para desenhar o estado, não para medir nada.
  // Cai aqui a cidade não reconhecida (bairro, sigla) e o lead que só tem UF.
  if (!location.point) {
    return {
      mode: 'STATE_ONLY',
      ufs: [location.uf],
      target: null,
      alternatives: [],
      sameStateTarget: null,
      tie: false,
    };
  }

  const ranked = rankReferences(location.point, references);
  const target = ranked[0] ?? null;

  if (!target) {
    return {
      mode: 'STATE_ONLY',
      ufs: [location.uf],
      target: null,
      alternatives: [],
      sameStateTarget: null,
      tie: false,
    };
  }

  const alternatives = ranked.slice(0, alternativesLimit);
  const runnerUp = ranked[1];
  const tie = !!runnerUp && target.km > 0 && (runnerUp.km - target.km) / target.km * 100 < tieMarginPct;
  const sameStateTarget = nearestReferenceInUf(location.point, references, location.uf);

  // O município do lead É o da referência: está lá, ponto final. Vale mais que o
  // raio porque o ponto do lead (geocodificado no centro urbano) e o da referência
  // (centroide da *área* do município, que é o que o IBGE publica) não coincidem —
  // em Teresina dá ~7 km, em São Paulo ~11 km, e municípios extensos vão além.
  // Só o raio classificaria como "interior" quem mora na capital.
  const sameMunicipality =
    location.municipality != null &&
    target.reference.ibgeCode != null &&
    location.municipality.ibgeCode === target.reference.ibgeCode;

  if (sameMunicipality || target.km <= atReferenceRadiusKm) {
    return {
      mode: 'AT_REFERENCE',
      ufs: [location.uf],
      target,
      alternatives,
      sameStateTarget,
      tie,
    };
  }

  if (target.reference.uf === location.uf) {
    return { mode: 'ONE_STATE', ufs: [location.uf], target, alternatives, sameStateTarget, tie };
  }

  return {
    mode: 'TWO_STATES',
    ufs: [location.uf, target.reference.uf],
    target,
    alternatives,
    sameStateTarget,
    tie,
  };
}

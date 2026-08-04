import type { Framing, LeadLocation } from './types';
import { UF_NAMES } from './uf';

/** Distância legível: sem casas decimais e com separador de milhar do pt-BR. */
export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString('pt-BR')} km`;
}

/**
 * Rótulo curto, do tamanho de um badge de card.
 *
 * Exemplos: `PI · Teresina`, `PI · Picos, 251 km de Teresina`,
 * `PA · Santana do Araguaia, 238 km de Palmas/TO`.
 */
export function describeFramingShort(location: LeadLocation, framing: Framing): string {
  if (framing.mode === 'NO_DATA') return 'Sem localização';

  const place = location.municipality?.name ?? UF_NAMES[location.uf!];
  const prefix = location.uf ? `${location.uf} · ` : '';

  switch (framing.mode) {
    case 'STATE_ONLY':
      return `${prefix}${place}`;
    case 'AT_REFERENCE':
      return `${prefix}${place}`;
    case 'ONE_STATE':
      return `${prefix}${place}, ${formatKm(framing.target!.km)} de ${framing.target!.reference.name}`;
    case 'TWO_STATES':
      return `${prefix}${place}, ${formatKm(framing.target!.km)} de ${framing.target!.reference.name}/${framing.target!.reference.uf}`;
  }
}

/**
 * Texto de tooltip: explica *por que* a referência escolhida é aquela. No modo
 * de dois estados, sem a comparação, a capital de outro estado parece erro.
 */
export function describeFramingLong(location: LeadLocation, framing: Framing): string {
  if (framing.mode === 'NO_DATA') {
    return 'Lead sem cidade ou estado no cadastro.';
  }

  const place = location.municipality
    ? `${location.municipality.name}/${location.municipality.uf}`
    : UF_NAMES[location.uf!];

  if (framing.mode === 'STATE_ONLY') {
    const unknown = location.warnings.find((w) => w.type === 'unknown_city');
    if (unknown) return `${place} — "${unknown.city}" não é um município reconhecido.`;
    return `${place} — sem cidade no cadastro.`;
  }

  const target = framing.target!;

  if (framing.mode === 'AT_REFERENCE') {
    return target.reference.kind === 'capital'
      ? `${place} é a capital do estado.`
      : `${place} — mesma cidade de ${target.reference.name}.`;
  }

  if (framing.mode === 'ONE_STATE') {
    return `${place} fica a ${formatKm(target.km)} de ${target.reference.name}, a referência mais próxima.`;
  }

  const sameState = framing.sameStateTarget;
  const comparison = sameState
    ? ` A capital do próprio estado, ${sameState.reference.name}, fica a ${formatKm(sameState.km)}.`
    : '';

  return `${place} fica a ${formatKm(target.km)} de ${target.reference.name}/${target.reference.uf}, em outro estado.${comparison}`;
}

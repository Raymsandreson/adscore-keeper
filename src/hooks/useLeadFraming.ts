import { useMemo } from 'react';
import { computeFraming, resolveLeadLocation } from '@/lib/geo';
import type { Framing, LeadLocation, LocatableLead } from '@/lib/geo';
import { describeFramingLong, describeFramingShort } from '@/lib/geo/describeFraming';
import { useGeoIndex } from './useGeoIndex';

export interface LeadFraming {
  location: LeadLocation;
  framing: Framing;
  /** Rótulo curto, para badge. */
  short: string;
  /** Texto explicativo, para tooltip. */
  long: string;
}

/**
 * Resolve a localização do lead e o enquadramento do mapa.
 *
 * Devolve `null` enquanto os dados geográficos carregam e quando o lead não tem
 * localização alguma — nos dois casos quem chama simplesmente não desenha.
 */
export function useLeadFraming(
  lead: LocatableLead | null | undefined,
  prefer: 'city' | 'visit' = 'city',
): LeadFraming | null {
  const geo = useGeoIndex();

  return useMemo(() => {
    if (!geo || !lead) return null;

    const location = resolveLeadLocation(lead, geo.index, { prefer });
    const framing = computeFraming(location, geo.references);
    if (framing.mode === 'NO_DATA') return null;

    return {
      location,
      framing,
      short: describeFramingShort(location, framing),
      long: describeFramingLong(location, framing),
    };
  }, [geo, lead, prefer]);
}

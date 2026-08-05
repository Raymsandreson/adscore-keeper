import { useEffect, useState } from 'react';
import {
  loadCapitalReferences,
  loadMunicipalityIndex,
  loadUfShapes,
  type MunicipalityIndex,
  type ReferencePoint,
  type UfShapes,
} from '@/lib/geo';

export interface GeoIndex {
  index: MunicipalityIndex;
  references: ReferencePoint[];
  shapes: UfShapes;
}

let cached: GeoIndex | null = null;
let pending: Promise<GeoIndex> | null = null;

function load(): Promise<GeoIndex> {
  if (cached) return Promise.resolve(cached);

  if (!pending) {
    pending = Promise.all([loadMunicipalityIndex(), loadCapitalReferences(), loadUfShapes()])
      .then(([index, references, shapes]) => {
        cached = { index, references, shapes };
        return cached;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }

  return pending;
}

/**
 * Dá acesso aos dados geográficos (municípios, capitais e silhuetas das UFs).
 *
 * Os ~360 KB entram por import dinâmico e ficam num cache de módulo: os 100+
 * cards de um board compartilham o mesmo carregamento, e quem nunca abre uma
 * tela com mapa nunca baixa nada. Enquanto não chega, `geo` é `null` e quem
 * chama simplesmente não desenha.
 */
export function useGeoIndex(): GeoIndex | null {
  const [geo, setGeo] = useState<GeoIndex | null>(cached);

  useEffect(() => {
    if (cached) return;

    let active = true;
    load()
      .then((loaded) => {
        if (active) setGeo(loaded);
      })
      .catch((error) => {
        console.error('[useGeoIndex] falha ao carregar dados geográficos', error);
      });

    return () => {
      active = false;
    };
  }, []);

  return geo;
}

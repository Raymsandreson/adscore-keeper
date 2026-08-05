import { useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import {
  loadMunicipalityIndex,
  resolvePartnerReferences,
  type PartnerContactRow,
  type PartnerResolution,
} from '@/lib/geo';

/**
 * A classificação vive em dois lugares: `classification` (legado, um valor) e
 * `classifications` (array, multi-classificação). Um contato pode estar só num
 * dos dois, então a busca cobre os dois.
 */
const PARTNER_FILTER = 'classification.eq.partner,classifications.cs.{"partner"}';

const EMPTY: PartnerResolution = { references: [], unresolved: 0 };

let cached: PartnerResolution | null = null;
let pending: Promise<PartnerResolution> | null = null;

function load(): Promise<PartnerResolution> {
  if (cached) return Promise.resolve(cached);

  if (!pending) {
    pending = (async () => {
      await ensureExternalSession();

      const [{ data, error }, index] = await Promise.all([
        db
          .from('contacts')
          .select('id, full_name, city, state')
          .is('deleted_at', null)
          .or(PARTNER_FILTER),
        loadMunicipalityIndex(),
      ]);

      if (error) throw error;

      cached = resolvePartnerReferences(index, (data || []) as PartnerContactRow[]);
      return cached;
    })().catch((error) => {
      // Sem isto a promise rejeitada ficaria em cache e nenhuma tentativa
      // posterior funcionaria, mesmo com a rede de volta.
      pending = null;
      throw error;
    });
  }

  return pending;
}

/**
 * Os parceiros da firma como pontos de referência do mapa.
 *
 * São 19 contatos hoje, então cabe carregar todos de uma vez e guardar num
 * cache de módulo: uma consulta por sessão, independentemente de quantas fichas
 * de lead forem abertas. Enquanto não chega, devolve a lista vazia — o painel
 * simplesmente não desenha a camada.
 */
export function usePartnerReferences(): PartnerResolution {
  const [partners, setPartners] = useState<PartnerResolution>(cached ?? EMPTY);

  useEffect(() => {
    if (cached) return;

    let active = true;
    load()
      .then((loaded) => {
        if (active) setPartners(loaded);
      })
      .catch((error) => {
        console.warn('[usePartnerReferences] parceiros não carregaram:', error?.message || error);
      });

    return () => {
      active = false;
    };
  }, []);

  return partners;
}

/** Só para teste: descarta o cache de módulo entre casos. */
export function clearPartnerCache() {
  cached = null;
  pending = null;
}

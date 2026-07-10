import { useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { oabKey } from '@/utils/clientPoloDetection';

/**
 * Carrega, uma vez, o conjunto de OABs dos usuários do escritório
 * (profile_oab_entries) como chaves "<numero>-<UF>" para casar com os
 * advogados dos processos e detectar automaticamente o polo do cliente.
 */
export function useSystemOabs(): Set<string> {
  const [oabSet, setOabSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await externalSupabase
          .from('profile_oab_entries')
          .select('oab_number, oab_uf');
        if (cancelled) return;
        const s = new Set<string>();
        for (const row of (data as any[]) || []) {
          const k = oabKey(row.oab_number, row.oab_uf);
          if (k) s.add(k);
        }
        setOabSet(s);
      } catch {
        /* silencioso — sem OABs, cai no padrão ATIVO */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return oabSet;
}

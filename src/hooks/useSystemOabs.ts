import { externalSupabase } from '@/integrations/supabase/external-client';
import { oabKey } from '@/utils/clientPoloDetection';
import { useSharedFetch } from '@/lib/sharedFetch';

const EMPTY: Set<string> = new Set();

/**
 * Carrega, uma vez, o conjunto de OABs dos usuários do escritório
 * (profile_oab_entries) como chaves "<numero>-<UF>" para casar com os
 * advogados dos processos e detectar automaticamente o polo do cliente.
 *
 * Compartilhado entre instâncias (src/lib/sharedFetch.ts): o ProcessDetailSheet
 * monta um por caso na lista de /cases, e cada instância disparava a própria
 * requisição.
 */
export function useSystemOabs(): Set<string> {
  const { data } = useSharedFetch<Set<string>>(
    'system_oabs',
    async () => {
      const { data, error } = await externalSupabase
        .from('profile_oab_entries')
        .select('oab_number, oab_uf');
      if (error) throw error; // sem OABs, cai no padrão ATIVO
      const s = new Set<string>();
      for (const row of (data as any[]) || []) {
        const k = oabKey(row.oab_number, row.oab_uf);
        if (k) s.add(k);
      }
      return s;
    },
    EMPTY,
  );
  return data;
}

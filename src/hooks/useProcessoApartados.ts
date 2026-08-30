// =============================================================================
// Os autos APARTADOS de um processo — execução provisória, carta de sentença.
//
// Por que existe (30/08/2026): a execução provisória corre em autos próprios,
// com CNJ próprio e rito próprio, mas é o mesmo dinheiro e o mesmo cliente.
// Medido na base no dia: dos 3 apartados cadastrados, um tem o ACORDO e a
// EXECUÇÃO que o processo principal não tem (0000755-26.2026.5.13.0034), e
// outro entra na carteira como processo novo em "Ajuizamento" enquanto o
// principal carrega os 8 valores e o trânsito (0001308-57.2025.5.22.0002).
//
// O QUE ESTE HOOK NÃO FAZ, DE PROPÓSITO: trazer os marcos do filho para dentro
// da régua da mãe. Estação do apartado na linha do principal moveria a fase e o
// percentual dele — a armadilha "estado virando fase" que custou 61 processos
// em julho. Aqui vem a FASE ATUAL de cada apartado, como cartão ao lado da
// régua; a régua do filho continua inteira na ficha do filho.
//
// Fonte: RPC `pop_processo_apartados` no Externo (migration 20260830120000).
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

export interface ApartadoDoProcesso {
  process_id: string;
  process_number: string | null;
  titulo: string | null;
  classe: string | null;
  /** execucao_provisoria | carta_sentenca | incidente | conexo */
  vinculo_tipo: string | null;
  marco_atual: string | null;
  marco_em: string | null;
  marcos: number;
}

export const VINCULO_LABEL: Record<string, string> = {
  execucao_provisoria: 'execução provisória',
  carta_sentenca: 'carta de sentença',
  incidente: 'incidente',
  conexo: 'conexo',
};

export function useProcessoApartados(processId?: string | null) {
  const [apartados, setApartados] = useState<ApartadoDoProcesso[]>([]);
  const [loading, setLoading] = useState(false);

  const carregar = useCallback(async () => {
    if (!processId) {
      setApartados([]);
      return;
    }
    setLoading(true);
    try {
      // Sessão anônima do Externo: sem ela a RLS devolve zero linha em silêncio.
      await ensureExternalSession();
      const { data, error } = await (externalSupabase.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => PromiseLike<{ data?: ApartadoDoProcesso[] | null; error?: { message?: string } | null }>)(
        'pop_processo_apartados',
        { p_process_id: processId },
      );
      if (error) {
        console.warn('[useProcessoApartados] pop_processo_apartados:', error.message);
        setApartados([]);
        return;
      }
      setApartados(data || []);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => { void carregar(); }, [carregar]);

  return { apartados, loading, recarregar: carregar };
}

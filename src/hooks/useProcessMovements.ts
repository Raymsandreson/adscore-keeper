import { useState, useEffect, useCallback } from 'react';
import { db } from '@/integrations/supabase';

export type MarcoTipo =
  | 'peticao_inicial'
  | 'sentenca_1grau'
  | 'acordo'
  | 'acordao_2grau'
  | 'acordao_superior'
  | 'transito_julgado'
  | 'pagamento';

/**
 * Linha do histórico append-only (tabela process_movements no Supabase externo).
 * Cada marco relevante é uma linha independente — o mais recente por
 * data_movimentacao representa o status atual do processo.
 */
export interface ProcessMovement {
  id: string;
  process_id: string;
  case_id: string | null;
  lead_id: string | null;
  numero_cnj: string | null;
  tipo_movimentacao: MarcoTipo;
  marco_ordem: number | null;
  data_movimentacao: string;
  valor_indenizacao_fixado: number | null;
  link_decisao: string | null;
  descricao: string | null;
  fonte: string | null;
  created_at: string;
}

/**
 * Busca os marcos de um processo, ordenados do mais recente pro mais antigo.
 * O item [0] é o status atual. Histórico completo = lista inteira.
 */
export function useProcessMovements(processId?: string) {
  const [movements, setMovements] = useState<ProcessMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMovements = useCallback(async () => {
    if (!processId) {
      setMovements([]);
      return;
    }
    setLoading(true);
    try {
      // process_movements ainda não está no types.ts gerado — cast local
      // (mesmo padrão do escavadorMovementUtils até regenerar os tipos).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data, error } = await client
        .from('process_movements')
        .select('*')
        .eq('process_id', processId)
        .order('data_movimentacao', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMovements((data || []) as ProcessMovement[]);
    } catch (e) {
      console.error('Error fetching process movements:', e);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  return { movements, loading, refetch: fetchMovements };
}

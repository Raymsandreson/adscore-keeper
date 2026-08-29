import { useState, useEffect, useCallback } from 'react';
import { db } from '@/integrations/supabase';

export type MarcoTipo =
  | 'peticao_inicial'
  | 'audiencia_conciliacao'
  | 'pericia'
  | 'audiencia_instrucao'
  | 'sentenca_1grau'
  | 'acordo'
  | 'acordao_2grau'
  | 'acordao_superior'
  | 'transito_julgado'
  | 'cumprimento_sentenca'
  | 'precatorio_rpv'
  | 'pagamento';

/**
 * Linha do histórico append-only (process_movements no Supabase externo, lida
 * pela view process_movements_validos, que exclui as descartadas).
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
 *
 * escopo 'caso' (com caseId): traz os marcos de TODOS os processos do caso —
 * usado pra linha unificada quando há processos conexos (principal + agravo,
 * recurso destrancado, execução etc.).
 */
export function useProcessMovements(
  processId?: string,
  opts?: { escopo?: 'processo' | 'caso'; caseId?: string | null },
) {
  const [movements, setMovements] = useState<ProcessMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const escopo = opts?.escopo === 'caso' && opts?.caseId ? 'caso' : 'processo';
  const caseId = opts?.caseId || null;

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
      // process_movements_validos, não a tabela crua: a linha descartada pela
      // revisão por IA (descartado_em preenchido) tem que sair de TODAS as
      // leituras — é o que a migração 20260805190000 estabeleceu, e a régua era
      // a única leitura que ainda lia a tabela direto. Efeito visível: o
      // 0016527-69.2021.5.16.0018 mostrava "Sentença em 14/04/2026", que é uma
      // alteração de classe processual descartada em 06/08/2026; a sentença de
      // verdade é 11/06/2026 (e a peça publicada nessa data comprova).
      let query = client.from('process_movements_validos').select('*');
      if (escopo === 'caso' && caseId) query = query.eq('case_id', caseId);
      else query = query.eq('process_id', processId);
      const { data, error } = await query
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
  }, [processId, escopo, caseId]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  return { movements, loading, refetch: fetchMovements };
}

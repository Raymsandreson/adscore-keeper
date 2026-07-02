import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';

/**
 * Marco processual retornado pela action `extrair_marcos` da edge search-escavador.
 * O parsing (fase 1: keyword + regex) vive em supabase/functions/_shared/escavadorMarcos.ts.
 */
export interface MarcoExtraido {
  tipo_movimentacao: string;
  marco_ordem: number;
  data_movimentacao: string | null;
  valor_indenizacao_fixado: number | null;
  link_decisao: string | null;
  descricao: string | null;
  escavador_movimentacao_id: string | null;
  conteudo_hash: string;
}

export interface SyncMarcosParams {
  processId: string;
  numeroCnj: string;
  caseId?: string | null;
  leadId?: string | null;
  /** Se já temos as movimentações no client, passa direto (evita refetch no Escavador). */
  movimentacoes?: unknown[];
}

/**
 * Extrai os marcos das movimentações (via edge function) e grava o histórico
 * append-only em process_movements. Idempotente: upsert com ignoreDuplicates
 * sobre o índice único (process_id, tipo_movimentacao, conteudo_hash).
 * Retorna a quantidade de marcos processados (linhas enviadas ao banco).
 */
export const syncProcessMarcos = async (params: SyncMarcosParams): Promise<number> => {
  const { processId, numeroCnj, caseId, leadId, movimentacoes } = params;
  if (!processId || !numeroCnj) return 0;

  const { data, error } = await cloudFunctions.invoke('search-escavador', {
    body: {
      action: 'extrair_marcos',
      numero_cnj: numeroCnj,
      movimentacoes: movimentacoes && movimentacoes.length ? movimentacoes : undefined,
    },
  });

  if (error || !data?.success) {
    console.error('Error extracting marcos:', error || data?.error);
    return 0;
  }

  const marcos: MarcoExtraido[] = data.data?.marcos ?? [];
  if (!marcos.length) return 0;

  const rows = marcos.map((m) => ({
    process_id: processId,
    case_id: caseId ?? null,
    lead_id: leadId ?? null,
    numero_cnj: numeroCnj,
    tipo_movimentacao: m.tipo_movimentacao,
    marco_ordem: m.marco_ordem,
    data_movimentacao: m.data_movimentacao,
    valor_indenizacao_fixado: m.valor_indenizacao_fixado,
    link_decisao: m.link_decisao,
    descricao: m.descricao,
    escavador_movimentacao_id: m.escavador_movimentacao_id,
    conteudo_hash: m.conteudo_hash,
    fonte: 'escavador',
  }));

  // NOTE: process_movements é nova e ainda não está no types.ts gerado.
  // Cast local até o types.ts ser regenerado (supabase gen types).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any;
  const { error: insErr } = await client
    .from('process_movements')
    .upsert(rows, {
      onConflict: 'process_id,tipo_movimentacao,conteudo_hash',
      ignoreDuplicates: true,
    });

  if (insErr) {
    console.error('Error inserting process_movements:', insErr);
    return 0;
  }

  console.log(`Synced ${rows.length} marcos for process ${processId} (${numeroCnj})`);
  return rows.length;
};

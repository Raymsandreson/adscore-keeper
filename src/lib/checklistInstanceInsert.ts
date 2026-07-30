// =============================================================================
// Inserção tolerante a duplicata em lead_checklist_instances.
//
// POR QUÊ: createLeadInstances (useChecklists) e o CaseWorkflowBoard criam as
// instâncias com SELECT-existentes → INSERT, sem constraint no banco. Duas abas
// abertas no mesmo lead — ou dois assessores ao mesmo tempo — passam pelo SELECT
// antes de qualquer INSERT e ambas inserem: é a origem das cópias do mesmo
// objetivo na mesma fase (25% da tabela em jul/2026).
//
// A correção definitiva é o índice único (process_id/lead_id, board_id,
// stage_id, checklist_template_id). Mas `upsert(onConflict)` só funciona DEPOIS
// que o índice existe, e entre a migration e o publish do front haveria uma
// janela em que todo insert quebra. Este helper fecha a janela: funciona igual
// com ou sem índice, então pode ser publicado ANTES da migration.
//
// Detalhe que motiva o retry linha a linha: `insert` em lote é uma transação —
// se UMA linha colide, o lote inteiro aborta e as demais se perdem.
// =============================================================================

/** unique_violation do Postgres. */
const DUPLICATE_KEY = '23505';

export interface TolerantInsertResult {
  inserted: number;
  /** Linhas que já existiam (corrida) — não são erro. */
  skipped: number;
}

/**
 * Insere as instâncias ignorando as que já existem. Erro que não seja colisão
 * de chave sobe para o chamador tratar.
 */
export async function insertChecklistInstancesTolerant(
  // O client varia por origem (db-routing vs externalSupabase) e a tabela ainda
  // não está tipada no types.ts gerado — mesmo cast local usado no resto do repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  rows: Record<string, unknown>[],
): Promise<TolerantInsertResult> {
  if (!rows || rows.length === 0) return { inserted: 0, skipped: 0 };

  const { error } = await client.from('lead_checklist_instances').insert(rows);
  if (!error) return { inserted: rows.length, skipped: 0 };
  if (error.code !== DUPLICATE_KEY) throw error;

  // O lote abortou por colisão: reinsere uma a uma para salvar as que não colidem.
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const { error: rowError } = await client.from('lead_checklist_instances').insert(row);
    if (!rowError) {
      inserted++;
      continue;
    }
    if (rowError.code === DUPLICATE_KEY) {
      skipped++;
      continue;
    }
    throw rowError;
  }
  return { inserted, skipped };
}

import { describe, it, expect } from 'vitest';
import { insertChecklistInstancesTolerant } from '../checklistInstanceInsert';

/**
 * Client fake: `colidem` são as linhas (por checklist_template_id) que o banco
 * rejeita com 23505, simulando a corrida entre duas abas.
 */
function makeClient(colidem: string[]) {
  const tentativas: unknown[][] = [];
  const client = {
    from() {
      return {
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          tentativas.push(rows);
          const bateu = rows.some(r => colidem.includes(String(r.checklist_template_id)));
          // Postgres aborta o lote inteiro quando qualquer linha colide.
          return Promise.resolve(bateu ? { error: { code: '23505', message: 'duplicate key' } } : { error: null });
        },
      };
    },
  };
  return { client, tentativas };
}

const rows = [
  { lead_id: 'l1', checklist_template_id: 't1' },
  { lead_id: 'l1', checklist_template_id: 't2' },
  { lead_id: 'l1', checklist_template_id: 't3' },
];

describe('insertChecklistInstancesTolerant', () => {
  it('insere o lote inteiro numa tacada quando não há colisão', async () => {
    const { client, tentativas } = makeClient([]);
    const res = await insertChecklistInstancesTolerant(client, rows);
    expect(res).toEqual({ inserted: 3, skipped: 0 });
    expect(tentativas).toHaveLength(1); // sem retry
  });

  it('salva as não-duplicadas quando o lote aborta por colisão', async () => {
    const { client, tentativas } = makeClient(['t2']);
    const res = await insertChecklistInstancesTolerant(client, rows);
    // t1 e t3 entram no retry linha a linha; t2 é pulada.
    expect(res).toEqual({ inserted: 2, skipped: 1 });
    expect(tentativas).toHaveLength(4); // 1 lote + 3 individuais
  });

  it('não chama o banco com lista vazia', async () => {
    const { client, tentativas } = makeClient([]);
    const res = await insertChecklistInstancesTolerant(client, []);
    expect(res).toEqual({ inserted: 0, skipped: 0 });
    expect(tentativas).toHaveLength(0);
  });

  it('propaga erro que não seja colisão de chave', async () => {
    const client = {
      from: () => ({
        insert: () => Promise.resolve({ error: { code: '42501', message: 'permission denied' } }),
      }),
    };
    await expect(insertChecklistInstancesTolerant(client, rows)).rejects.toMatchObject({ code: '42501' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O guard é a rede que cobre as ~27 rotas de INSERT/UPDATE em `leads` que
 * montam payload sem passar por sanitizeLeadDateFields. Testa contra um
 * client falso com a mesma superfície do supabase-js.
 */
const calls: Array<{ table: string; method: string; values: unknown }> = [];

const makeBuilder = (table: string) => ({
  insert: (values: unknown) => { calls.push({ table, method: 'insert', values }); return { select: () => ({ single: async () => ({}) }) }; },
  update: (values: unknown) => { calls.push({ table, method: 'update', values }); return { eq: () => ({}) }; },
  upsert: (values: unknown) => { calls.push({ table, method: 'upsert', values }); return { select: () => ({}) }; },
  select: () => ({}),
});

vi.mock('../external-client', () => ({
  externalSupabase: { from: (table: string) => makeBuilder(table) },
}));

const { externalSupabase } = await import('../external-client');
const { installLeadDateGuard } = await import('../install-lead-date-guard');

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  installLeadDateGuard(); // idempotente
});

describe('installLeadDateGuard', () => {
  it('sanitiza INSERT em leads mesmo sem o call site chamar o sanitizador', () => {
    externalSupabase.from('leads').insert({ lead_name: 'x', accident_date: '2024' });
    expect(calls[0].values).toEqual({ lead_name: 'x', accident_date: null });
  });

  it('sanitiza UPDATE e UPSERT em leads', () => {
    externalSupabase.from('leads').update({ expected_birth_date: '2024' });
    externalSupabase.from('leads').upsert({ became_client_date: '2024-XX-XX' });
    expect(calls[0].values).toEqual({ expected_birth_date: null });
    expect(calls[1].values).toEqual({ became_client_date: null });
  });

  it('preserva datas completas', () => {
    externalSupabase.from('leads').insert({ accident_date: '01/01/2024' });
    expect(calls[0].values).toEqual({ accident_date: '2024-01-01' });
  });

  it('não interfere em outras tabelas', () => {
    externalSupabase.from('contacts').insert({ birth_date: '2024' });
    expect(calls[0].values).toEqual({ birth_date: '2024' });
  });
});

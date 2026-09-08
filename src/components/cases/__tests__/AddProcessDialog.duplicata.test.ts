/**
 * Por que este teste existe:
 *
 * O aviso "N processo(s) já vinculado(s) ou com erro" juntava duas coisas
 * diferentes — duplicata e falha de gravação — e não dizia ONDE o processo já
 * estava. Foi assim que o 0811547-57.2026.8.10.0060 pareceu "não vincular" ao
 * CASO-934: ele já estava no CASO 398, um caso duplicado do mesmo cliente.
 *
 * O que aqui não pode quebrar:
 *  1. o caso dono precisa vir NOMEADO (é a única pista que a pessoa tem);
 *  2. dono == caso atual tem que soar diferente de dono == outro caso;
 *  3. a checagem não pode virar N+1 (a busca marca a lista inteira de uma vez);
 *  4. falha na checagem tem que ESTOURAR, nunca devolver "livre" — devolver
 *     livre em silêncio grava o mesmo processo em dois casos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeClient, setRows, resetRows, fromCalls, failTable } = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const state = { fromCalls: [] as string[], failTable: null as string | null };

  const chain = (table: string): any => {
    const p: any = Promise.resolve(
      state.failTable === table
        ? { data: null, error: { message: 'permission denied for table ' + table } }
        : { data: rows[table] ?? [], error: null },
    );
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
        }
        return () => chain(table);
      },
      apply: () => chain(table),
    });
  };

  return {
    fromCalls: state.fromCalls,
    failTable: (t: string | null) => { state.failTable = t; },
    setRows: (table: string, data: unknown[]) => { rows[table] = data; },
    resetRows: () => {
      for (const k of Object.keys(rows)) delete rows[k];
      state.fromCalls.length = 0;
      state.failTable = null;
    },
    fakeClient: {
      from: (table: string) => { state.fromCalls.push(table); return chain(table); },
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: () => chain('__rpc'),
      channel: () => { const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
      removeChannel: () => {},
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: fakeClient }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase', () => ({
  db: fakeClient, authClient: fakeClient, supabase: fakeClient,
  externalSupabase: fakeClient, ensureExternalSession: async () => {},
}));
vi.mock('@/lib/lovableCloudFunctions', () => ({ cloudFunctions: { invoke: vi.fn() } }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { fetchOwnerCases, ownerPhrase } from '@/components/cases/AddProcessDialog';

const CASO_ATUAL = 'e9541f6b-60ec-49a9-b779-81b12ce974c3';
const CASO_398 = '734683f8-124a-4651-9bdc-f6057b7eb62d';
const CNJ = '0811547-57.2026.8.10.0060';

beforeEach(() => resetRows());

describe('fetchOwnerCases — quem já detém o processo', () => {
  it('processo livre não aparece no mapa', async () => {
    setRows('lead_processes', []);
    const map = await fetchOwnerCases([CNJ], CASO_ATUAL);
    expect(map.size).toBe(0);
  });

  it('processo em OUTRO caso volta nomeado pelo número do caso', async () => {
    setRows('lead_processes', [{ process_number: CNJ, case_id: CASO_398 }]);
    setRows('legal_cases', [{ id: CASO_398, case_number: 'CASO 398', title: 'Charles x Porto Rico' }]);

    const owner = (await fetchOwnerCases([CNJ], CASO_ATUAL)).get(CNJ)!;
    expect(owner.isCurrent).toBe(false);
    expect(owner.label).toBe('CASO 398');
    expect(ownerPhrase(owner)).toBe('já está no CASO 398');
  });

  it('processo no PRÓPRIO caso soa diferente de processo em outro caso', async () => {
    setRows('lead_processes', [{ process_number: CNJ, case_id: CASO_ATUAL }]);
    setRows('legal_cases', [{ id: CASO_ATUAL, case_number: 'CASO-934', title: 'Charles x Porto Rico' }]);

    const owner = (await fetchOwnerCases([CNJ], CASO_ATUAL)).get(CNJ)!;
    expect(owner.isCurrent).toBe(true);
    expect(ownerPhrase(owner)).toBe('já está neste caso');
  });

  it('caso sem número cai no título, nunca em rótulo vazio', async () => {
    setRows('lead_processes', [{ process_number: CNJ, case_id: CASO_398 }]);
    setRows('legal_cases', [{ id: CASO_398, case_number: null, title: 'Charles x Porto Rico' }]);

    const owner = (await fetchOwnerCases([CNJ], CASO_ATUAL)).get(CNJ)!;
    expect(owner.label).toBe('Charles x Porto Rico');
  });

  it('marca a lista inteira em 2 queries — nada de N+1', async () => {
    const numeros = ['1', '2', '3', '4', '5'];
    setRows('lead_processes', numeros.map(n => ({ process_number: n, case_id: CASO_398 })));
    setRows('legal_cases', [{ id: CASO_398, case_number: 'CASO 398', title: 'x' }]);

    const map = await fetchOwnerCases(numeros, CASO_ATUAL);
    expect(map.size).toBe(5);
    expect(fromCalls).toEqual(['lead_processes', 'legal_cases']);
  });

  it('lista vazia não vai ao banco', async () => {
    expect((await fetchOwnerCases([], CASO_ATUAL)).size).toBe(0);
    expect(fromCalls).toEqual([]);
  });

  it('falha na checagem ESTOURA — devolver "livre" duplicaria o processo', async () => {
    failTable('lead_processes');
    await expect(fetchOwnerCases([CNJ], CASO_ATUAL)).rejects.toThrow(/não foi possível checar/i);
  });
});

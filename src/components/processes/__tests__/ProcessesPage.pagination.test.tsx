/**
 * Regressão do teto de 1.000 linhas do PostgREST na aba Processos.
 *
 * `loadProcesses` buscava `lead_processes` sem `.range()`. Com 1.545 processos
 * ativos no Externo, a resposta vinha truncada em 1.000 — os 545 mais antigos
 * não apareciam na lista e, como a busca desta aba é client-side sobre o array
 * carregado, também eram inacháveis pela barra de pesquisa.
 *
 * O mock abaixo reproduz o teto: sem `.range()`, devolve no máximo as 1.000
 * primeiras linhas.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TOTAL = 1545;
const DB_MAX_ROWS = 1000;

const { fakeClient, rows } = vi.hoisted(() => {
  const TOTAL = 1545;
  const DB_MAX_ROWS = 1000;
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    id: `proc-${i}`,
    title: `Processo ${i}`,
    process_number: `${String(i).padStart(7, '0')}-00.2026.5.02.0001`,
    process_type: 'judicial',
    status: 'active',
    situacao: null,
    tribunal_sigla: 'TRT2',
    classe: null,
    polo_ativo: null,
    polo_passivo: null,
    data_distribuicao: null,
    data_ultima_movimentacao: null,
    case_id: `case-${i}`,
    lead_id: `lead-${i}`,
    valor_causa_formatado: null,
    created_at: '2026-01-01T00:00:00Z',
    legal_cases: { case_number: `000${i}`, title: `Caso ${i}` },
  }));

  const chain = (table: string): any => {
    // Sem .range(), o PostgREST aplica db-max-rows: 0..999.
    const state = { from: 0, to: DB_MAX_ROWS - 1 };
    const settle = () => {
      const all = table === 'lead_processes' ? rows : [];
      const slice = all.slice(state.from, Math.min(state.to + 1, state.from + DB_MAX_ROWS));
      return Promise.resolve({ data: slice, error: null });
    };
    const proxy: any = new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return (...a: unknown[]) => (settle() as any).then(...a);
        if (prop === 'catch') return (...a: unknown[]) => (settle() as any).catch(...a);
        if (prop === 'finally') return (...a: unknown[]) => (settle() as any).finally(...a);
        if (prop === 'range') return (f: number, t: number) => { state.from = f; state.to = t; return proxy; };
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: rows[0] ?? null, error: null });
        }
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };

  return {
    rows,
    fakeClient: {
      from: (table: string) => chain(table),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: () => chain('__rpc'),
      channel: () => {
        const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} };
        return ch;
      },
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
  db: fakeClient,
  authClient: fakeClient,
  supabase: fakeClient,
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: { invoke: async () => ({ data: null, error: null }) },
}));

import ProcessesPage from '@/pages/ProcessesPage';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('ProcessesPage — teto de 1.000 do PostgREST', () => {
  it('carrega os 1.545 processos, não só os 1.000 primeiros', async () => {
    expect(rows.length).toBe(TOTAL);
    expect(TOTAL).toBeGreaterThan(DB_MAX_ROWS); // senão o teste não prova nada

    render(<Wrap><ProcessesPage /></Wrap>);

    // O rodapé mostra o total carregado: "1–25 de N processo(s)".
    await waitFor(
      () => expect(screen.getByText(new RegExp(`de ${TOTAL} processo`))).toBeTruthy(),
      { timeout: 5000 },
    );

    // O processo mais antigo (índice 1544) só existe na segunda página.
    expect(screen.queryByText(new RegExp(`de ${DB_MAX_ROWS} processo`))).toBeNull();
  });
});

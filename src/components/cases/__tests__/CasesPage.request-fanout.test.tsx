/**
 * Regressão da lentidão/erros da aba Casos.
 *
 * Antes, cada item da lista montava <ProcessDetailSheet> e <ActivityFullSheet>
 * incondicionalmente. Como os hooks de configuração desses componentes rodam
 * antes de qualquer early return, cada item disparava ~5 requisições. Com os
 * 1.594 casos ativos do banco isso dava ~8.000 requisições no load da página.
 *
 * Dois invariantes cobertos aqui:
 *  1. nada de sheet montado enquanto o usuário não abre um;
 *  2. hooks de configuração compartilham uma única requisição entre instâncias.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fakeClient, counts, setRows } = vi.hoisted(() => {
  const counts: Record<string, number> = {};
  const rows: Record<string, unknown[]> = {};

  const chain = (table: string): any => {
    const p: any = Promise.resolve({ data: rows[table] ?? [], error: null });
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
    counts,
    setRows: (table: string, data: unknown[]) => { rows[table] = data; },
    fakeClient: {
      from: (table: string) => {
        counts[table] = (counts[table] ?? 0) + 1;
        return chain(table);
      },
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

import CasesPage from '@/pages/CasesPage';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useSystemOabs } from '@/hooks/useSystemOabs';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { ActivityTimerProvider } from '@/contexts/ActivityTimerContext';

const N_CASES = 60;

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <ActivityTimerProvider>{children}</ActivityTimerProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => {
  for (const k of Object.keys(counts)) delete counts[k];
});

describe('CasesPage — fan-out de requisições', () => {
  it('não monta os sheets de detalhe enquanto nada está selecionado', async () => {
    setRows('legal_cases', Array.from({ length: N_CASES }, (_, i) => ({
      id: `case-${i}`,
      case_number: `000${i}-2026`,
      title: `Caso ${i}`,
      status: 'em_andamento',
      lead_id: `lead-${i}`,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
    })));

    render(<Wrap><CasesPage /></Wrap>);
    await waitFor(() => expect(screen.getByText(/0000-2026/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/0059-2026/)).toBeTruthy());

    // profile_oab_entries só é lida pelo useSystemOabs do ProcessDetailSheet;
    // activity_field_settings só pelo ActivityFullSheet. Medido no código
    // anterior, com estes mesmos 60 casos: 60 e 60 respectivamente (mais 120
    // em activity_types e 66 em profiles) — 306 requisições no total.
    expect(counts['profile_oab_entries'] ?? 0).toBe(0);
    expect(counts['activity_field_settings'] ?? 0).toBe(0);
  });
});

function Probe() {
  useActivityTypes();
  useProfilesList();
  useSystemOabs();
  useActivityFieldSettings();
  return null;
}

describe('hooks de configuração — cache compartilhado', () => {
  it('N instâncias montadas juntas fazem 1 requisição por tabela, não N', async () => {
    const N = 50;
    // Sem o Wrap: o ActivityTimerProvider também lê `profiles`, e o contador
    // é por tabela — o ruído dele mascararia o que está sendo medido aqui.
    render(<>{Array.from({ length: N }, (_, i) => <Probe key={i} />)}</>);

    await waitFor(() => expect(counts['activity_types'] ?? 0).toBeGreaterThan(0));

    for (const table of ['activity_types', 'profiles', 'profile_oab_entries', 'activity_field_settings']) {
      expect(counts[table], `${table} deveria ser buscada uma vez, não ${counts[table]}`).toBe(1);
    }
  });
});

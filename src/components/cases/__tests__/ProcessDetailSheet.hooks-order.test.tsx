/**
 * Regressão do React #310 ("Rendered more hooks than during the previous render").
 *
 * A CasesPage mantém <ProcessDetailSheet process={selectedProcess} /> montado com
 * selectedProcess = null. Ao clicar num processo, o mesmo componente re-renderiza
 * com process != null. Se houver qualquer early return antes de um hook, o segundo
 * render executa mais hooks que o primeiro e o React derruba a página inteira.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fakeClient } = vi.hoisted(() => {
  const chain = (): any => {
    const p: any = Promise.resolve({ data: [], error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        return () => chain();
      },
      apply: () => chain(),
    });
  };
  return {
    fakeClient: {
      from: () => chain(),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: () => chain(),
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

import ProcessDetailSheet from '../ProcessDetailSheet';
import { ActivityTimerProvider } from '@/contexts/ActivityTimerContext';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>
    <MemoryRouter>
      <ActivityTimerProvider>{children}</ActivityTimerProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

const PROCESSO = {
  id: 'p-1',
  lead_id: 'l-1',
  case_id: 'c-1',
  title: 'Processo de teste',
  process_number: '0000000-00.0000.0.00.0000',
  process_type: 'judicial',
  status: 'em_andamento',
};

describe('ProcessDetailSheet — ordem de hooks', () => {
  it('não muda a contagem de hooks quando process vai de null para um processo', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });

    const props = { onOpenChange: () => {}, mode: 'dialog' as const, defaultTab: 'atividades' as const };

    const { rerender } = render(
      <Wrap>
        <ProcessDetailSheet open={false} process={null} {...props} />
      </Wrap>,
    );

    // Clique num processo na CasesPage: mesma instância, agora com dados.
    rerender(
      <Wrap>
        <ProcessDetailSheet open process={PROCESSO as never} {...props} />
      </Wrap>,
    );

    spy.mockRestore();

    const hookErrors = errors.filter((e) =>
      /Rendered more hooks|Rendered fewer hooks|Minified React error #31[0]/i.test(e),
    );
    expect(hookErrors).toEqual([]);
  });
});

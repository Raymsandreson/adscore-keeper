/**
 * Regressão: ProcessCustomFieldsForm entrava em loop infinito de fetch porque
 * `getFieldValues` (useProcessCustomFields) não era estável entre renders —
 * era dependência do useCallback/useEffect que carrega os valores.
 * Medido antes do fix: 26.007 chamadas em 1,5s. Depois: 1.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const { fakeClient, calls } = vi.hoisted(() => {
  const calls = { getFieldValues: 0 };
  const chain = (): any => {
    const p: any = Promise.resolve({ data: [], error: null });
    const h: any = new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        return () => h;
      },
      apply() {
        return h;
      },
    });
    return h;
  };
  return {
    calls,
    fakeClient: {
      from: (t: string) => {
        if (t === 'process_custom_field_values') calls.getFieldValues++;
        return chain();
      },
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

import { ProcessCustomFieldsForm } from '@/components/processes/ProcessCustomFieldsForm';

describe('ProcessCustomFieldsForm', () => {
  it('não fica em loop de fetch (efeito re-disparando a cada render)', async () => {
    render(<ProcessCustomFieldsForm processId="p1" workflowId={null} />);
    await new Promise((r) => setTimeout(r, 1500));
    console.log('chamadas a process_custom_field_values:', calls.getFieldValues);
    expect(calls.getFieldValues).toBeLessThan(5);
  }, 10000);
});

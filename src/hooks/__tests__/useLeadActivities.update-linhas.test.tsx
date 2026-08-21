/**
 * `updateActivity` tem que dizer a verdade sobre o que gravou.
 *
 * Antes de 21/08/2026 o hook fazia `.update(patch).eq('id', id)` sem `.select()`
 * e olhava só o `error`. Update que não casa linha nenhuma volta SEM erro no
 * PostgREST — então a tela mostrava "Atividade atualizada!" e devolvia `true`
 * com o trabalho perdido.
 *
 * Não é hipótese: a RLS de `lead_activities` no Externo é `auth.uid() IS NOT
 * NULL` no SELECT **e** no UPDATE, e a sessão anônima do Externo expira. Com ela
 * morta, o update vira no-op calado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { state, toastCalls, fakeClient } = vi.hoisted(() => {
  /** O que o `.select('id')` do update devolve. [] = nenhuma linha casou. */
  const state = { updateReturns: [] as Array<{ id: string }> };

  /** Cadeia PostgREST: qualquer método encadeia; o await resolve o resultado. */
  const chain = (): any => {
    const p = Promise.resolve({ data: state.updateReturns, error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: null, error: null });
        }
        return () => chain();
      },
      apply: () => chain(),
    });
  };

  return {
    state,
    toastCalls: { success: [] as string[], error: [] as string[] },
    fakeClient: {
      from: () => chain(),
      auth: { getUser: async () => ({ data: { user: { id: 'cloud-u1' } } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: () => chain(),
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => { toastCalls.success.push(m); },
    error: (m: string) => { toastCalls.error.push(m); },
    warning: () => {},
    loading: () => 'id',
    dismiss: () => {},
  },
}));

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: fakeClient }));
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  remapToExternal: async (u: string | null) => u,
  remapToCloud: async (u: string | null) => u,
  ensureRemapCache: async () => {},
}));
vi.mock('@/lib/timeOff', () => ({
  getTimeOffConflicts: async () => [],
  describeTimeOff: () => '',
}));
vi.mock('@/lib/currentExtUser', () => ({ currentExtUserId: async () => 'ext-u1' }));
vi.mock('@/hooks/useAuditLog', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: { invoke: async () => ({ data: null, error: null }) },
}));

import { useLeadActivities } from '@/hooks/useLeadActivities';

beforeEach(() => {
  toastCalls.success = [];
  toastCalls.error = [];
});

describe('updateActivity: linhas afetadas', () => {
  it('update que não casa linha nenhuma devolve false e NÃO diz que salvou', async () => {
    state.updateReturns = [];
    const { result } = renderHook(() => useLeadActivities());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.updateActivity('atv-1', { title: 'novo assunto' });
    });

    expect(ok).toBe(false);
    expect(toastCalls.success).toHaveLength(0);
    expect(toastCalls.error.join(' ')).toMatch(/Nada foi salvo/i);
  });

  it('update que casa a linha devolve true e confirma', async () => {
    state.updateReturns = [{ id: 'atv-1' }];
    const { result } = renderHook(() => useLeadActivities());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.updateActivity('atv-1', { title: 'novo assunto' });
    });

    expect(ok).toBe(true);
    expect(toastCalls.success).toHaveLength(1);
    expect(toastCalls.error).toHaveLength(0);
  });
});

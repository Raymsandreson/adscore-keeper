/**
 * Número torto no material vira PERGUNTA, não vínculo.
 *
 * Caso real de 09/09/2026: o advogado da reclamada mandou
 * "0000846-69-2025-5-08-00009" (traço no lugar do ponto, zero a mais na unidade
 * de origem). O reparo pelo dígito verificador sabe que o processo é o
 * 0000846-69.2025.5.08.0009 — mas quem amarra é o assessor. Este teste trava as
 * duas metades: a faixa aparece com os dois números, e só o clique vincula.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// O texto da mensagem é montado a partir da atividade carregada do banco; aqui o
// client é falso e não devolve linha nenhuma. O que este teste mede é a presença
// das ações, não o conteúdo da mensagem.
vi.mock('@/components/activities/buildActivityMessage', () => ({
  buildActivityMessage: () => 'mensagem',
}));

// AuthProvider de verdade abre timers de 15s e faz health-check no banco — aqui
// só interessa que `useAuthContext()` devolva um usuário.
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({
    user: { id: 'u1', email: 'u1@test.local' },
    session: null,
    profile: null,
    loading: false,
    connectionError: null,
    isOfflineMode: false,
    isAuthenticated: true,
    signUp: async () => ({}),
    signIn: async () => ({}),
    signOut: async () => ({}),
    updateProfile: async () => ({}),
    retry: () => {},
  }),
}));

import { ActivityFullSheet } from '../ActivityFullSheet';
import { ActivityTimerProvider } from '@/contexts/ActivityTimerContext';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>
    <MemoryRouter>
      <ActivityTimerProvider>{children}</ActivityTimerProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

const RASCUNHO = {
  title: 'ANALISAR PROPOSTA DE ACORDO',
  numero_a_confirmar: {
    lido: '0000846-69-2025-5-08-00009',
    achado: '0000846-69.2025.5.08.0009',
    process_id: 'proc-307',
    process_title: 'Ação de Indenização',
    case_id: 'caso-307',
    case_title: 'CASO 307',
    lead_id: 'lead-307',
    lead_name: 'FAMILIA 307',
    workflow_id: 'pop-trabalhista',
  },
};

describe('ActivityFullSheet — número a confirmar', () => {
  it('mostra os dois números e não vincula sozinho', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" draft={RASCUNHO} />
      </Wrap>,
    );

    expect(await screen.findByText('0000846-69-2025-5-08-00009')).toBeTruthy();
    expect(screen.getByText('0000846-69.2025.5.08.0009')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^É esse/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Não é esse/i })).toBeTruthy();
  });

  it('o clique do assessor é que vincula — e a faixa some', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" draft={RASCUNHO} />
      </Wrap>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^É esse/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^É esse/ })).toBeNull());
    expect(screen.queryByText('0000846-69-2025-5-08-00009')).toBeNull();
  });

  it('"Não é esse" descarta a sugestão sem vincular nada', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" draft={RASCUNHO} />
      </Wrap>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Não é esse/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^É esse/ })).toBeNull());
  });
});

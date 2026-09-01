/**
 * A ficha em aba lateral tem as MESMAS ações da tela cheia.
 *
 * Quem abria a atividade pela lista de Atividades do caso caía no
 * `ActivityFullSheet`, cuja barra de ações só tinha
 * Excluir/Cancelar/Adiar/Concluir/Salvar. Para Copiar a mensagem, Enviar ao
 * grupo, Duplicar, abrir o Chat da Equipe ou usar "Concluir + próxima" era
 * preciso clicar em "Tela cheia" e recomeçar na outra tela. Este teste trava a
 * paridade: se alguma dessas ações sair do footer, ele quebra.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('ActivityFullSheet — barra de ações', () => {
  it('traz as ações da tela cheia sem precisar de "Tela cheia"', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId="a1" />
      </Wrap>,
    );

    // Utilidades da mensagem (SendToGroupSection) + menu "Mais"
    expect(await screen.findByRole('button', { name: /Copiar/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Enviar$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mais/i })).toBeTruthy();

    // Ações principais
    expect(screen.getByRole('button', { name: /Concluir \+ próxima/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Concluir$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Salvar/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Excluir/i })).toBeTruthy();
  });

  /**
   * Cabeçalho: os botões "Atividade" (abre na tela de Atividades) e o de tela
   * cheia ficavam no fim de uma linha `nowrap` com todo botão `shrink-0`. Cada
   * ação nova no cabeçalho (Renomear, Preencher com, Financeiro, Próximos
   * passos, sino do processo, WhatsApp) empurrava a fila, e a soma passou da
   * largura da aba: os dois saíram para fora da borda direita e sumiram da tela.
   *
   * jsdom não calcula layout, então o que este teste trava é a ESTRUTURA que
   * impede o estouro: as ações moram num contêiner que quebra linha, e os botões
   * de janela num contêiner irmão que não encolhe.
   */
  it('mantém os botões de janela num grupo que não encolhe, fora da faixa que quebra linha', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId="a1" />
      </Wrap>,
    );

    const abrirNaPagina = await screen.findByTitle('Abrir na tela de Atividades');
    const telaCheia = screen.getByTitle('Expandir para tela cheia');

    const grupoJanela = abrirNaPagina.parentElement!;
    expect(telaCheia.parentElement).toBe(grupoJanela);
    expect(grupoJanela.className).toContain('shrink-0');
    expect(grupoJanela.className).not.toContain('flex-wrap');

    // A faixa das ações é irmã do grupo de janela e quebra linha quando não cabe.
    const faixaAcoes = grupoJanela.previousElementSibling as HTMLElement;
    expect(faixaAcoes.className).toContain('flex-wrap');
    expect(faixaAcoes.contains(screen.getByRole('button', { name: /Renomear/i }))).toBe(true);
  });

  it('em modo criação não mostra ações que só existem em atividade salva', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" />
      </Wrap>,
    );

    expect(await screen.findByRole('button', { name: /Criar atividade/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copiar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Concluir \+ próxima/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Excluir/i })).toBeNull();
  });
});

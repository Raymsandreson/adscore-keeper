/**
 * MODO CRIAR MOSTRA O FORMULÁRIO COMPLETO — o mesmo do print da ficha.
 *
 * O sistema tem UM formulário de atividade (`ActivityFormCompact`), e a regra
 * permanente é que não nasça um segundo, reduzido, ao lado dele. O risco não é
 * alguém escrever um formulário paralelo de propósito: é o modo criar ir
 * perdendo campo por campo até virar outro, sem ninguém notar — porque quem
 * cria não sente falta do que nunca viu.
 *
 * Este teste trava a lista de campos do modo CRIAR contra o que a ficha salva
 * mostra: assessor, tipo, fluxo/POP, observadores, situação, prioridade,
 * previsão, prazo, notificação, e os cinco campos de texto (como está, o que
 * foi feito, próximo passo, solicitação, resposta do juízo).
 *
 * O que o modo criar NÃO tem, e não deve ter: Excluir, Concluir, Adiar, enviar
 * ao grupo, abrir na tela de Atividades (travados no
 * `ActivityFullSheet.action-bar.test.tsx`) e o chat interno da equipe. Todos
 * dependem de uma atividade que já existe — o chat porque se prende a um
 * `entityId`, e ainda não há um. Não são campo; são ação ou conversa sobre
 * algo salvo, e aparecem assim que a atividade nasce.
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
vi.mock('@/components/activities/buildActivityMessage', () => ({
  buildActivityMessage: () => 'mensagem',
}));
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({
    user: { id: 'u1', email: 'u1@test.local' },
    session: null, profile: null, loading: false,
    connectionError: null, isOfflineMode: false, isAuthenticated: true,
    signUp: async () => ({}), signIn: async () => ({}), signOut: async () => ({}),
    updateProfile: async () => ({}), retry: () => {},
  }),
}));

import { ActivityFullSheet, type ActivityDraft } from '../ActivityFullSheet';
import { ActivityTimerProvider } from '@/contexts/ActivityTimerContext';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>
    <MemoryRouter>
      <ActivityTimerProvider>{children}</ActivityTimerProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

/** O rascunho que o painel do atendente virtual entrega depois do envio. */
const RASCUNHO: ActivityDraft = {
  title: 'Conferir e voltar ao cliente: valor sem lastro no processo',
  activity_type: 'acompanhamento',
  priority: 'normal',
  deadline: '2026-09-11',
  lead_id: 'lead-1',
  lead_name: 'Bianca',
  current_status_notes: 'O cliente escreveu no grupo: mas porque cada mês é um valor?',
  what_was_done: 'O atendente virtual respondeu no grupo, aprovado à mão.',
  next_steps: 'Conferir e responder ao cliente no próprio grupo.',
  action_source_detail: 'atendente-virtual:r1',
};

describe('ActivityFullSheet — modo criar traz o formulário completo', () => {
  it('mostra os mesmos campos da ficha salva', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" draft={RASCUNHO} />
      </Wrap>,
    );

    // Cabeça do formulário: quem faz, de que tipo, por qual fluxo, quem observa.
    expect(await screen.findByText(/Assessor/i)).toBeTruthy();
    expect(screen.getByText(/^Tipo/i)).toBeTruthy();
    expect(screen.getByText(/Observadores/i)).toBeTruthy();

    // Situação / prioridade / previsão — a linha de controle da esteira.
    expect(screen.getByText(/Situação/i)).toBeTruthy();
    expect(screen.getByText(/Prioridade/i)).toBeTruthy();
    expect(screen.getByText(/Previsão/i)).toBeTruthy();

    // Datas: prazo e aviso são obrigatórios na criação, e é aqui que se veem.
    expect(screen.getByText(/Prazo/i)).toBeTruthy();
    expect(screen.getByText(/Notificação/i)).toBeTruthy();

    // O chat interno da equipe fica de fora aqui, e só aqui: ele se prende ao
    // id da atividade, que ainda não existe. Aparece no primeiro Salvar.
    expect(screen.queryByText(/Chat interno da equipe/i)).toBeNull();

    // Os campos de texto da ficha, na ordem em que a equipe preenche.
    expect(screen.getByText(/Como está/i)).toBeTruthy();
    expect(screen.getByText(/O que foi feito/i)).toBeTruthy();
    expect(screen.getByText(/Próximo passo/i)).toBeTruthy();
    expect(screen.getByText(/Solicitação/i)).toBeTruthy();
    expect(screen.getByText(/Resposta do juízo/i)).toBeTruthy();
  });

  it('chega preenchido pelo rascunho, e ainda editável', async () => {
    render(
      <Wrap>
        <ActivityFullSheet open onOpenChange={() => {}} activityId={null} mode="create" draft={RASCUNHO} />
      </Wrap>,
    );

    // O assunto do rascunho vira o título da ficha — e não o "Nova atividade"
    // genérico, que é o que aparece quando o rascunho não chega.
    expect(await screen.findByText(/Conferir e voltar ao cliente/i)).toBeTruthy();
    expect(screen.queryByText('Nova atividade')).toBeNull();

    // E dá para trocar antes de criar: "Renomear" existe no modo criar.
    expect(screen.getByRole('button', { name: /Renomear/i })).toBeTruthy();

    // Os textos do rascunho chegam nos campos certos, editáveis.
    expect(screen.getByText(/mas porque cada mês é um valor/i)).toBeTruthy();
    expect(screen.getByText(/O atendente virtual respondeu no grupo/i)).toBeTruthy();

    // O botão da criação é "Criar atividade": nada foi gravado até aqui.
    expect(screen.getByRole('button', { name: /Criar atividade/i })).toBeTruthy();
  });
});

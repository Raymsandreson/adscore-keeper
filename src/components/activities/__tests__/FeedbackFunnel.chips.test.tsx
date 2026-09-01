/**
 * Os chips do topo do painel de Feedbacks (⏰ atrasadas, 📥 a avaliar, …) são
 * atalhos: clicar mostra a relação das atividades daquele status. E a visão
 * "Por assessor" quebra a mesma contagem por responsável, com o número levando
 * pras atividades daquele assessor.
 *
 * Antes eram só números decorativos — dava pra ver "40 atrasadas" e não ter
 * como listar as 40 nem saber de quem elas eram.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { fakeClient, DATA } = vi.hoisted(() => {
  const DATA: { feedback: any[]; late: any[] } = { feedback: [], late: [] };
  const chain = (table: string) => {
    const state = { select: '' };
    const resultado = () => {
      if (table === 'lead_activities') {
        // O painel faz duas consultas na mesma tabela: a dos retornos (traz
        // feedback_rating) e a das atrasadas/reagendadas (não traz).
        return { data: state.select.includes('feedback_rating') ? DATA.feedback : DATA.late, error: null };
      }
      return { data: [], error: null };
    };
    const proxy: any = new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return (ok: any, no: any) => Promise.resolve(resultado()).then(ok, no);
        if (prop === 'catch') return (no: any) => Promise.resolve(resultado()).catch(no);
        if (prop === 'finally') return (fn: any) => Promise.resolve(resultado()).finally(fn);
        return (...args: any[]) => {
          if (prop === 'select') state.select = String(args[0] ?? '');
          return proxy;
        };
      },
      apply: () => proxy,
    });
    return proxy;
  };
  const fakeClient = {
    from: (table: string) => chain(table),
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: () => chain('rpc'),
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => {
      const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} };
      return ch;
    },
    removeChannel: () => {},
  };
  return { fakeClient, DATA };
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
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  ensureRemapCache: async () => {},
  remapToExternal: async () => 'ext-me',
}));
vi.mock('@/hooks/useLeadActivities', () => ({
  useLeadActivities: () => ({ deleteActivity: async () => {} }),
}));
// A ficha completa abre em aba lateral por cima — aqui não é o que se mede.
vi.mock('@/components/activities/ActivityFullSheet', () => ({
  ActivityFullSheet: () => null,
}));
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthContext: () => ({ user: { id: 'u1', email: 'u1@test.local' }, isAuthenticated: true, loading: false }),
}));

import { FeedbackFunnel } from '../FeedbackFunnel';

const late = (id: string, title: string, nome: string) => ({
  id, title, status: 'pendente', deadline: '2026-08-01T12:00:00.000Z', rescheduled_to: null,
  assigned_to: `ext-${nome}`, assigned_to_name: nome, lead_name: null, case_title: null,
  process_title: null, feedback: null, feedback_outcome: null,
});

const retorno = (id: string, title: string, nome: string, outcome: string | null) => ({
  id, title, feedback: 'fiz o que foi pedido', feedback_rating: null, feedback_outcome: outcome,
  feedback_rated_by_name: null, feedback_rated_at: null, assigned_to: `ext-${nome}`, assigned_to_name: nome,
  created_by: 'ext-me', observer_ids: ['ext-me'], lead_id: null, lead_name: `Cliente de ${nome}`, case_id: null,
  case_title: null, process_id: null, process_title: null, activity_type: 'tarefa', status: 'concluida',
  deadline: '2026-08-05T12:00:00.000Z', rescheduled_to: null, completed_at: null,
  updated_at: '2026-08-05T12:00:00.000Z',
});

function montar() {
  DATA.late = [late('l1', 'Fazer tráfego', 'Joao'), late('l2', 'Cadastrar atividades', 'Joao'), late('l3', 'Fazer criativo', 'Andressa')];
  DATA.feedback = [retorno('f1', 'Retorno da campanha', 'Andressa', null), retorno('f2', 'Retorno do site', 'Joao', 'satisfeito')];
  return render(
    <MemoryRouter>
      <FeedbackFunnel open onOpenChange={() => {}} onCreateFollowUp={() => {}} />
    </MemoryRouter>,
  );
}

describe('FeedbackFunnel — chips e quebra por assessor', () => {
  it('clicar no chip de atrasadas lista as atividades atrasadas', async () => {
    montar();
    const chip = await screen.findByRole('button', { name: /3 atrasadas/i });
    fireEvent.click(chip);

    expect(await screen.findByText('Fazer tráfego')).toBeTruthy();
    expect(screen.getByText('Cadastrar atividades')).toBeTruthy();
    expect(screen.getByText('Fazer criativo')).toBeTruthy();
    // Só as atrasadas — o retorno a avaliar fica fora.
    expect(screen.queryByText('Retorno da campanha')).toBeNull();
  });

  it('clicar no chip de "a avaliar" lista só os retornos ainda sem avaliação', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /1 a avaliar/i }));

    expect(await screen.findByText('Retorno da campanha')).toBeTruthy();
    expect(screen.queryByText('Retorno do site')).toBeNull();   // já avaliado (satisfeito)
    expect(screen.queryByText('Fazer tráfego')).toBeNull();
  });

  it('o chip de concluídas soma tudo que já voltou e lista as atividades', async () => {
    montar();
    // 1 a avaliar + 1 satisfeito = 2 concluídas; as 3 atrasadas ficam de fora.
    const chip = await screen.findByRole('button', { name: /2 concluídas/i });
    fireEvent.click(chip);

    expect(await screen.findByText('Retorno da campanha')).toBeTruthy();
    expect(screen.getByText('Retorno do site')).toBeTruthy();
    expect(screen.queryByText('Fazer tráfego')).toBeNull();
  });

  it('visão "Por assessor" mostra a quantidade de cada status por responsável', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Por assessor/i }));

    const linhaJoao = (await screen.findByText('Joao')).closest('tr')!;
    // Joao: 2 atrasadas, 0 reagendadas, 0 a avaliar, 1 satisfeito → total 3
    expect(linhaJoao.textContent).toContain('Joao');
    const numerosJoao = Array.from(linhaJoao.querySelectorAll('td')).map(td => td.textContent?.trim());
    expect(numerosJoao).toEqual(['Joao', '2', '—', '—', '1', '—', '—', '3']);

    const linhaAndressa = screen.getByText('Andressa').closest('tr')!;
    const numerosAndressa = Array.from(linhaAndressa.querySelectorAll('td')).map(td => td.textContent?.trim());
    expect(numerosAndressa).toEqual(['Andressa', '1', '—', '1', '—', '—', '—', '2']);
  });

  it('clicar no número da tabela abre as atividades daquele assessor naquele status', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Por assessor/i }));

    const linhaJoao = (await screen.findByText('Joao')).closest('tr')!;
    fireEvent.click(linhaJoao.querySelector('button')!);   // as 2 atrasadas do Joao

    expect(await screen.findByText('Fazer tráfego')).toBeTruthy();
    expect(screen.getByText('Cadastrar atividades')).toBeTruthy();
    expect(screen.queryByText('Fazer criativo')).toBeNull();  // atrasada da Andressa
  });
});

/**
 * Regressão: a visualização (lista/grade/funil) é da PÁGINA, não de cada card.
 *
 * Bug original: o alternador nasceu dentro do BoardCard. Cada card tinha o seu
 * próprio estado, então a tela ficava com um quadro em "Lista", outro em
 * "Grade" e outro em "Funil" ao mesmo tempo — e trocar num card não mexia nos
 * outros, porque cada instância só lia o localStorage uma vez, ao montar.
 *
 * O que estes testes protegem:
 *  1. Existe UM alternador na página, não um por quadro.
 *  2. Trocar de modo muda TODOS os quadros de uma vez.
 *  3. Lista e grade não renderizam o gráfico (era a poluição reclamada), mas
 *     mantêm as mesmas ações — paridade de funcionalidade não pode cair junto
 *     com a densidade.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { dbMock } = vi.hoisted(() => {
  const stages = [
    { id: 's1', name: 'Cadastro', color: '#f00' },
    { id: 's2', name: 'Contato', color: '#0f0' },
  ];
  const boards = [
    {
      id: 'b1', name: 'Funil Alfa', description: 'primeiro', stages,
      color: '#000', icon: 'layout-grid', is_default: true, display_order: 0,
      ad_account_id: null, board_type: 'funnel', product_service_id: null,
      settings: {}, created_at: '', updated_at: '',
    },
    {
      id: 'b2', name: 'Funil Beta', description: 'segundo', stages,
      color: '#000', icon: 'layout-grid', is_default: false, display_order: 1,
      ad_account_id: null, board_type: 'funnel', product_service_id: null,
      settings: {}, created_at: '', updated_at: '',
    },
  ];

  // Query builder encadeável e "thenable": qualquer combinação de
  // select/eq/is/order/range resolve no mesmo resultado.
  const makeQuery = (table: string) => {
    const result = table === 'kanban_boards'
      ? { data: boards, error: null, count: boards.length }
      : { data: [], error: null, count: 0 };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order', 'range', 'update', 'insert', 'delete']) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve(result);
    q.single = () => Promise.resolve(result);
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return q;
  };

  return { dbMock: { from: (t: string) => makeQuery(t) } };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock,
  externalSupabase: dbMock,
  supabase: dbMock,
  authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: dbMock }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/hooks/useBpcFormLeads', () => ({
  useBpcFormLeads: () => ({ leads: [], metrics: null, loading: false, refetch: () => {} }),
}));
// Diálogos que a listagem só monta fechados — exigem AuthProvider e não são o
// objeto deste teste.
vi.mock('@/components/workflow/WorkflowBuilder', () => ({ WorkflowBuilder: () => null }));
vi.mock('@/components/funnel/FunnelTeamDialog', () => ({ FunnelTeamDialog: () => null }));
vi.mock('@/components/cases/ProcessDetailSheet', () => ({ default: () => null }));

import { BoardsList } from '@/components/board/BoardsList';

const renderList = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BoardsList boardType="funnel" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const botaoModo = (nome: RegExp) =>
  screen.getAllByRole('button').filter(b => nome.test(b.textContent || ''));

describe('BoardsList — visualização é da página, não do card', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('tem UM alternador na página, mesmo com vários quadros', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());
    expect(screen.getByText('Funil Beta')).toBeInTheDocument();

    // Dois quadros na tela, mas um único conjunto de botões de modo.
    expect(botaoModo(/^Lista$/)).toHaveLength(1);
    expect(botaoModo(/^Grade$/)).toHaveLength(1);
    expect(botaoModo(/^Funil$/)).toHaveLength(1);
  });

  it('abre em lista, sem gráfico', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());
    expect(screen.queryByText(/Funil de Conversão/)).not.toBeInTheDocument();
  });

  it('trocar para funil muda TODOS os quadros de uma vez', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());

    await user.click(botaoModo(/^Funil$/)[0]);

    // Os dois quadros passam a mostrar o gráfico — não só aquele em que cliquei.
    await waitFor(() => expect(screen.getAllByText(/Funil de Conversão/)).toHaveLength(2));
  });

  it('grade mostra as etapas como chips, sem gráfico', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());

    await user.click(botaoModo(/^Grade$/)[0]);

    await waitFor(() => expect(screen.getAllByText('Cadastro').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Funil de Conversão/)).not.toBeInTheDocument();
  });

  it('lista e grade mantêm as mesmas ações do card completo', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());

    for (const modo of [/^Lista$/, /^Grade$/, /^Funil$/]) {
      await user.click(botaoModo(modo)[0]);
      await waitFor(() => expect(screen.getAllByText('Editar')).toHaveLength(2));
      expect(screen.getAllByText('Equipe')).toHaveLength(2);
      expect(screen.getAllByText('Fluxograma')).toHaveLength(2);
      expect(screen.getAllByText('Abrir Kanban')).toHaveLength(2);
    }
  });

  it('a escolha persiste entre montagens (localStorage)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());
    await user.click(botaoModo(/^Grade$/)[0]);
    await waitFor(() => expect(screen.getAllByText('Cadastro').length).toBeGreaterThan(0));
    unmount();

    renderList();
    await waitFor(() => expect(screen.getByText('Funil Alfa')).toBeInTheDocument());
    // Voltou em grade: chips presentes, gráfico ausente.
    expect(screen.getAllByText('Cadastro').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Funil de Conversão/)).not.toBeInTheDocument();
  });
});

/**
 * Arquivamento de quadro (POP e funil — mesmo componente):
 *
 *  1. Quadro com settings.archived=true NÃO aparece na listagem por padrão.
 *  2. O botão "Arquivados (N)" revela os arquivados, com badge "Arquivado"
 *     e ação "Desarquivar".
 *  3. O sumário ("Funis Ativos") conta só os não-arquivados.
 *
 * O flag vive em kanban_boards.settings (jsonb) — sem coluna nova, sem
 * migration; desarquivar reverte tudo.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { dbMock } = vi.hoisted(() => {
  const stages = [{ id: 's1', name: 'Cadastro', color: '#f00' }];
  const boards = [
    {
      id: 'b1', name: 'Funil Ativo', description: 'em uso', stages,
      color: '#000', icon: 'layout-grid', is_default: true, display_order: 0,
      ad_account_id: null, board_type: 'funnel', product_service_id: null,
      settings: {}, created_at: '', updated_at: '',
    },
    {
      id: 'b2', name: 'Funil Antigo', description: 'aposentado', stages,
      color: '#000', icon: 'layout-grid', is_default: false, display_order: 1,
      ad_account_id: null, board_type: 'funnel', product_service_id: null,
      settings: { archived: true }, created_at: '', updated_at: '',
    },
  ];

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

describe('BoardsList — arquivamento', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('arquivado não aparece por padrão; sumário conta só ativos', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Ativo')).toBeInTheDocument());
    expect(screen.queryByText('Funil Antigo')).not.toBeInTheDocument();

    // "Funis Ativos" = 1 (só o não-arquivado)
    const ativo = screen.getByText('Funis Ativos');
    expect(ativo.previousElementSibling?.textContent).toBe('1');
  });

  it('"Arquivados (N)" revela o quadro com badge e ação de desarquivar', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(screen.getByText('Funil Ativo')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /Arquivados \(1\)/ });
    await user.click(toggle);

    await waitFor(() => expect(screen.getByText('Funil Antigo')).toBeInTheDocument());
    expect(screen.getByText('Arquivado')).toBeInTheDocument();
    expect(screen.getByText('Desarquivar')).toBeInTheDocument();
    // O ativo continua com a ação de arquivar.
    expect(screen.getByText('Arquivar')).toBeInTheDocument();

    // Ocultar de novo.
    await user.click(toggle);
    await waitFor(() => expect(screen.queryByText('Funil Antigo')).not.toBeInTheDocument());
  });
});

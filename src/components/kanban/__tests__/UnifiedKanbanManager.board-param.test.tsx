/**
 * Regressão: `/leads?board=<id>` precisa abrir o quadro do link.
 *
 * Bug original: nenhum componente lia o param `board`. O botão "Abrir Kanban"
 * dos cards (funil e POP), as notificações do chat e o MetricDetailSheet todos
 * navegam pra `/leads?board=<id>`, mas `selectedBoardId` vinha só do
 * auto-select do useKanbanBoards (is_default ou o primeiro) — qualquer link
 * caía sempre no mesmo quadro.
 *
 * Dois pontos delicados que estes testes protegem:
 *  1. O auto-select do useKanbanBoards roda no MESMO commit do efeito do param.
 *     Sem `setSelectedBoardId(prev => prev ?? default)`, ele lê `selectedBoardId`
 *     stale (null) e sobrescreve a escolha do link.
 *  2. O seletor do topo esconde POPs (board_type='workflow'). Como o card de POP
 *     também abre o kanban, o quadro selecionado tem que aparecer no dropdown —
 *     senão o link seleciona algo que o usuário não vê.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// vi.mock é hoisted: o mock do client precisa nascer dentro de vi.hoisted.
const { BOARDS, dbMock } = vi.hoisted(() => {
  const boards = [
    { id: 'board-padrao', name: 'Funil Padrão', description: null, stages: [], color: '#000', icon: 'layout-grid', is_default: true, display_order: 0, ad_account_id: null, board_type: 'funnel', product_service_id: null, created_at: '', updated_at: '' },
    { id: 'board-outro', name: 'Funil Instagram', description: null, stages: [], color: '#000', icon: 'layout-grid', is_default: false, display_order: 1, ad_account_id: null, board_type: 'funnel', product_service_id: null, created_at: '', updated_at: '' },
    { id: 'board-pop', name: 'POP Trabalhista', description: null, stages: [], color: '#000', icon: 'layout-grid', is_default: false, display_order: 2, ad_account_id: null, board_type: 'workflow', product_service_id: null, created_at: '', updated_at: '' },
  ];
  // Só a query de kanban_boards importa aqui.
  return {
    BOARDS: boards,
    dbMock: {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({ data: boards, error: null }),
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      // Realtime: o useGroupReportsPending (badge de relatos) assina um canal
      // no mount. Sem estes dois o efeito estoura e derruba a árvore inteira,
      // levando junto os testes de ?board=<id>, que nada têm com relatos.
      channel: () => {
        const ch: any = { on: () => ch, subscribe: () => ch };
        return ch;
      },
      removeChannel: () => {},
    },
  };
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
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  remapToExternal: (id: string) => Promise.resolve(id),
}));

// ── Hooks de dados (fora do escopo do teste) ──────────────────────────
vi.mock('@/hooks/useLeads', () => ({
  useLeads: () => ({ leads: [], loading: false, fetchLeads: vi.fn(), addLead: vi.fn(), updateLead: vi.fn(), deleteLead: vi.fn() }),
}));
vi.mock('@/hooks/useLeadDetails', () => ({ useLeadDetails: () => ({}) }));
vi.mock('@/hooks/useLeadStageHistory', () => ({ useLeadStageHistory: () => ({ addHistoryEntry: vi.fn() }) }));
vi.mock('@/hooks/useChecklists', () => ({
  useChecklists: () => ({ createLeadInstances: vi.fn(), markStageInstancesReadonly: vi.fn() }),
}));
vi.mock('@/hooks/useConversionAlerts', () => ({
  useConversionAlerts: () => ({
    settings: { enabled: false }, saveSettings: vi.fn(), checkConversionRates: () => [],
    requestNotificationPermission: vi.fn(), hasNotificationPermission: false,
  }),
}));
vi.mock('@/hooks/useProfilesList', () => ({ useProfilesList: () => [] }));
vi.mock('@/hooks/useContactClassifications', () => ({ useContactClassifications: () => ({ classifications: [] }) }));
vi.mock('@/components/kanban/SheetVirtualLeads', () => ({
  useVirtualSheetLeadsForBoard: () => ({ virtualCards: [], firstStageId: null, sheetLabel: null }),
}));

// ── Filhos pesados: stubs ─────────────────────────────────────────────
vi.mock('@/components/kanban/DynamicKanbanBoard', () => ({ DynamicKanbanBoard: () => <div data-testid="kanban" /> }));
vi.mock('@/components/kanban/LeadListView', () => ({ LeadListView: () => null }));
vi.mock('@/components/kanban/StageTimeMetrics', () => ({ StageTimeMetrics: () => null }));
vi.mock('@/components/kanban/StageFunnelChart', () => ({ StageFunnelChart: () => null }));
vi.mock('@/components/kanban/KanbanReportDialog', () => ({ KanbanReportDialog: () => null }));
vi.mock('@/components/kanban/ChecklistFilter', () => ({ ChecklistFilter: () => null }));
vi.mock('@/components/kanban/ImportInstagramProspects', () => ({ ImportInstagramProspects: () => null }));
vi.mock('@/components/kanban/LeadEditDialog', () => ({ LeadEditDialog: () => null }));
vi.mock('@/components/leads/AccidentLeadForm', () => ({ AccidentLeadForm: () => null }));
vi.mock('@/components/leads/AccidentDataExtractor', () => ({ AccidentDataExtractor: () => null }));

// Seletor do topo: expõe o que recebe, que é justamente o que o teste checa.
vi.mock('@/components/kanban/KanbanBoardSelector', () => ({
  KanbanBoardSelector: ({ boards, selectedBoardId }: { boards: Array<{ id: string; name: string }>; selectedBoardId: string | null }) => (
    <div>
      <span data-testid="selected">{selectedBoardId ?? ''}</span>
      <span data-testid="options">{boards.map(b => b.id).join(',')}</span>
    </div>
  ),
}));

import { UnifiedKanbanManager } from '../UnifiedKanbanManager';

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <UnifiedKanbanManager />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UnifiedKanbanManager — ?board=<id>', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sem o param, abre no quadro padrão (comportamento antigo preservado)', async () => {
    renderAt('/leads');
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('board-padrao'));
  });

  it('com ?board=<id>, abre o quadro do link em vez do padrão', async () => {
    renderAt('/leads?board=board-outro');
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('board-outro'));
    // não pode ser revertido pelo auto-select num commit posterior
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByTestId('selected')).toHaveTextContent('board-outro');
  });

  it('POP aberto pelo link fica selecionado E visível no seletor', async () => {
    renderAt('/leads?board=board-pop');
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('board-pop'));
    expect(screen.getByTestId('options')).toHaveTextContent('board-pop');
  });

  it('sem POP selecionado, o seletor segue só com funis', async () => {
    renderAt('/leads');
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('board-padrao'));
    expect(screen.getByTestId('options')).toHaveTextContent('board-padrao,board-outro');
  });

  it('id inexistente não quebra: cai no padrão', async () => {
    renderAt('/leads?board=nao-existe');
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('board-padrao'));
  });
});

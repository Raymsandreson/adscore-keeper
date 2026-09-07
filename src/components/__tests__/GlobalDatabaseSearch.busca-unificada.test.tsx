/**
 * Busca de campo único no Ctrl+K.
 *
 * O que estes testes travam, e por quê cada um existe:
 *
 *  1. CNJ COLADO SEM MÁSCARA acha o processo. `lead_processes` guarda 1.330
 *     CNJ mascarados e ZERO com 20 dígitos puros, então o `ilike` de antes
 *     devolvia zero para o formato que sai de sistema de tribunal. Quem cobre
 *     isso é a RPC `busca_unificada`, e este teste garante que ela está
 *     realmente ligada na tela — não só existindo no banco.
 *
 *  2. DEDUP. A RPC e o `ilike` podem achar a MESMA linha (ex.: "PREV 1802"
 *     casa por código numa e por texto na outra). Sem dedup o mesmo caso
 *     aparece duas vezes — que é exatamente a queixa da fila de atendimento.
 *
 *  3. GRUPO EM QUARENTENA APARECE, com selo. Escopo é rótulo, nunca filtro:
 *     esconder o grupo `nao_classificado` da busca esconderia justamente o que
 *     precisa de gente olhando. O grupo pessoal "Familia gold1p.x" tem que
 *     estar na lista, marcado — não ausente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// cmdk (o CommandDialog do Ctrl+K) usa ResizeObserver, que o jsdom nao tem.
// Sem isto o teste falha na montagem e nunca chega a exercitar a busca.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { dbMock, rpcSpy } = vi.hoisted(() => {
  // O mesmo caso que a RPC devolve por código e o ilike devolve por texto.
  const CASO = {
    id: 'caso-1', case_number: 'PREV 1802', title: 'Izolete Muller',
    status: 'em_andamento', updated_at: '2026-09-01T00:00:00Z', deleted_at: null, lead_id: 'lead-1',
  };
  const PROCESSO = {
    id: 'proc-1', process_number: '5004604-66.2026.4.04.7013', title: 'Ação de auxílio',
    status: 'em_andamento', updated_at: '2026-09-01T00:00:00Z', deleted_at: null,
  };

  const rpcSpy = vi.fn((nome: string, args: Record<string, unknown>) => {
    if (nome !== 'busca_unificada') return Promise.resolve({ data: [], error: null });
    const termo = String(args?.p_termo ?? '');
    // 20 dígitos puros: só a RPC acha isso.
    if (termo.replace(/\D/g, '').length === 20) {
      return Promise.resolve({
        data: [{ tipo: 'processo', process_id: 'proc-1', titulo: PROCESSO.process_number, subtitulo: '' }],
        error: null,
      });
    }
    if (/^prev\s*1802$/i.test(termo)) {
      return Promise.resolve({
        data: [{ tipo: 'caso', case_id: 'caso-1', titulo: 'PREV 1802', subtitulo: 'Izolete Muller' }],
        error: null,
      });
    }
    if (/gold/i.test(termo)) {
      return Promise.resolve({
        data: [{
          tipo: 'grupo', group_jid: '5521982930722-1446775117@g.us',
          titulo: 'Familia gold1p.x', subtitulo: 'Raym',
          escopo_status: 'nao_classificado', acao_sugerida: 'vincular_caso', lead_id: null,
        }],
        error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  });

  const makeQuery = (table: string, termo: { v: string }) => {
    const q: Record<string, unknown> = {};
    let linhas: unknown[] = [];
    // O ilike devolve o MESMO caso quando o termo é "PREV 1802" — é assim que
    // o duplicado nasce, e é isso que o dedup tem que resolver.
    q.select = () => q;
    q.in = (_col: string, ids: string[]) => {
      linhas = table === 'legal_cases'
        ? [CASO].filter(r => ids.includes(r.id))
        : table === 'lead_processes' ? [PROCESSO].filter(r => ids.includes(r.id)) : [];
      return q;
    };
    for (const m of ['or', 'eq', 'is', 'gte', 'lte', 'order', 'range', 'limit']) {
      q[m] = (...args: unknown[]) => {
        if (m === 'or' && table === 'legal_cases' && /1802/.test(String(args[0]))) linhas = [CASO];
        return q;
      };
    }
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(res, rej);
    return q;
  };

  const termo = { v: '' };
  const dbMock = {
    from: (t: string) => makeQuery(t, termo),
    rpc: rpcSpy,
  };
  return { dbMock, rpcSpy };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: dbMock }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: dbMock, ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/hooks/useLeads', () => ({ useLeads: () => ({ updateLead: vi.fn() }) }));
vi.mock('@/hooks/useKanbanBoards', () => ({ useKanbanBoards: () => ({ boards: [] }) }));
vi.mock('@/lib/whatsappChatSheet', () => ({ openWhatsAppChatSheet: vi.fn() }));

import { GlobalDatabaseSearch } from '@/components/GlobalDatabaseSearch';

/** Abre o Ctrl+K e digita, respeitando o debounce de 300ms da tela. */
async function buscar(termo: string) {
  const user = userEvent.setup();
  render(<MemoryRouter><GlobalDatabaseSearch /></MemoryRouter>);
  await user.keyboard('{Control>}k{/Control}');
  const campo = await screen.findByPlaceholderText(/Nº do processo/i);
  await user.type(campo, termo);
}

describe('Ctrl+K com busca_unificada', () => {
  beforeEach(() => { rpcSpy.mockClear(); });

  it('acha o processo com o CNJ colado sem máscara', async () => {
    await buscar('50046046620264047013');
    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('busca_unificada', expect.objectContaining({
        p_termo: '50046046620264047013',
      }));
    }, { timeout: 3000 });
    expect(await screen.findByText('5004604-66.2026.4.04.7013')).toBeInTheDocument();
  });

  it('não repete o caso que a RPC e o ilike acham ao mesmo tempo', async () => {
    await buscar('PREV 1802');
    // O caso vem por DOIS caminhos; a lista tem que mostrar UM.
    await waitFor(async () => {
      const linhas = await screen.findAllByText('PREV 1802');
      expect(linhas).toHaveLength(1);
    }, { timeout: 3000 });
  });

  it('mostra o grupo em quarentena com selo, em vez de escondê-lo', async () => {
    await buscar('gold');
    expect(await screen.findByText('Familia gold1p.x')).toBeInTheDocument();
    expect(await screen.findByText('quarentena')).toBeInTheDocument();
    expect(await screen.findByText('vincular a um caso')).toBeInTheDocument();
  });
});

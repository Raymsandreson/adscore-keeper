/**
 * "Esse valor saiu mesmo da conta?"
 *
 * O extrato do lead mostrava o que ALGUÉM DIGITOU e nada mais. O dinheiro que a
 * Celcoin traz do banco morava na mesma base, na tela de conciliação, sem nenhum
 * fio ligando as duas coisas.
 *
 * O que estes testes prendem:
 *  1. cada lançamento manual DIZ, na linha, se foi conferido contra o extrato;
 *  2. divergência de valor não vira "conciliado" verde — aparece como divergência;
 *  3. apontar a transação grava o retrato dela (descrição, data, valor) e, se a
 *     linha ainda não era caixa, BAIXA com a data do banco, não com a de hoje.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { fakeClient, atualizados, estado, janelas } = vi.hoisted(() => {
  const atualizados: Array<{ tabela: string; patch: any; id: string | null }> = [];
  /** Janelas pedidas à edge — prende que a busca não varre o extrato inteiro. */
  const janelas: Array<{ kind: string; from: string; to: string }> = [];
  /** `banco`/`cartao` são linhas CRUAS, como `list_transactions` devolve. */
  const estado: { linhas: any[]; banco: any[]; cartao: any[] } = {
    linhas: [], banco: [], cartao: [],
  };
  const chain = (tabela: string, ctx: { patch?: any; id?: string | null } = {}): any => {
    const p: any = Promise.resolve({
      data: tabela === 'lead_financials' ? estado.linhas : [],
      error: null,
    });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'update') return (patch: any) => chain(tabela, { ...ctx, patch });
        if (prop === 'eq') {
          return (_col: string, valor: string) => {
            if (ctx.patch) atualizados.push({ tabela, patch: ctx.patch, id: valor });
            return chain(tabela, { ...ctx, id: valor });
          };
        }
        return () => chain(tabela, ctx);
      },
      apply: () => chain(tabela, ctx),
    });
  };
  return {
    atualizados,
    estado,
    janelas,
    fakeClient: {
      from: (tabela: string) => chain(tabela),
      auth: {
        getUser: async () => ({ data: { user: { id: 'cloud-u1' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: () => chain('rpc'),
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    },
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: fakeClient,
  authClient: fakeClient,
  supabase: fakeClient,
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: fakeClient }));
vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase/uuid-remap', () => ({ remapToExternal: async () => 'ext-u1' }));
vi.mock('@/lib/functionRouter', () => ({
  cloudFunctions: {
    invoke: async (_nome: string, opts: any) => {
      const b = opts?.body || {};
      if (b.action === 'list_transactions') {
        janelas.push({ kind: b.kind, from: b.from, to: b.to });
        return {
          data: {
            success: true,
            transactions: b.kind === 'bank' ? estado.banco : estado.cartao,
            identidade: { mapeado: true },
            contas_permitidas: 1,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  },
}));
vi.mock('@/hooks/useFinanceTimeTracker', () => ({ trackFinanceEntry: () => {} }));
vi.mock('@/components/whatsapp/MediaLightbox', () => ({ MediaLightbox: () => null }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { EntityFinancialsPanel } from '../EntityFinancialsPanel';

const novoUser = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Uma despesa baixada, sem conciliação — o estado em que TUDO estava. */
const despesa = (extra: Record<string, unknown> = {}) => ({
  id: 'lf-1',
  lead_id: 'lead-1',
  case_id: null,
  process_id: null,
  activity_id: null,
  entry_type: 'saida',
  amount: 48,
  description: 'Flores para visita lead290',
  category: 'Outros',
  entry_date: '2026-08-24',
  settled_at: '2026-08-24',
  contact_id: null,
  parte_id: null,
  parte_nome: null,
  receipt_url: null,
  verba: null,
  valor_nominal: null,
  juros: null,
  conferido: true,
  parcela_grupo: null,
  parcela_n: null,
  parcela_de: null,
  payment_method: null,
  notes: null,
  created_at: '2026-08-25T13:36:34Z',
  of_transacao_id: null,
  of_transacao_tipo: null,
  of_descricao: null,
  of_data: null,
  of_valor: null,
  of_conciliado_em: null,
  of_conciliado_por: null,
  ...extra,
});

beforeEach(() => {
  atualizados.length = 0;
  janelas.length = 0;
  estado.linhas = [];
  estado.banco = [];
  estado.cartao = [];
});

describe('EntityFinancialsPanel — conciliação com o Open Finance', () => {
  it('a linha mostra o valor e diz que ninguém conferiu contra o extrato', async () => {
    estado.linhas = [despesa()];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    // Na LINHA, não só no card de totais: o valor é o que a ficha escondia
    // atrás da rolagem horizontal.
    const linha = (await screen.findByText('Flores para visita lead290')).closest('[role="button"]');
    expect(linha?.textContent).toMatch(/-R\$\s*48,00/);
    expect(linha?.textContent).toContain('sem extrato');
  });

  it('conciliado com valor igual aparece como "no extrato"', async () => {
    estado.linhas = [despesa({
      of_transacao_id: 'tx-1',
      of_transacao_tipo: 'bank',
      of_descricao: 'PIX ENVIADO FLORICULTURA',
      of_data: '2026-08-24',
      of_valor: 48,
      of_conciliado_em: '2026-08-25T14:00:00Z',
    })];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    expect(await screen.findByText('no extrato')).toBeInTheDocument();
    expect(screen.queryByText('sem extrato')).not.toBeInTheDocument();
  });

  it('valor do extrato diferente do lançado NÃO passa por conciliado', async () => {
    estado.linhas = [despesa({
      of_transacao_id: 'tx-1',
      of_transacao_tipo: 'bank',
      of_descricao: 'PIX ENVIADO FLORICULTURA',
      of_data: '2026-08-24',
      of_valor: 60,
      of_conciliado_em: '2026-08-25T14:00:00Z',
    })];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    expect(await screen.findByText('extrato ≠ valor')).toBeInTheDocument();
    expect(screen.queryByText('no extrato')).not.toBeInTheDocument();
  });

  it('apontar a transação grava o retrato dela no lançamento', async () => {
    const user = novoUser();
    estado.linhas = [despesa()];
    estado.banco = [
      // O de valor certo NÃO é o primeiro da resposta: a ordenação é que tem de
      // trazê-lo para cima.
      { id: 'tx-0', description: 'TARIFA MENSALIDADE', amount: -12, transaction_date: '2026-08-24', transaction_time: '08:00:00', pluggy_account_id: 'acc-1' },
      { id: 'tx-1', description: 'PIX ENVIADO FLORICULTURA', amount: -48, transaction_date: '2026-08-24', transaction_time: '10:12:00', pluggy_account_id: 'acc-1' },
    ];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByText('sem extrato'));
    await user.click(await screen.findByText('PIX ENVIADO FLORICULTURA'));

    await waitFor(() => {
      const gravado = atualizados.find(a => a.patch?.of_transacao_id);
      expect(gravado?.id).toBe('lf-1');
      expect(gravado?.patch).toMatchObject({
        of_transacao_id: 'tx-1',
        of_transacao_tipo: 'bank',
        of_descricao: 'PIX ENVIADO FLORICULTURA',
        of_data: '2026-08-24',
        // O sinal do banco não vira o sinal do lançamento: o retrato é em módulo.
        of_valor: 48,
        of_conciliado_por: 'ext-u1',
      });
      // Já estava baixada — conciliar não pode reescrever a data da baixa.
      expect(gravado?.patch).not.toHaveProperty('settled_at');
    });
  });

  it('conciliar o que ainda não era caixa baixa com a data do BANCO, não a de hoje', async () => {
    const user = novoUser();
    estado.linhas = [despesa({ settled_at: null, entry_date: '2026-08-20' })];
    estado.cartao = [{
      id: 'tx-9',
      description: 'FLORICULTURA BELA FLOR',
      merchant_name: 'FLORICULTURA BELA FLOR',
      amount: 48,
      transaction_date: '2026-08-22',
      card_last_digits: '1234',
    }];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByText('sem extrato'));
    await user.click(await screen.findByText('FLORICULTURA BELA FLOR'));

    await waitFor(() => {
      const gravado = atualizados.find(a => a.patch?.of_transacao_id);
      expect(gravado?.patch?.settled_at).toBe('2026-08-22');
    });
  });

  it('procura numa janela em torno do lançamento, não no extrato inteiro', async () => {
    const user = novoUser();
    estado.linhas = [despesa()];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByText('sem extrato'));

    await waitFor(() => {
      // ±15 dias em torno de 24/08, conta e cartão.
      expect(janelas).toEqual(expect.arrayContaining([
        { kind: 'bank', from: '2026-08-09', to: '2026-09-08' },
        { kind: 'card', from: '2026-08-09', to: '2026-09-08' },
      ]));
    });
  });

  it('débito da conta não é oferecido para conciliar uma ENTRADA', async () => {
    const user = novoUser();
    estado.linhas = [despesa({ entry_type: 'entrada', description: 'Honorário recebido' })];
    estado.banco = [
      { id: 'tx-d', description: 'PIX ENVIADO FLORICULTURA', amount: -48, transaction_date: '2026-08-24', pluggy_account_id: 'acc-1' },
      { id: 'tx-c', description: 'PIX RECEBIDO CLIENTE', amount: 48, transaction_date: '2026-08-24', pluggy_account_id: 'acc-1' },
    ];
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByText('sem extrato'));

    expect(await screen.findByText('PIX RECEBIDO CLIENTE')).toBeInTheDocument();
    expect(screen.queryByText('PIX ENVIADO FLORICULTURA')).not.toBeInTheDocument();
  });
});

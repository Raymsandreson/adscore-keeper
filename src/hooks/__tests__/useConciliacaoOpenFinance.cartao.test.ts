/**
 * "O gasto foi no cartão final 1234" — e a conciliação tem de começar por ali.
 *
 * O lançamento do lead passou a guardar o cartão (`lead_financials.card_last_digits`,
 * migration `lancamento_do_lead_sabe_a_conta`). Quem lançou já sabia por onde o
 * dinheiro saiu; sem usar isso, a conferência oferece conta e cartão inteiros e
 * a pessoa refaz na mão um trabalho que já estava feito.
 *
 * O que estes testes prendem:
 *  1. com cartão, só as linhas DAQUELE cartão são oferecidas;
 *  2. o que o filtro tirou é CONTADO (`ocultadas_pelo_cartao`) — filtro que
 *     esconde calado é o mesmo erro de somar pela metade: a despesa pode ter
 *     sido cadastrada no cartão errado, e a tela precisa poder abrir de novo;
 *  3. sem cartão, nada muda — o comportamento antigo continua inteiro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/** Linha crua de extrato, como `list_transactions` devolve. */
interface LinhaCrua {
  id: string;
  amount: number;
  transaction_date: string;
  description?: string;
  card_last_digits?: string;
}

const { invocacoes, extrato } = vi.hoisted(() => ({
  invocacoes: [] as Array<{ kind: string }>,
  extrato: { bank: [], card: [] } as { bank: unknown[]; card: unknown[] },
}));

vi.mock('@/lib/functionRouter', () => ({
  cloudFunctions: {
    invoke: async (_nome: string, opts: { body: { kind: 'bank' | 'card' } }) => {
      invocacoes.push({ kind: opts.body.kind });
      return { data: { transactions: extrato[opts.body.kind], contas_permitidas: 2, identidade: { mapeado: true } }, error: null };
    },
  },
}));

// `lead_financials` só é consultada para marcar transação já usada por outro
// lançamento. Aqui interessa o filtro, então devolve vazio.
vi.mock('@/integrations/supabase', () => ({
  db: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) },
  authClient: { auth: { getUser: async () => ({ data: { user: null } }) } },
  ensureExternalSession: async () => {},
}));

vi.mock('@/integrations/supabase/uuid-remap', () => ({ remapToExternal: async () => null }));

import { useConciliacaoOpenFinance } from '../useConciliacaoOpenFinance';

const cartaoDe = (id: string, digitos: string, valor: number): LinhaCrua => ({
  id, amount: valor, transaction_date: '2026-09-10', card_last_digits: digitos,
  description: 'compra ' + id,
});

describe('conciliação: cartão declarado no lançamento', () => {
  beforeEach(() => {
    invocacoes.length = 0;
    extrato.bank = [{ id: 'b1', amount: -48, transaction_date: '2026-09-10', description: 'PIX enviado' }];
    extrato.card = [
      cartaoDe('c1', '1234', -48),
      cartaoDe('c2', '9999', -48),
      cartaoDe('c3', '9999', -50),
    ];
  });

  it('oferece só o cartão informado e CONTA o que ficou de fora', async () => {
    const { result } = renderHook(() => useConciliacaoOpenFinance());

    const r = await result.current.buscarCandidatos({
      valor: 48, data: '2026-09-10', dias: 15, direcao: 'saida', cartao: '1234',
    });

    expect(r.candidatos.map(c => c.id)).toEqual(['c1']);
    expect(r.cartao_filtrado).toBe('1234');
    // b1 (conta) + c2 + c3 saíram da vista: três linhas, ditas em número.
    expect(r.ocultadas_pelo_cartao).toBe(3);
  });

  it('sem cartão informado, continua oferecendo conta e cartão', async () => {
    const { result } = renderHook(() => useConciliacaoOpenFinance());

    const r = await result.current.buscarCandidatos({
      valor: 48, data: '2026-09-10', dias: 15, direcao: 'saida',
    });

    expect(r.candidatos.map(c => c.id).sort()).toEqual(['b1', 'c1', 'c2', 'c3']);
    expect(r.cartao_filtrado).toBeNull();
    expect(r.ocultadas_pelo_cartao).toBe(0);
  });

  it('cartão sem nenhuma linha no extrato devolve lista vazia com a conta do que sumiu', async () => {
    const { result } = renderHook(() => useConciliacaoOpenFinance());

    const r = await result.current.buscarCandidatos({
      valor: 48, data: '2026-09-10', dias: 15, direcao: 'saida', cartao: '0000',
    });

    // Vazio é resposta honesta — mas a tela precisa saber que havia 4 linhas
    // para poder oferecer "ver tudo" em vez de dizer que não há movimento.
    expect(r.candidatos).toEqual([]);
    expect(r.ocultadas_pelo_cartao).toBe(4);
  });
});

/**
 * Parcela que foge do tipo do plano.
 *
 * Um combinado em 3x nem sempre anda todo na mesma direção: o acordo entra e a
 * perícia dele sai no meio das entradas. Antes disso o `entry_type` vinha do
 * objeto `vinculos`, um só para o INSERT inteiro — a única saída era lançar dois
 * planos separados, que quebra a leitura de que foi UM combinado.
 *
 * O que estes testes prendem:
 *  1. clicar na parcela grava SÓ ela com o outro tipo;
 *  2. trocar o tipo lá em cima apaga a exceção, em vez de deixá-la grudada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { fakeClient, inseridos } = vi.hoisted(() => {
  const inseridos: any[] = [];
  const chain = (tabela: string): any => {
    const p: any = Promise.resolve({ data: [], error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'insert') {
          return (linhas: any) => {
            if (tabela === 'lead_financials') inseridos.push(...(Array.isArray(linhas) ? linhas : [linhas]));
            return chain(tabela);
          };
        }
        return () => chain(tabela);
      },
      apply: () => chain(tabela),
    });
  };
  return {
    inseridos,
    fakeClient: {
      from: (tabela: string) => chain(tabela),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
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
vi.mock('@/lib/functionRouter', () => ({ cloudFunctions: { invoke: async () => ({ data: null, error: null }) } }));
vi.mock('@/hooks/useFinanceTimeTracker', () => ({ trackFinanceEntry: () => {} }));
vi.mock('@/components/whatsapp/MediaLightbox', () => ({ MediaLightbox: () => null }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));

// O ScrollArea do Radix (prévia das parcelas e lista do painel) observa o
// tamanho do viewport, e o jsdom não tem ResizeObserver.
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { EntityFinancialsPanel } from '../EntityFinancialsPanel';

/** O Dialog do Radix põe `pointer-events: none` no body; sem isso o userEvent recusa o clique. */
const novoUser = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Abre o diálogo já com valor, categoria e descrição — o mínimo que o Salvar exige. */
async function abrirFormPreenchido(user: ReturnType<typeof novoUser>) {
  render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);
  await user.click(await screen.findByRole('button', { name: /Novo Lançamento/i }));

  await user.type(await screen.findByPlaceholderText('0,00'), '300');
  await user.type(screen.getByPlaceholderText(/pago 3ª parcela do acordo/i), 'Acordo em 3x');

  // Os campos não têm htmlFor, então a categoria se acha pelo próprio gatilho.
  const categoria = screen.getAllByRole('combobox').find(c => /Selecione/.test(c.textContent || ''));
  await user.click(categoria!);
  await user.click(await screen.findByRole('option', { name: 'Acordo' }));
}

/** Liga o parcelamento em N vezes. */
async function parcelarEm(user: ReturnType<typeof novoUser>, quantas: string) {
  await user.click(screen.getByRole('checkbox', { name: /Parcelar \/ repetir/i }));
  // `max="360"` é o que distingue o campo Quantas do campo Valor (os dois são number).
  const quantidade = await waitFor(() => {
    const el = document.querySelector('input[max="360"]') as HTMLInputElement | null;
    if (!el) throw new Error('campo Quantas não apareceu');
    return el;
  });
  await user.clear(quantidade);
  await user.type(quantidade, quantas);
}

describe('EntityFinancialsPanel — tipo por parcela', () => {
  beforeEach(() => { inseridos.length = 0; });

  it('clicar numa parcela grava só ela com o tipo trocado', async () => {
    const user = novoUser();
    await abrirFormPreenchido(user);

    // Receita para o plano todo — é o caso do pedido: acordo entrando em 3x.
    await user.click(screen.getByRole('button', { name: /Receita/ }));
    await parcelarEm(user, '3');

    // A 2ª parcela é a exceção: sai, em vez de entrar.
    await user.click(await screen.findByTitle(/parcela 2\/3 como despesa/i));

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(inseridos).toHaveLength(3));
    expect(inseridos.map(l => l.entry_type)).toEqual(['entrada', 'saida', 'entrada']);
    expect(inseridos.map(l => l.parcela_n)).toEqual([1, 2, 3]);
    // Uma exceção não parte o plano: as três seguem no mesmo grupo.
    expect(new Set(inseridos.map(l => l.parcela_grupo)).size).toBe(1);
    expect(inseridos.map(l => l.amount)).toEqual([100, 100, 100]);
  });

  it('trocar o tipo lá em cima apaga a exceção em vez de deixá-la grudada', async () => {
    const user = novoUser();
    await abrirFormPreenchido(user);

    await user.click(screen.getByRole('button', { name: /Receita/ }));
    await parcelarEm(user, '3');
    await user.click(await screen.findByTitle(/parcela 2\/3 como despesa/i));
    // Com plano misto o rodapé não soma direções diferentes num total só.
    expect(screen.getByText('Entram')).toBeInTheDocument();
    expect(screen.getByText('Saem')).toBeInTheDocument();

    // Plano inteiro vira despesa: a parcela 2 já era despesa e deixa de ser exceção.
    await user.click(screen.getByRole('button', { name: /Despesa/ }));
    expect(screen.queryByText('Entram')).not.toBeInTheDocument();
    expect(screen.getByText('Soma das parcelas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(inseridos).toHaveLength(3));
    expect(inseridos.map(l => l.entry_type)).toEqual(['saida', 'saida', 'saida']);
  });

  it('lançamento sem parcelamento segue com um tipo só', async () => {
    const user = novoUser();
    await abrirFormPreenchido(user);
    await user.click(screen.getByRole('button', { name: /Receita/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(inseridos).toHaveLength(1));
    expect(inseridos[0]).toMatchObject({ entry_type: 'entrada', amount: 300, parcela_grupo: null, parcela_n: null });
  });
});

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

const { fakeClient, inseridos, estado } = vi.hoisted(() => {
  const inseridos: any[] = [];
  /** O que o banco devolve e o que a IA responde — cada teste semeia o seu. */
  const estado: { linhas: any[]; respostaIa: any } = { linhas: [], respostaIa: null };
  const chain = (tabela: string): any => {
    const p: any = Promise.resolve({
      data: tabela === 'lead_financials' ? estado.linhas : [],
      error: null,
    });
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
    estado,
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
vi.mock('@/lib/functionRouter', () => ({
  cloudFunctions: { invoke: async () => ({ data: estado.respostaIa, error: null }) },
}));
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

/** Uma parcela já gravada, do jeito que o fetchEntries a entrega. */
const PARCELA_GRAVADA = {
  id: 'fin-1',
  entry_type: 'saida',
  amount: 100,
  entry_date: '2026-08-21',
  description: 'Parcela do acordo',
  category: 'Acordo',
  settled_at: '2026-08-21',
  parcela_grupo: 'g1',
  parcela_n: 2,
  parcela_de: 3,
  conferido: true,
  lead_id: 'lead-1',
  case_id: null,
  process_id: null,
  activity_id: null,
  parte_id: null,
  parte_nome: null,
  receipt_url: null,
  notes: null,
  payment_method: null,
  created_at: '2026-08-21T10:00:00-03:00',
};

describe('EntityFinancialsPanel — tipo por parcela', () => {
  beforeEach(() => {
    inseridos.length = 0;
    estado.linhas = [];
    estado.respostaIa = null;
  });

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

  it('clicar na linha de uma parcela já gravada abre a edição com o par Receita/Despesa', async () => {
    estado.linhas = [PARCELA_GRAVADA];
    const user = novoUser();
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByRole('button', { name: /Parcela do acordo/ }));

    // Edição, não lançamento novo: o rodapé diz Atualizar.
    expect(await screen.findByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receita/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Despesa/ })).toBeInTheDocument();
  });

  it('botão dentro da linha não dispara a edição da linha', async () => {
    estado.linhas = [PARCELA_GRAVADA];
    const user = novoUser();
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByRole('button', { name: 'Remover' }));

    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument();
  });

  it('leitura de documento abandonada não sequestra a edição da linha', async () => {
    estado.linhas = [PARCELA_GRAVADA];
    // Documento com dois valores: o diálogo vira conferência e esconde o formulário.
    estado.respostaIa = {
      confianca: 'alta',
      lancamentos: [
        { descricao: 'Honorário', valor: 2000, tipo: 'entrada', categoria: 'Honorários Contratuais' },
        { descricao: 'Custas', valor: 180, tipo: 'saida', categoria: 'Custas Processuais' },
      ],
    };
    const user = novoUser();
    render(<EntityFinancialsPanel scope="lead" leadId="lead-1" />);

    await user.click(await screen.findByRole('button', { name: /Novo Lançamento/i }));
    await user.type(screen.getByPlaceholderText(/pago 3ª parcela do acordo/i), 'Alvará');
    await user.click(screen.getByRole('button', { name: /sugerir categoria/i }));
    expect(await screen.findByText(/2 valores lidos/)).toBeInTheDocument();

    // Desiste da leitura e vai consertar uma linha que já existe.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(await screen.findByRole('button', { name: /Parcela do acordo/ }));

    expect(await screen.findByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    expect(screen.queryByText(/2 valores lidos/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Despesa/ })).toBeInTheDocument();
  });
});

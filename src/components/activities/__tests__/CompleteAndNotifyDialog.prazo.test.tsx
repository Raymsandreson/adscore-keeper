/**
 * "Concluir + próxima" com o prazo mexido no formulário.
 *
 * Trocar o prazo e clicar nesse botão NÃO adia: a atividade aberta é concluída
 * com o prazo antigo e a data nova vai só para a filha. Quem só queria adiar
 * acabava concluindo — no PREV 180 (14/08/2026) foram 8 conclusões em 10
 * minutos, uma por tentativa. O dialog passou a dizer o que vai acontecer e a
 * oferecer o adiar de verdade.
 *
 * Invariantes cobertos:
 *  1. sem mudança de prazo, nada de aviso (o caminho normal não ganha ruído);
 *  2. com mudança, o aviso mostra as DUAS datas;
 *  3. o atalho adia e fecha, sem concluir nada;
 *  4. sem `onPostponeInstead`, o aviso continua, mas sem botão que não funciona.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { fakeClient } = vi.hoisted(() => {
  const chain = (): any => {
    const p: any = Promise.resolve({ data: [], error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
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
    },
  };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: { invoke: async () => ({ data: null, error: null }) },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { CompleteAndNotifyDialog } from '../CompleteAndNotifyDialog';

const HOJE = '2026-08-14';
const DEPOIS = '2026-08-18';
const ANTES = '2026-08-10';

interface Cenario {
  currentDeadline?: string | null;
  nextDeadline?: string | null;
  onPostponeInstead?: ((d: string) => void) | undefined;
  onConfirm?: () => Promise<void>;
  onClose?: () => void;
}

const renderDialog = (c: Cenario = {}) =>
  render(
    <CompleteAndNotifyDialog
      open
      onClose={c.onClose ?? (() => {})}
      onConfirm={c.onConfirm ?? (async () => {})}
      leadId="lead-1"
      buildMsg={() => 'mensagem'}
      preloadedGroups={[]}
      currentDeadline={c.currentDeadline ?? null}
      nextDeadline={c.nextDeadline ?? null}
      onPostponeInstead={c.onPostponeInstead}
    />,
  );

const avisoDoPrazo = () => screen.queryByText(/Você mudou o prazo de/);

describe('CompleteAndNotifyDialog — prazo alterado antes de concluir', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prazo intocado: nenhum aviso', async () => {
    renderDialog({ currentDeadline: HOJE, nextDeadline: HOJE, onPostponeInstead: vi.fn() });
    await screen.findByText('Concluir e Criar Próxima Atividade');
    expect(avisoDoPrazo()).not.toBeInTheDocument();
  });

  it('atividade sem prazo gravado: nenhum aviso (não há de/para a mostrar)', async () => {
    renderDialog({ currentDeadline: null, nextDeadline: DEPOIS, onPostponeInstead: vi.fn() });
    await screen.findByText('Concluir e Criar Próxima Atividade');
    expect(avisoDoPrazo()).not.toBeInTheDocument();
  });

  it('prazo adiado: o aviso mostra a data velha e a nova', async () => {
    renderDialog({ currentDeadline: HOJE, nextDeadline: DEPOIS, onPostponeInstead: vi.fn() });

    const aviso = await screen.findByText(/Você mudou o prazo de/);
    expect(aviso).toHaveTextContent('14/08');
    expect(aviso).toHaveTextContent('18/08');
  });

  it('o atalho adia com a data NOVA, fecha e não conclui nada', async () => {
    const onPostponeInstead = vi.fn();
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    renderDialog({ currentDeadline: HOJE, nextDeadline: DEPOIS, onPostponeInstead, onConfirm, onClose });

    fireEvent.click(await screen.findByRole('button', { name: /Só adiar para 18\/08/i }));

    await waitFor(() => expect(onPostponeInstead).toHaveBeenCalledWith(DEPOIS));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('prazo puxado para trás: o rótulo deixa de dizer "adiar"', async () => {
    renderDialog({ currentDeadline: HOJE, nextDeadline: ANTES, onPostponeInstead: vi.fn() });

    expect(await screen.findByRole('button', { name: /Só mudar o prazo para 10\/08/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Só adiar/i })).not.toBeInTheDocument();
  });

  it('sem handler de adiar, o aviso fica mas o botão não aparece', async () => {
    renderDialog({ currentDeadline: HOJE, nextDeadline: DEPOIS, onPostponeInstead: undefined });

    expect(await screen.findByText(/Você mudou o prazo de/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /não concluir/i })).not.toBeInTheDocument();
  });
});

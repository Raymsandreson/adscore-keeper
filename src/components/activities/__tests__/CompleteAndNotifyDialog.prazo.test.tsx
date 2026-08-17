/**
 * "Concluir + próxima" com o prazo mexido no formulário: o pop-up NÃO comenta.
 *
 * Entre 14/08 e 17/08/2026 este dialog mostrava um aviso amarelo ("Você mudou o
 * prazo de X para Y") com um atalho "Só adiar" (commit e35e37ecb). Nasceu do
 * PREV 180, quando o botão era usado como adiar por falta de um Adiar de
 * verdade — que passou a existir no mesmo dia (87d01cbd7), no action bar, ao
 * lado deste botão.
 *
 * O aviso saiu em 17/08/2026 por não distinguir nada: nos 1.000 elos de cadeia
 * mais recentes do banco, 946 (94,6%) nascem com prazo MAIOR que o da mãe,
 * contra 53 que repetem a data. Mudar a data É o caminho normal — a data nova é
 * a da próxima etapa. Um aviso que aparece em 19 de cada 20 cliques só ensina a
 * clicar por cima.
 *
 * Fluxo correto, e o que este teste tranca: a mãe fica concluída com a data em
 * que venceu, a próxima nasce na data nova, e o pop-up trata só da notificação
 * no grupo. Quem for reintroduzir o aviso passa por aqui primeiro.
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

const renderDialog = (over: { onConfirm?: () => Promise<void>; onClose?: () => void } = {}) =>
  render(
    <CompleteAndNotifyDialog
      open
      onClose={over.onClose ?? (() => {})}
      onConfirm={over.onConfirm ?? (async () => {})}
      leadId="lead-1"
      buildMsg={() => 'mensagem'}
      preloadedGroups={[]}
    />,
  );

describe('CompleteAndNotifyDialog — prazo alterado antes de concluir', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não avisa nada sobre prazo, nem oferece adiar', async () => {
    renderDialog();
    await screen.findByText('Concluir e Criar Próxima Atividade');

    expect(screen.queryByText(/mudou o prazo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adiar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /não concluir/i })).not.toBeInTheDocument();
  });

  it('o pop-up trata só da notificação: confirmar conclui direto', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    renderDialog({ onConfirm, onClose });

    fireEvent.click(await screen.findByRole('button', { name: /^Concluir$/ }));

    // Sem grupo vinculado não vai notificação nenhuma junto.
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

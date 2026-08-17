/**
 * Regressão da lentidão do "Concluir + próxima".
 *
 * O dialog buscava os grupos do lead NO CLIQUE, com todo o conteúdo escondido
 * atrás de um spinner: uma ida ao banco quando o lead tem grupo vinculado e
 * duas em série quando não tem — o caso mais comum. Na fila do modo workflow
 * isso se repetia a cada atividade concluída.
 *
 * A ficha passou a pré-carregar os grupos junto com o resto do lead. Os
 * invariantes cobertos aqui:
 *  1. com preload, abrir o dialog não faz NENHUMA requisição;
 *  2. sem preload, a busca no clique continua existindo (fallback intacto);
 *  3. o segundo round-trip só ocorre quando não há grupo vinculado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { fakeClient, counts, setRows, setError, resetCounts, sessao, ensureSession } = vi.hoisted(() => {
  const counts: Record<string, number> = {};
  const rows: Record<string, unknown[]> = {};
  const errors: Record<string, unknown> = {};
  // Ordem importa: a policy é `TO authenticated`, então a sessão precisa estar
  // de pé ANTES da query — senão o PostgREST devolve zero linha em vez de erro.
  const sessao = { chamadas: 0, antesDaQuery: false };
  const ensureSession = async () => {
    sessao.chamadas += 1;
    sessao.antesDaQuery = Object.keys(counts).length === 0;
  };

  const chain = (table: string): any => {
    const p: any = errors[table]
      ? Promise.resolve({ data: null, error: errors[table] })
      : Promise.resolve({ data: rows[table] ?? [], error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => (errors[table]
            ? Promise.resolve({ data: null, error: errors[table] })
            : Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }));
        }
        return () => chain(table);
      },
      apply: () => chain(table),
    });
  };

  return {
    counts,
    sessao,
    ensureSession,
    resetCounts: () => {
      for (const k of Object.keys(counts)) delete counts[k];
      for (const k of Object.keys(errors)) delete errors[k];
      sessao.chamadas = 0;
      sessao.antesDaQuery = false;
    },
    setRows: (table: string, data: unknown[]) => { rows[table] = data; },
    setError: (table: string, err: unknown) => { errors[table] = err; },
    fakeClient: {
      from: (table: string) => {
        counts[table] = (counts[table] ?? 0) + 1;
        return chain(table);
      },
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
  ensureExternalSession: ensureSession,
}));
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: { invoke: async () => ({ data: null, error: null }) },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { CompleteAndNotifyDialog, fetchLeadGroupOptions } from '../CompleteAndNotifyDialog';

const LEAD = 'lead-1';

/** Um grupo vinculado, como vem de `lead_whatsapp_groups`. */
const grupoVinculado = {
  id: 'g-1',
  label: 'PREV 77 - Grupo do Cliente',
  group_jid: '120363000000000000@g.us',
  group_name: 'PREV 77',
};

const renderDialog = (preloadedGroups: any) =>
  render(
    <CompleteAndNotifyDialog
      open
      onClose={() => {}}
      onConfirm={async () => {}}
      leadId={LEAD}
      buildMsg={() => 'mensagem'}
      preloadedGroups={preloadedGroups}
    />,
  );

describe('CompleteAndNotifyDialog — grupos pré-carregados pela ficha', () => {
  beforeEach(() => {
    resetCounts();
    setRows('lead_whatsapp_groups', []);
    setRows('leads', []);
  });

  it('com preload, abrir não dispara nenhuma requisição', async () => {
    renderDialog([grupoVinculado]);

    // O dialog abre pronto: título visível e nada de spinner.
    expect(await screen.findByText('Concluir e Criar Próxima Atividade')).toBeInTheDocument();
    expect(screen.getByText('Notificar no grupo')).toBeInTheDocument();

    // O invariante: zero ida ao banco no clique.
    expect(counts['lead_whatsapp_groups'] ?? 0).toBe(0);
    expect(counts['leads'] ?? 0).toBe(0);
  });

  it('com preload, o grupo já vem selecionável (não cai em "nenhum grupo vinculado")', async () => {
    renderDialog([grupoVinculado]);

    await screen.findByText('Concluir e Criar Próxima Atividade');
    expect(screen.queryByText('(nenhum grupo vinculado)')).not.toBeInTheDocument();
    // Grupo único: já vem marcado para notificar, com o botão de confirmar pronto.
    expect(await screen.findByRole('button', { name: /Concluir e Notificar/i })).toBeInTheDocument();
  });

  it('sem preload, a busca no clique continua funcionando (fallback intacto)', async () => {
    setRows('lead_whatsapp_groups', [grupoVinculado]);
    renderDialog(null);

    await waitFor(() => expect(counts['lead_whatsapp_groups'] ?? 0).toBe(1));
    expect(await screen.findByRole('button', { name: /Concluir e Notificar/i })).toBeInTheDocument();
  });
});

describe('fetchLeadGroupOptions — custo da busca que saiu do clique', () => {
  beforeEach(() => {
    resetCounts();
    setRows('lead_whatsapp_groups', []);
    setRows('leads', []);
  });

  it('lead COM grupo vinculado: uma única ida ao banco', async () => {
    setRows('lead_whatsapp_groups', [grupoVinculado]);

    const groups = await fetchLeadGroupOptions(LEAD);

    expect(groups).toHaveLength(1);
    expect(groups[0].group_jid).toBe(grupoVinculado.group_jid);
    expect(counts['lead_whatsapp_groups']).toBe(1);
    expect(counts['leads'] ?? 0).toBe(0);
  });

  it('lead SEM grupo vinculado: duas idas em série, e o legado vira opção', async () => {
    setRows('leads', [{ whatsapp_group_id: '120363000000000001@g.us', lead_name: 'Fulano' }]);

    const groups = await fetchLeadGroupOptions(LEAD);

    expect(counts['lead_whatsapp_groups']).toBe(1);
    expect(counts['leads']).toBe(1);
    expect(groups).toEqual([
      {
        id: 'legacy',
        label: 'Grupo Fulano',
        group_jid: '120363000000000001@g.us',
        group_name: 'Fulano',
      },
    ]);
  });

  it('lead sem grupo nenhum: lista vazia', async () => {
    const groups = await fetchLeadGroupOptions(LEAD);
    expect(groups).toEqual([]);
  });
});

/**
 * Incidente 17/08/2026: o "Concluir + próxima" parou de mandar áudio ao grupo
 * sem dar um pio. A policy do `lead_whatsapp_groups` é `TO authenticated`, então
 * sem sessão o PostgREST devolve ZERO LINHA (não erro) — e o `const { data }`
 * original ainda descartava o erro. Nos dois casos a falha chegava ao dialog
 * como "(nenhum grupo vinculado)", que desliga a notificação em silêncio.
 * Enquanto a busca só rodava no clique isso não aparecia; o pré-carregamento
 * junto da ficha a colocou correndo com o bootstrap da sessão.
 */
describe('fetchLeadGroupOptions — falha nunca pode virar "sem grupo"', () => {
  beforeEach(() => {
    resetCounts();
    setRows('lead_whatsapp_groups', []);
    setRows('leads', []);
  });

  it('garante a sessão do Externo ANTES de consultar', async () => {
    setRows('lead_whatsapp_groups', [grupoVinculado]);

    await fetchLeadGroupOptions(LEAD);

    expect(sessao.chamadas).toBe(1);
    expect(sessao.antesDaQuery).toBe(true);
  });

  it('erro na busca dos grupos sobe como exceção (não devolve lista vazia)', async () => {
    setError('lead_whatsapp_groups', { message: 'permission denied' });

    await expect(fetchLeadGroupOptions(LEAD)).rejects.toMatchObject({ message: 'permission denied' });
  });

  it('erro na busca do grupo legado também sobe como exceção', async () => {
    setError('leads', { message: 'JWT expired' });

    await expect(fetchLeadGroupOptions(LEAD)).rejects.toMatchObject({ message: 'JWT expired' });
  });
});

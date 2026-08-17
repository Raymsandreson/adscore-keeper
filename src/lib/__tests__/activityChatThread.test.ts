/**
 * Chat da atividade ancorado na CADEIA — ago/2026.
 *
 * O que estes testes travam:
 *  - ficha sem continuidade continua sendo o chat dela mesma;
 *  - elo do meio lê a cadeia inteira e escreve na raiz;
 *  - banco sem a migration da cadeia (42703) não quebra o chat;
 *  - a notificação abre a etapa VIVA, não a raiz concluída;
 *  - follower legado (gravado no id do elo) é traduzido para a raiz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, externalMock } = vi.hoisted(() => {
  interface Elo {
    id: string;
    chain_root_id: string | null;
    status?: string | null;
    created_at: string;
    deleted_at?: string | null;
  }
  const state = {
    elos: [] as Elo[],
    /** Simula banco sem as colunas da cadeia. */
    semColunaDaCadeia: false,
    queries: 0,
  };

  const erroColuna = { code: '42703', message: 'column "chain_root_id" does not exist' };

  const externalMock = {
    from(table: string) {
      if (table !== 'lead_activities') throw new Error(`tabela inesperada: ${table}`);
      state.queries++;
      return {
        select: () => {
          const vivos = () => state.elos.filter(e => !e.deleted_at);
          return {
            // Raiz de UMA atividade.
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (state.semColunaDaCadeia) return { data: null, error: erroColuna };
                const row = state.elos.find(e => e.id === id) || null;
                return { data: row, error: null };
              },
            }),
            // Raiz de VÁRIAS (followers legados).
            in: async (_col: string, ids: string[]) => {
              if (state.semColunaDaCadeia) return { data: null, error: erroColuna };
              return { data: state.elos.filter(e => ids.includes(e.id)), error: null };
            },
            // Elos da cadeia: `chain_root_id.eq.<raiz>,id.eq.<raiz>`.
            or: (filtro: string) => ({
              is: () => ({
                order: async () => {
                  if (state.semColunaDaCadeia) return { data: null, error: erroColuna };
                  const raiz = filtro.split('chain_root_id.eq.')[1].split(',')[0];
                  const data = vivos()
                    .filter(e => e.id === raiz || e.chain_root_id === raiz)
                    .sort((a, b) => a.created_at.localeCompare(b.created_at));
                  return { data, error: null };
                },
              }),
            }),
          };
        },
      };
    },
  };

  return { state, externalMock };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: externalMock,
  ensureExternalSession: async () => {},
}));

import {
  resolveActivityChatThread,
  resolveActivityChatRoots,
  resolveOpenActivityOfChain,
  __clearActivityChatThreadCache,
} from '../activityChatThread';

/** Cadeia real de 07/08/2026: 3 etapas, as duas primeiras já concluídas. */
const CADEIA = [
  { id: 'raiz', chain_root_id: null, status: 'concluida', created_at: '2026-08-04T20:12:00Z' },
  { id: 'elo2', chain_root_id: 'raiz', status: 'concluida', created_at: '2026-08-07T20:21:00Z' },
  { id: 'elo3', chain_root_id: 'raiz', status: 'pendente', created_at: '2026-08-14T21:49:00Z' },
];

beforeEach(() => {
  __clearActivityChatThreadCache();
  state.elos = CADEIA.map(e => ({ ...e }));
  state.semColunaDaCadeia = false;
  state.queries = 0;
});

describe('resolveActivityChatThread', () => {
  it('atividade sem continuidade fica com o chat dela mesma', async () => {
    state.elos = [{ id: 'sozinha', chain_root_id: null, status: 'pendente', created_at: '2026-08-01T10:00:00Z' }];
    const t = await resolveActivityChatThread('sozinha');
    expect(t).toEqual({ rootId: 'sozinha', ids: ['sozinha'] });
  });

  it('elo novo lê a cadeia inteira e escreve na raiz', async () => {
    const t = await resolveActivityChatThread('elo3');
    expect(t.rootId).toBe('raiz');
    expect(t.ids).toEqual(['raiz', 'elo2', 'elo3']);
  });

  it('abrir a raiz dá o mesmo thread de abrir o último elo', async () => {
    const daRaiz = await resolveActivityChatThread('raiz');
    __clearActivityChatThreadCache();
    const doElo = await resolveActivityChatThread('elo3');
    expect(daRaiz).toEqual(doElo);
  });

  it('o cache serve todos os elos: uma resolução vale para a cadeia toda', async () => {
    await resolveActivityChatThread('elo3');
    const antes = state.queries;
    await resolveActivityChatThread('raiz');
    await resolveActivityChatThread('elo2');
    expect(state.queries).toBe(antes);
  });

  it('etapa apagada continua mostrando o que foi dito nela', async () => {
    state.elos.push({ id: 'apagada', chain_root_id: 'raiz', created_at: '2026-08-15T10:00:00Z', deleted_at: '2026-08-16T10:00:00Z' });
    const t = await resolveActivityChatThread('apagada');
    expect(t.rootId).toBe('raiz');
    expect(t.ids).toContain('apagada');
  });

  it('banco sem a migration da cadeia não quebra o chat', async () => {
    state.semColunaDaCadeia = true;
    const t = await resolveActivityChatThread('elo3');
    expect(t).toEqual({ rootId: 'elo3', ids: ['elo3'] });
  });
});

describe('resolveOpenActivityOfChain', () => {
  it('leva à etapa aberta, não à raiz concluída', async () => {
    expect(await resolveOpenActivityOfChain('raiz')).toBe('elo3');
  });

  it('cadeia toda concluída abre o último elo', async () => {
    state.elos = state.elos.map(e => ({ ...e, status: 'concluida' }));
    expect(await resolveOpenActivityOfChain('raiz')).toBe('elo3');
  });

  it('atividade inexistente devolve ela mesma, sem inventar destino', async () => {
    expect(await resolveOpenActivityOfChain('fantasma')).toBe('fantasma');
  });
});

describe('resolveActivityChatRoots', () => {
  it('traduz o follower legado do elo para a raiz', async () => {
    const raizes = await resolveActivityChatRoots(['elo2', 'elo3']);
    expect(raizes.get('elo2')).toBe('raiz');
    expect(raizes.get('elo3')).toBe('raiz');
  });

  it('quem já segue a raiz não vira entrada nova', async () => {
    const raizes = await resolveActivityChatRoots(['raiz']);
    expect(raizes.size).toBe(0);
  });

  it('lista vazia não vai ao banco', async () => {
    state.queries = 0;
    await resolveActivityChatRoots([]);
    expect(state.queries).toBe(0);
  });
});

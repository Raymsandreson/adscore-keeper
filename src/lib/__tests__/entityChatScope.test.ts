/**
 * Chat interno ancorado no PROCESSO — 18/08/2026.
 *
 * O que estes testes travam:
 *  - atividade com processo escreve no processo e lê processo + atividades dele;
 *  - abrir a atividade ou abrir o processo dá EXATAMENTE o mesmo escopo (é o que
 *    faz os dois docks mostrarem a mesma conversa e dividirem o cache);
 *  - o legado gravado por atividade continua à vista, sem sair do lugar;
 *  - atividade sem processo mantém a cadeia (lê os elos, escreve na raiz);
 *  - ficha que não é atividade/processo não vai ao banco;
 *  - banco sem a coluna do processo não quebra o chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, externalMock } = vi.hoisted(() => {
  interface Ativ {
    id: string;
    chain_root_id: string | null;
    process_id: string | null;
    status?: string | null;
    created_at: string;
    deleted_at?: string | null;
  }
  const state = {
    ativs: [] as Ativ[],
    processos: [] as { id: string; process_number: string | null; title: string | null }[],
    /** Simula banco sem as colunas novas. */
    semColuna: false,
    queries: 0,
  };

  const erroColuna = { code: '42703', message: 'column "process_id" does not exist' };
  const vivos = () => state.ativs.filter(a => !a.deleted_at);

  /** Resolve um `or=` de lead_activities contra a fixture. */
  const porOr = (filtro: string) => {
    const proc = filtro.match(/process_id\.eq\.([^,)]+)/)?.[1];
    const raiz = filtro.match(/chain_root_id\.eq\.([^,)]+)/)?.[1];
    return vivos()
      .filter(a => (proc && a.process_id === proc) || (raiz && (a.id === raiz || a.chain_root_id === raiz)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  };

  const externalMock = {
    from(table: string) {
      state.queries++;
      const ctx: { table: string; or?: string; eqId?: string } = { table };
      const api: any = {
        select: () => api,
        eq: (_c: string, v: string) => { ctx.eqId = v; return api; },
        or: (f: string) => { ctx.or = f; return api; },
        is: () => api,
        order: async () => resolveLista(),
        limit: async () => resolveLista(),
        in: async (_c: string, ids: string[]) => {
          if (state.semColuna) return { data: null, error: erroColuna };
          return { data: state.ativs.filter(a => ids.includes(a.id)), error: null };
        },
        maybeSingle: async () => {
          if (ctx.table === 'lead_processes') {
            return { data: state.processos.find(p => p.id === ctx.eqId) || null, error: null };
          }
          if (state.semColuna) return { data: null, error: erroColuna };
          return { data: state.ativs.find(a => a.id === ctx.eqId) || null, error: null };
        },
      };
      const resolveLista = async () => {
        if (state.semColuna) return { data: null, error: erroColuna };
        return { data: porOr(ctx.or || ''), error: null };
      };
      return api;
    },
  };

  return { state, externalMock };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: externalMock,
  ensureExternalSession: async () => {},
}));

import { resolveChatScope, resolveActivityProcessIds, __clearChatScopeCache } from '../entityChatScope';
import { __clearActivityChatThreadCache } from '../activityChatThread';

/** Recorte real do CASO 180: um processo com cadeia de atividades + uma interna. */
const PROC = 'p-acidente';
const ATIVS = [
  { id: 'a-jul21', chain_root_id: null, process_id: PROC, status: 'concluida', created_at: '2026-07-21T10:00:00Z' },
  { id: 'a-jul28', chain_root_id: null, process_id: PROC, status: 'concluida', created_at: '2026-07-28T10:00:00Z' },
  { id: 'a-ago11', chain_root_id: 'a-jul28', process_id: PROC, status: 'concluida', created_at: '2026-08-11T10:00:00Z' },
  { id: 'a-ago18', chain_root_id: 'a-jul28', process_id: PROC, status: 'pendente', created_at: '2026-08-18T10:00:00Z' },
  { id: 'a-interna', chain_root_id: null, process_id: null, status: 'concluida', created_at: '2026-08-01T10:00:00Z' },
  { id: 'a-interna2', chain_root_id: 'a-interna', process_id: null, status: 'pendente', created_at: '2026-08-05T10:00:00Z' },
];

beforeEach(() => {
  __clearChatScopeCache();
  __clearActivityChatThreadCache();
  state.ativs = ATIVS.map(a => ({ ...a }));
  state.processos = [{ id: PROC, process_number: '0016855-58.2023.5.16.0008', title: 'ACIDENTE DE TRABALHO' }];
  state.semColuna = false;
  state.queries = 0;
});

const ids = (scope: Awaited<ReturnType<typeof resolveChatScope>>, tipo: string) =>
  (scope.read.find(r => r.type === tipo)?.ids || []).slice().sort();

describe('resolveChatScope — atividade com processo', () => {
  it('escreve no processo, não na atividade', async () => {
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(s.writeType).toBe('process');
    expect(s.writeId).toBe(PROC);
    // O entity_name carimbado passa a ser o do processo — é o que a pessoa vê
    // na lista de menções.
    expect(s.writeName).toBe('0016855-58.2023.5.16.0008');
  });

  it('lê o processo E todas as atividades dele — o legado não sai do lugar', async () => {
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(ids(s, 'process')).toEqual([PROC]);
    expect(ids(s, 'activity')).toEqual(['a-ago11', 'a-ago18', 'a-jul21', 'a-jul28']);
  });

  it('abrir qualquer atividade do processo dá o mesmo escopo', async () => {
    const doElo = await resolveChatScope('activity', 'a-ago18');
    __clearChatScopeCache();
    __clearActivityChatThreadCache();
    const daVelha = await resolveChatScope('activity', 'a-jul21');
    expect(daVelha).toEqual(doElo);
  });

  it('abrir o processo dá o mesmo escopo de abrir a atividade', async () => {
    const daAtividade = await resolveChatScope('activity', 'a-ago18');
    __clearChatScopeCache();
    const doProcesso = await resolveChatScope('process', PROC);
    expect(doProcesso).toEqual(daAtividade);
  });

  it('uma resolução serve as duas pontas: o cache indexa processo e atividades', async () => {
    await resolveChatScope('activity', 'a-ago18');
    const antes = state.queries;
    await resolveChatScope('process', PROC);
    await resolveChatScope('activity', 'a-jul21');
    expect(state.queries).toBe(antes);
  });

  it('atividade apagada continua mostrando o que foi dito nela', async () => {
    state.ativs.push({
      id: 'a-apagada', chain_root_id: 'a-jul28', process_id: PROC,
      created_at: '2026-08-19T10:00:00Z', deleted_at: '2026-08-19T12:00:00Z',
    });
    const s = await resolveChatScope('activity', 'a-apagada');
    expect(s.writeId).toBe(PROC);
    expect(ids(s, 'activity')).toContain('a-apagada');
  });
});

describe('resolveChatScope — atividade sem processo', () => {
  it('mantém a cadeia: lê os elos e escreve na raiz', async () => {
    const s = await resolveChatScope('activity', 'a-interna2');
    expect(s.writeType).toBe('activity');
    expect(s.writeId).toBe('a-interna');
    expect(ids(s, 'activity')).toEqual(['a-interna', 'a-interna2']);
    expect(s.processLabel).toBeNull();
  });

  it('atividade solta é o chat dela mesma', async () => {
    state.ativs = [{ id: 'sozinha', chain_root_id: null, process_id: null, created_at: '2026-08-01T10:00:00Z' }];
    const s = await resolveChatScope('activity', 'sozinha');
    expect(s.writeType).toBe('activity');
    expect(s.writeId).toBe('sozinha');
    expect(ids(s, 'activity')).toEqual(['sozinha']);
  });
});

describe('resolveChatScope — resto do sistema', () => {
  it('lead/contato/WhatsApp são o próprio thread, sem ida ao banco', async () => {
    const s = await resolveChatScope('lead', 'lead-1');
    expect(s).toEqual({
      writeType: 'lead', writeId: 'lead-1', writeName: null,
      read: [{ type: 'lead', ids: ['lead-1'] }], processLabel: null,
    });
    expect(state.queries).toBe(0);
  });

  it('banco sem a coluna do processo cai na cadeia em vez de quebrar', async () => {
    state.semColuna = true;
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(s.writeType).toBe('activity');
    expect(s.writeId).toBe('a-ago18');
  });
});

describe('resolveActivityProcessIds', () => {
  it('traduz o follower legado da atividade para o processo', async () => {
    const m = await resolveActivityProcessIds(['a-ago11', 'a-interna']);
    expect(m.get('a-ago11')).toBe(PROC);
    // Atividade sem processo não vira entrada: o follower dela segue valendo.
    expect(m.has('a-interna')).toBe(false);
  });

  it('lista vazia não vai ao banco', async () => {
    state.queries = 0;
    await resolveActivityProcessIds([]);
    expect(state.queries).toBe(0);
  });
});

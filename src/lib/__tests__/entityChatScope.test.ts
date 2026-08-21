/**
 * Chat interno ancorado no CASO — 19/08/2026.
 *
 * O que estes testes travam:
 *  - atividade de um caso escreve no CASO e lê caso + processos + atividades;
 *  - a conversa atravessa processos: o que foi dito na ficha do SEGURO DE VIDA
 *    aparece na do ACIDENTE DE TRABALHO (é o ponto do escopo por caso);
 *  - abrir a atividade, o processo ou o caso dá EXATAMENTE o mesmo escopo — é o
 *    que faz os três docks mostrarem a mesma conversa e dividirem o cache;
 *  - o legado gravado por atividade e por processo continua à vista;
 *  - processo órfão de caso fica no processo;
 *  - atividade sem caso e sem processo mantém a cadeia (lê os elos, escreve na raiz);
 *  - ficha que não é atividade/processo/caso não vai ao banco;
 *  - banco sem as colunas novas não quebra o chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, externalMock } = vi.hoisted(() => {
  interface Ativ {
    id: string;
    chain_root_id: string | null;
    process_id: string | null;
    case_id: string | null;
    created_at: string;
    deleted_at?: string | null;
  }
  const state = {
    ativs: [] as Ativ[],
    processos: [] as { id: string; case_id: string | null; process_number: string | null; title: string | null }[],
    casos: [] as { id: string; case_number: string | null; title: string | null }[],
    /** Simula banco sem as colunas novas. */
    semColuna: false,
    queries: 0,
  };

  const erroColuna = { code: '42703', message: 'column "case_id" does not exist' };
  const vivos = () => state.ativs.filter(a => !a.deleted_at);

  /** Lista os valores de `col.in.(a,b)` ou `col.eq.x` dentro de um `or=`. */
  const alvos = (filtro: string, col: string): string[] => {
    const dentro = filtro.match(new RegExp(`${col}\\.in\\.\\(([^)]*)\\)`))?.[1];
    if (dentro) return dentro.split(',').filter(Boolean);
    const um = filtro.match(new RegExp(`${col}\\.eq\\.([^,)]+)`))?.[1];
    return um ? [um] : [];
  };

  /** Resolve um `or=` de lead_activities contra a fixture. */
  const porOr = (filtro: string) => {
    const casos = alvos(filtro, 'case_id');
    const procs = alvos(filtro, 'process_id');
    const ids = alvos(filtro, 'id');
    const raizes = alvos(filtro, 'chain_root_id');
    return vivos()
      .filter(a =>
        (a.case_id && casos.includes(a.case_id)) ||
        (a.process_id && procs.includes(a.process_id)) ||
        ids.includes(a.id) ||
        (a.chain_root_id && raizes.includes(a.chain_root_id))
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  };

  const externalMock = {
    from(table: string) {
      state.queries++;
      const ctx: { table: string; or?: string; eq: Record<string, string> } = { table, eq: {} };

      const lista = async () => {
        if (state.semColuna) return { data: null, error: erroColuna };
        if (ctx.table === 'lead_processes') {
          return { data: state.processos.filter(p => p.case_id === ctx.eq.case_id), error: null };
        }
        return { data: porOr(ctx.or || ''), error: null };
      };

      const api: any = {
        select: () => api,
        eq: (c: string, v: string) => { ctx.eq[c] = v; return api; },
        or: (f: string) => { ctx.or = f; return api; },
        is: () => api,
        order: lista,
        limit: lista,
        in: async (_c: string, ids: string[]) => {
          if (state.semColuna) return { data: null, error: erroColuna };
          if (ctx.table === 'lead_processes') {
            return { data: state.processos.filter(p => ids.includes(p.id)), error: null };
          }
          return { data: state.ativs.filter(a => ids.includes(a.id)), error: null };
        },
        maybeSingle: async () => {
          if (ctx.table === 'legal_cases') {
            return { data: state.casos.find(c => c.id === ctx.eq.id) || null, error: null };
          }
          if (ctx.table === 'lead_processes') {
            return { data: state.processos.find(p => p.id === ctx.eq.id) || null, error: null };
          }
          if (state.semColuna) return { data: null, error: erroColuna };
          return { data: state.ativs.find(a => a.id === ctx.eq.id) || null, error: null };
        },
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

import { resolveChatScope, resolveThreadKeys, __clearChatScopeCache } from '../entityChatScope';
import { __clearActivityChatThreadCache } from '../activityChatThread';

/** Recorte real do CASO 180: dois processos, atividade sem processo e cadeia solta. */
const CASO = 'c-180';
const P_ACIDENTE = 'p-acidente';
const P_SEGURO = 'p-seguro';
const P_ORFAO = 'p-orfao';

const ATIVS = [
  { id: 'a-jul21', chain_root_id: null, process_id: P_ACIDENTE, case_id: CASO, created_at: '2026-07-21T10:00:00Z' },
  { id: 'a-jul28', chain_root_id: null, process_id: P_ACIDENTE, case_id: CASO, created_at: '2026-07-28T10:00:00Z' },
  { id: 'a-ago11', chain_root_id: 'a-jul28', process_id: P_ACIDENTE, case_id: CASO, created_at: '2026-08-11T10:00:00Z' },
  { id: 'a-ago18', chain_root_id: 'a-jul28', process_id: P_ACIDENTE, case_id: CASO, created_at: '2026-08-18T10:00:00Z' },
  // Outro processo do MESMO caso — a conversa tem que atravessar.
  { id: 'a-seguro', chain_root_id: null, process_id: P_SEGURO, case_id: CASO, created_at: '2026-05-12T10:00:00Z' },
  // "INSS atualizou …": nasce no caso, sem processo.
  { id: 'a-inss', chain_root_id: null, process_id: null, case_id: CASO, created_at: '2026-08-07T10:00:00Z' },
  // Processo sem caso (123 atividades reais em 19/08/2026).
  { id: 'a-orfa', chain_root_id: null, process_id: P_ORFAO, case_id: null, created_at: '2026-08-02T10:00:00Z' },
  // Nem caso nem processo: cadeia pura.
  { id: 'a-interna', chain_root_id: null, process_id: null, case_id: null, created_at: '2026-08-01T10:00:00Z' },
  { id: 'a-interna2', chain_root_id: 'a-interna', process_id: null, case_id: null, created_at: '2026-08-05T10:00:00Z' },
];

beforeEach(() => {
  __clearChatScopeCache();
  __clearActivityChatThreadCache();
  state.ativs = ATIVS.map(a => ({ ...a }));
  state.processos = [
    { id: P_ACIDENTE, case_id: CASO, process_number: '0016855-58.2023.5.16.0008', title: 'ACIDENTE DE TRABALHO' },
    { id: P_SEGURO, case_id: CASO, process_number: '0801753-23.2026.8.10.0024', title: 'SEGURO DE VIDA' },
    { id: P_ORFAO, case_id: null, process_number: '9999999-99.2026.8.10.0001', title: 'SEM CASO' },
  ];
  state.casos = [{ id: CASO, case_number: 'CASO 180', title: 'Caso 180 - Iago-Bacabal/MA' }];
  state.semColuna = false;
  state.queries = 0;
});

const ids = (scope: Awaited<ReturnType<typeof resolveChatScope>>, tipo: string) =>
  (scope.read.find(r => r.type === tipo)?.ids || []).slice().sort();

describe('resolveChatScope — atividade de um caso', () => {
  it('escreve no caso, não na atividade nem no processo', async () => {
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(s.kind).toBe('case');
    expect(s.writeType).toBe('case');
    expect(s.writeId).toBe(CASO);
    // O entity_name carimbado passa a ser o do caso — é o que a pessoa vê na
    // lista de menções.
    expect(s.writeName).toBe('CASO 180');
    expect(s.label).toBe('CASO 180');
  });

  it('lê o caso, os processos E todas as atividades — o legado não sai do lugar', async () => {
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(ids(s, 'case')).toEqual([CASO]);
    expect(ids(s, 'process')).toEqual([P_ACIDENTE, P_SEGURO]);
    expect(ids(s, 'activity')).toEqual(
      ['a-ago11', 'a-ago18', 'a-inss', 'a-jul21', 'a-jul28', 'a-seguro']
    );
  });

  it('a conversa atravessa processos do mesmo caso', async () => {
    const doAcidente = await resolveChatScope('activity', 'a-ago18');
    // A ficha do SEGURO DE VIDA é de outro processo e entra na mesma conversa.
    expect(ids(doAcidente, 'activity')).toContain('a-seguro');
    expect(ids(doAcidente, 'process')).toContain(P_SEGURO);
  });

  it('abrir qualquer atividade do caso dá o mesmo escopo', async () => {
    const doElo = await resolveChatScope('activity', 'a-ago18');
    __clearChatScopeCache();
    __clearActivityChatThreadCache();
    const daOutraFicha = await resolveChatScope('activity', 'a-seguro');
    expect(daOutraFicha).toEqual(doElo);
  });

  it('abrir o processo ou o caso dá o mesmo escopo da atividade', async () => {
    const daAtividade = await resolveChatScope('activity', 'a-ago18');
    __clearChatScopeCache();
    const doProcesso = await resolveChatScope('process', P_ACIDENTE);
    __clearChatScopeCache();
    const doCaso = await resolveChatScope('case', CASO);
    expect(doProcesso).toEqual(daAtividade);
    expect(doCaso).toEqual(daAtividade);
  });

  it('uma resolução serve as três pontas: o cache indexa caso, processos e atividades', async () => {
    await resolveChatScope('activity', 'a-ago18');
    const antes = state.queries;
    await resolveChatScope('case', CASO);
    await resolveChatScope('process', P_SEGURO);
    await resolveChatScope('activity', 'a-jul21');
    expect(state.queries).toBe(antes);
  });

  it('atividade apagada continua mostrando o que foi dito nela', async () => {
    state.ativs.push({
      id: 'a-apagada', chain_root_id: 'a-jul28', process_id: P_ACIDENTE, case_id: CASO,
      created_at: '2026-08-19T10:00:00Z', deleted_at: '2026-08-19T12:00:00Z',
    });
    const s = await resolveChatScope('activity', 'a-apagada');
    expect(s.writeId).toBe(CASO);
    expect(ids(s, 'activity')).toContain('a-apagada');
  });
});

describe('resolveChatScope — fora do caso', () => {
  it('processo sem caso fica no processo', async () => {
    const s = await resolveChatScope('activity', 'a-orfa');
    expect(s.kind).toBe('process');
    expect(s.writeType).toBe('process');
    expect(s.writeId).toBe(P_ORFAO);
    expect(s.label).toBe('9999999-99.2026.8.10.0001');
    expect(ids(s, 'activity')).toEqual(['a-orfa']);
    expect(s.read.find(r => r.type === 'case')).toBeUndefined();
  });

  it('atividade sem caso e sem processo mantém a cadeia: lê os elos e escreve na raiz', async () => {
    const s = await resolveChatScope('activity', 'a-interna2');
    expect(s.kind).toBe('chain');
    expect(s.writeType).toBe('activity');
    expect(s.writeId).toBe('a-interna');
    expect(ids(s, 'activity')).toEqual(['a-interna', 'a-interna2']);
    expect(s.label).toBeNull();
  });

  it('atividade solta é o chat dela mesma', async () => {
    state.ativs = [{ id: 'sozinha', chain_root_id: null, process_id: null, case_id: null, created_at: '2026-08-01T10:00:00Z' }];
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
      kind: 'solo', writeType: 'lead', writeId: 'lead-1', writeName: null,
      read: [{ type: 'lead', ids: ['lead-1'] }], label: null,
    });
    expect(state.queries).toBe(0);
  });

  it('banco sem as colunas novas cai na cadeia em vez de quebrar', async () => {
    state.semColuna = true;
    const s = await resolveChatScope('activity', 'a-ago18');
    expect(s.writeType).toBe('activity');
    expect(s.writeId).toBe('a-ago18');
  });
});

describe('resolveThreadKeys', () => {
  it('traduz o follower legado da atividade e do processo para o caso', async () => {
    const chaves = await resolveThreadKeys({
      activityIds: ['a-ago11', 'a-orfa', 'a-interna'],
      processIds: [P_SEGURO],
    });
    expect(chaves.has(`case:${CASO}`)).toBe(true);
    // Atividade de processo órfão: a chave dele continua sendo o processo.
    expect(chaves.has(`process:${P_ORFAO}`)).toBe(true);
    // Quem seguia o processo continua avisado tanto pela chave velha…
    expect(chaves.has(`process:${P_SEGURO}`)).toBe(true);
    // Atividade sem caso e sem processo não vira chave: o follower dela segue valendo.
    expect(chaves.has('case:null')).toBe(false);
  });

  it('lista vazia não vai ao banco', async () => {
    state.queries = 0;
    await resolveThreadKeys({});
    expect(state.queries).toBe(0);
  });
});

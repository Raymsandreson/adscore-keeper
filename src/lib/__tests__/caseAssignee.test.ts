/**
 * Responsável de caso PREV — ago/2026.
 *
 * A escolha deixou de ser por processo e passou a morar no caso
 * (`legal_cases.assigned_to`). O que estes testes travam:
 *  - processo administrativo HERDA o responsável do caso, sem prompt;
 *  - processo judicial PERGUNTA e a escolha SUBSTITUI o do caso;
 *  - caso legado sem responsável pergunta uma vez e grava;
 *  - cancelar nunca apaga o responsável que já existia.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { state, externalMock } = vi.hoisted(() => {
  const state = {
    // Uma coluna por trilha, como em legal_cases.
    caseAssignee: null as string | null,          // assigned_to (administrativo)
    caseAssigneeJud: null as string | null,       // assigned_to_judicial
    profileName: null as string | null,
    updates: [] as Array<{ id: string; coluna: string; valor: string | null }>,
  };

  const externalMock = {
    from(table: string) {
      if (table === 'legal_cases') {
        return {
          // O resolver pede exatamente a coluna da trilha; devolvemos só ela.
          select: (coluna: string) => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  [coluna]: coluna === 'assigned_to_judicial'
                    ? state.caseAssigneeJud
                    : state.caseAssignee,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => ({
            eq: async (_col: string, id: string) => {
              const coluna = Object.keys(patch)[0];
              state.updates.push({ id, coluna, valor: patch[coluna] });
              if (coluna === 'assigned_to_judicial') state.caseAssigneeJud = patch[coluna];
              else state.caseAssignee = patch[coluna];
              return { error: null };
            },
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.profileName ? { full_name: state.profileName } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada no mock: ${table}`);
    },
  };

  return { state, externalMock };
});

vi.mock('@/integrations/supabase/external-client', () => ({ externalSupabase: externalMock }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));
// Prefixo "ext:" torna visível nos asserts se alguém esqueceu de remapear.
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  remapToExternal: async (u: string | null) => (u ? `ext:${u}` : null),
  remapToCloud: async (u: string | null) => (u?.startsWith('ext:') ? u.slice(4) : u),
}));

import {
  resolveProcessAssignment,
  pickCaseAssigneeForNewCase,
  isPrevCase,
  INSS_PREV_OPTIONS,
} from '@/lib/processAssignment';

const JOSE = INSS_PREV_OPTIONS[2];      // rodízio administrativo do final 4
const ISABELA = INSS_PREV_OPTIONS[6];   // judicial de final par
const GISELE = INSS_PREV_OPTIONS[5];    // judicial de final ímpar

/** Simula o usuário aceitando o valor pré-preenchido pelo rodízio. */
const aceitaSugestao = vi.fn((_msg: string, def?: string) => def ?? '');

beforeEach(() => {
  state.caseAssignee = null;
  state.caseAssigneeJud = null;
  state.profileName = null;
  state.updates = [];
  aceitaSugestao.mockClear();
  vi.stubGlobal('prompt', aceitaSugestao);
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

const inssNoPrev1984 = (tipo: string) =>
  resolveProcessAssignment(
    'Benefício INSS',
    '✅PREV 1984 - AMANDA',
    'cloud-user',
    'PREV 1984',
    tipo,
    'case-1',
  );

describe('processo administrativo em caso PREV', () => {
  it('herda o responsável do caso sem abrir prompt', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;

    const r = await inssNoPrev1984('administrativo');

    expect(aceitaSugestao).not.toHaveBeenCalled();
    expect(r.extAssignedTo).toBe(`ext:${JOSE.userId}`);
    expect(r.assignedName).toBe(JOSE.userName);
    expect(state.updates).toHaveLength(0);
  });

  it('resolve o nome pelo profiles do Externo quando o dono não é um dos 7', async () => {
    state.caseAssignee = 'ext:11111111-1111-1111-1111-111111111111';
    state.profileName = 'Fulana de Tal';

    const r = await inssNoPrev1984('administrativo');

    expect(r.assignedName).toBe('Fulana de Tal');
    expect(aceitaSugestao).not.toHaveBeenCalled();
  });

  it('trilha ainda sem responsável: pergunta uma vez e grava no caso', async () => {
    const r = await inssNoPrev1984('administrativo');

    expect(aceitaSugestao).toHaveBeenCalledTimes(1);
    // final 4 → rodízio administrativo cai no José
    expect(r.assignedName).toBe(JOSE.userName);
    expect(state.updates).toEqual([{ id: 'case-1', coluna: 'assigned_to', valor: `ext:${JOSE.userId}` }]);
  });
});

describe('processo judicial em caso PREV', () => {
  it('grava na coluna judicial e NÃO toca no responsável administrativo', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;

    const r = await inssNoPrev1984('judicial');

    expect(aceitaSugestao).toHaveBeenCalledTimes(1);
    expect(r.extAssignedTo).toBe(`ext:${ISABELA.userId}`);
    expect(state.updates).toEqual([
      { id: 'case-1', coluna: 'assigned_to_judicial', valor: `ext:${ISABELA.userId}` },
    ]);
    // o administrativo continua com o José — é isso que "2 responsáveis" significa
    expect(state.caseAssignee).toBe(`ext:${JOSE.userId}`);
  });

  it('final ímpar sugere Gisele', async () => {
    const r = await resolveProcessAssignment(
      'Benefício INSS', '✅PREV 1985 - X', 'cloud-user', 'PREV 1985', 'judicial', 'case-1',
    );
    expect(r.assignedName).toBe(GISELE.userName);
  });

  it('segundo processo judicial herda calado, sem reabrir o prompt', async () => {
    state.caseAssigneeJud = `ext:${ISABELA.userId}`;

    const r = await inssNoPrev1984('judicial');

    expect(aceitaSugestao).not.toHaveBeenCalled();
    expect(r.extAssignedTo).toBe(`ext:${ISABELA.userId}`);
    expect(state.updates).toHaveLength(0);
  });

  it('administrativo e judicial convivem sem se enxergar', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;
    state.caseAssigneeJud = `ext:${GISELE.userId}`;

    const adm = await inssNoPrev1984('administrativo');
    const jud = await inssNoPrev1984('judicial');

    expect(adm.assignedName).toBe(JOSE.userName);
    expect(jud.assignedName).toBe(GISELE.userName);
    expect(aceitaSugestao).not.toHaveBeenCalled();
  });

  it('cancelar não escreve nada na trilha', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;
    aceitaSugestao.mockReturnValueOnce('' as any);

    await inssNoPrev1984('judicial');

    expect(state.updates).toHaveLength(0);
    expect(state.caseAssigneeJud).toBeNull();
  });
});

describe('precedência: o dono do caso PREV vence o mapa fixo', () => {
  // Decisão ago/2026: caso PREV tem um dono só, então nem "Seguro de Vida"
  // (Natasha) nem "Organizar docs" (Abderaman) escapam para o mapa fixo.
  it.each(['Seguro de Vida', 'Organizar docs', 'Onboarding', 'Indenização'])(
    '"%s" em caso PREV fica com o assessor do caso',
    async (titulo) => {
      state.caseAssignee = `ext:${JOSE.userId}`;

      const r = await resolveProcessAssignment(
        titulo, '✅PREV 1984 - AMANDA', 'cloud-user', 'PREV 1984', 'administrativo', 'case-1',
      );

      expect(r.assignedName).toBe(JOSE.userName);
      expect(aceitaSugestao).not.toHaveBeenCalled();
    },
  );

  it('fora do PREV o mapa fixo continua valendo', async () => {
    const r = await resolveProcessAssignment(
      'Seguro de Vida', 'CASO 384 - Camila', 'cloud-user', 'CASO-0384', 'administrativo', 'case-2',
    );
    expect(r.assignedName).toBe('Natasha');
  });

  it('Benefício INSS em caso CASO segue com Maria Clara', async () => {
    const r = await resolveProcessAssignment(
      'Benefício INSS', 'CASO 384 - Camila', 'cloud-user', 'CASO-0384', 'administrativo', 'case-2',
    );
    expect(r.assignedName).toBe('Maria Clara');
  });
});

describe('pickCaseAssigneeForNewCase', () => {
  it('não pergunta nada fora do funil PREV', async () => {
    expect(await pickCaseAssigneeForNewCase('CASO-0872', 'Camila - BPC')).toBeNull();
    expect(aceitaSugestao).not.toHaveBeenCalled();
  });

  it('sugere pelo rodízio administrativo — na criação ainda não há processo', async () => {
    const r = await pickCaseAssigneeForNewCase('PREV 1984', '✅PREV 1984 - AMANDA');

    expect(r).toEqual({ extAssignedTo: `ext:${JOSE.userId}`, assignedName: JOSE.userName });
  });

  it('cancelar deixa o caso sem responsável', async () => {
    aceitaSugestao.mockReturnValueOnce('' as any);
    expect(await pickCaseAssigneeForNewCase('PREV 1984', null)).toBeNull();
  });
});

describe('isPrevCase', () => {
  it('aceita PREV vindo do número ou do título, em qualquer caixa', () => {
    expect(isPrevCase(null, 'PREV 1984')).toBe(true);
    expect(isPrevCase('✅prev 12 - X', null)).toBe(true);
    expect(isPrevCase('CASO 384', 'CASO-0872')).toBe(false);
    expect(isPrevCase(null, null)).toBe(false);
  });
});

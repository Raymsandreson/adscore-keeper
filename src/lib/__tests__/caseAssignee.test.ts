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
    caseAssignee: null as string | null,
    profileName: null as string | null,
    updates: [] as Array<{ id: string; assigned_to: string | null }>,
  };

  const externalMock = {
    from(table: string) {
      if (table === 'legal_cases') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { assigned_to: state.caseAssignee }, error: null }),
            }),
          }),
          update: (patch: any) => ({
            eq: async (_col: string, id: string) => {
              state.updates.push({ id, assigned_to: patch.assigned_to });
              state.caseAssignee = patch.assigned_to;
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

  it('caso ainda sem responsável: pergunta uma vez e grava no caso', async () => {
    const r = await inssNoPrev1984('administrativo');

    expect(aceitaSugestao).toHaveBeenCalledTimes(1);
    // final 4 → rodízio administrativo cai no José
    expect(r.assignedName).toBe(JOSE.userName);
    expect(state.updates).toEqual([{ id: 'case-1', assigned_to: `ext:${JOSE.userId}` }]);
  });
});

describe('processo judicial em caso PREV', () => {
  it('pergunta e troca o responsável do caso (final par → Isabela)', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;

    const r = await inssNoPrev1984('judicial');

    expect(aceitaSugestao).toHaveBeenCalledTimes(1);
    expect(r.extAssignedTo).toBe(`ext:${ISABELA.userId}`);
    expect(r.assignedName).toBe(ISABELA.userName);
    expect(state.updates).toEqual([{ id: 'case-1', assigned_to: `ext:${ISABELA.userId}` }]);
  });

  it('final ímpar sugere Gisele', async () => {
    const r = await resolveProcessAssignment(
      'Benefício INSS', '✅PREV 1985 - X', 'cloud-user', 'PREV 1985', 'judicial', 'case-1',
    );
    expect(r.assignedName).toBe(GISELE.userName);
  });

  it('não regrava quando o escolhido já é o responsável do caso', async () => {
    state.caseAssignee = `ext:${ISABELA.userId}`;

    const r = await inssNoPrev1984('judicial');

    expect(r.extAssignedTo).toBe(`ext:${ISABELA.userId}`);
    expect(state.updates).toHaveLength(0);
  });

  it('cancelar preserva o responsável que o caso já tinha', async () => {
    state.caseAssignee = `ext:${JOSE.userId}`;
    aceitaSugestao.mockReturnValueOnce('' as any);

    const r = await inssNoPrev1984('judicial');

    expect(r.extAssignedTo).toBe(`ext:${JOSE.userId}`);
    expect(r.assignedName).toBe(JOSE.userName);
    expect(state.updates).toHaveLength(0);
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

describe('judicial em caso que já é da trilha judicial', () => {
  // Sem isso, cadastrar 3 processos judiciais em sequência abriria 3 prompts.
  it.each([
    ['Gisele', GISELE],
    ['Isabela', ISABELA],
  ])('caso da %s herda sem reabrir o prompt', async (_nome, pessoa: any) => {
    state.caseAssignee = `ext:${pessoa.userId}`;

    const r = await inssNoPrev1984('judicial');

    expect(aceitaSugestao).not.toHaveBeenCalled();
    expect(r.extAssignedTo).toBe(`ext:${pessoa.userId}`);
    expect(state.updates).toHaveLength(0);
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

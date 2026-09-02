/**
 * Troca de situação a partir da avaliação de feedback — set/2026.
 *
 * O que estes testes travam:
 *  - concluir carimba `completed_*` (igual ao completeActivity do hook);
 *  - SAIR de concluída limpa esses carimbos (igual ao "Reabrir" da ficha) —
 *    situação e carimbo de conclusão não podem discordar;
 *  - 'reagendada' grava a data em `rescheduled_to` (é o que o funil e o
 *    calendário leem), as outras situações gravam em `deadline`;
 *  - sem data escolhida, nenhuma coluna de data é tocada;
 *  - o responsável é avisado da mudança — e nunca a si mesmo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, externalMock } = vi.hoisted(() => {
  const state = {
    updates: [] as Array<Record<string, unknown>>,
    notificacoes: [] as Array<Record<string, unknown>>,
  };
  const externalMock = {
    from(table: string) {
      if (table === 'lead_activities') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => { state.updates.push(patch); return { error: null }; },
          }),
        };
      }
      if (table === 'activity_notifications') {
        return {
          insert: async (row: Record<string, unknown>) => { state.notificacoes.push(row); return { error: null }; },
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
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Raym' }, error: null }) }) }),
    }),
  },
}));

import { alterarSituacaoAtividade, type SituacaoAtual, type MudancaSituacao } from '@/lib/activityStatusChange';

const CONCLUIDA: SituacaoAtual = {
  id: 'atv-1',
  status: 'concluida',
  deadline: '2026-08-20',
  rescheduled_to: null,
  assigned_to: 'ext-alexandre',
  assigned_to_name: 'Alexandre Medeiros Cavalcante',
  title: 'Configuração 2FA certificado digital API Escavador',
};

const chamar = (atual: SituacaoAtual, mudanca: MudancaSituacao, extId = 'ext-raym') =>
  alterarSituacaoAtividade({ atual, mudanca, extId, cloudUserId: 'cloud-raym' });

beforeEach(() => { state.updates = []; state.notificacoes = []; });

describe('alterarSituacaoAtividade', () => {
  it('reabrir uma concluída limpa os carimbos de conclusão', async () => {
    await chamar(CONCLUIDA, { status: 'em_andamento', data: '2026-09-05' });
    const p = state.updates[0];
    expect(p.status).toBe('em_andamento');
    expect(p.completed_at).toBeNull();
    expect(p.completed_by).toBeNull();
    expect(p.completed_by_name).toBeNull();
    expect(p.deadline).toBe('2026-09-05');
  });

  it('concluir carimba quem concluiu e quando', async () => {
    await chamar({ ...CONCLUIDA, status: 'pendente' }, { status: 'concluida' });
    const p = state.updates[0];
    expect(p.status).toBe('concluida');
    expect(typeof p.completed_at).toBe('string');
    expect(p.completed_by).toBe('ext-raym');
    expect(p.completed_by_name).toBe('Raym');
  });

  it('reagendada grava a data do reagendamento, não o prazo', async () => {
    await chamar(CONCLUIDA, { status: 'reagendada', data: '2026-09-10' });
    const p = state.updates[0];
    expect(p.rescheduled_to).toBe('2026-09-10');
    expect(p).not.toHaveProperty('deadline');
  });

  it('sem data escolhida não mexe em prazo nenhum', async () => {
    await chamar(CONCLUIDA, { status: 'pendente', data: null });
    const p = state.updates[0];
    expect(p).not.toHaveProperty('deadline');
    expect(p).not.toHaveProperty('rescheduled_to');
  });

  it('avisa o responsável com a situação de antes e a de depois', async () => {
    await chamar(CONCLUIDA, { status: 'em_andamento', data: '2026-09-05' });
    expect(state.notificacoes).toHaveLength(1);
    const n = state.notificacoes[0];
    expect(n.recipient_id).toBe('ext-alexandre');
    expect(n.type).toBe('status');
    expect(String(n.body)).toContain('Concluída');
    expect(String(n.body)).toContain('Em Andamento');
    expect(String(n.body)).toContain('05/09/2026');
  });

  it('não avisa quando quem muda é o próprio responsável', async () => {
    await chamar(CONCLUIDA, { status: 'pendente' }, 'ext-alexandre');
    expect(state.notificacoes).toHaveLength(0);
  });
});

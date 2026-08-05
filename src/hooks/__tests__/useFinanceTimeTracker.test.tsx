import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * Regras do cronômetro no registro de controle financeiro (mesmas do WhatsApp):
 * registro grava tempo na guarda-chuva do dia; atividade específica e pausa têm
 * prioridade; a guarda-chuva do dia é reaproveitada em vez de duplicada.
 */

const startTimer = vi.fn(async () => {});
const stopTimerFor = vi.fn(async () => {});
const createActivity = vi.fn(async (..._args: any[]) => ({ id: 'nova-guarda-chuva' }));

// Cronômetro atual — cada teste ajusta antes de renderizar o bridge.
let currentTimer: { kind: string; activityId: string | null; activityTitle: string } | null = null;
// Linha que o Externo devolve na busca da guarda-chuva de hoje.
let umbrellaRow: { id: string; title: string; activity_type: string } | null = null;

vi.mock('@/contexts/ActivityTimerContext', () => ({
  useActivityTimer: () => ({ current: currentTimer, startTimer, stopTimerFor }),
}));
vi.mock('@/hooks/useLeadActivities', () => ({
  useLeadActivities: () => ({ createActivity }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'user-cloud' }, profile: { full_name: 'Fulana' } }),
}));
vi.mock('@/integrations/supabase', () => ({
  ensureExternalSession: vi.fn(async () => {}),
}));
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  remapToExternal: vi.fn(async () => 'user-ext'),
}));
vi.mock('@/integrations/supabase/external-client', () => {
  const q: any = {
    select: () => q,
    eq: () => q,
    is: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => void) => resolve({ data: umbrellaRow ? [umbrellaRow] : [] }),
  };
  return { externalSupabase: { from: () => q } };
});

import { trackFinanceEntry, useFinanceUmbrellaWatchdog } from '@/hooks/useFinanceTimeTracker';

/** Monta o bridge (o que o ActivityTimerOverlay faz em produção). */
function mountBridge() {
  renderHook(() => useFinanceUmbrellaWatchdog());
}

describe('trackFinanceEntry — tempo do registro financeiro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTimer = null;
    umbrellaRow = null;
  });

  it('parado: cria a guarda-chuva do dia e inicia o cronômetro nela', async () => {
    mountBridge();
    await trackFinanceEntry();

    expect(createActivity).toHaveBeenCalledTimes(1);
    const arg = createActivity.mock.calls[0][0] as any;
    expect(arg.title).toMatch(/^Controle Financeiro — \d{2}\/\d{2}\/\d{4}$/);
    expect(arg.is_management).toBe(true);
    expect(arg.assigned_to).toBe('user-cloud');
    expect(startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nova-guarda-chuva', activity_type: 'tarefa' })
    );
  });

  it('reaproveita a guarda-chuva de hoje em vez de criar outra', async () => {
    umbrellaRow = { id: 'ja-existe', title: 'Controle Financeiro — hoje', activity_type: 'tarefa' };
    mountBridge();
    await trackFinanceEntry();

    expect(createActivity).not.toHaveBeenCalled();
    expect(startTimer).toHaveBeenCalledWith(expect.objectContaining({ id: 'ja-existe' }));
  });

  it('ocioso (gap): assume o cronômetro', async () => {
    currentTimer = { kind: 'gap', activityId: null, activityTitle: 'Ocioso (entre atividades)' };
    mountBridge();
    await trackFinanceEntry();

    expect(startTimer).toHaveBeenCalledTimes(1);
  });

  it('outra atividade aberta tem prioridade: não rouba o cronômetro', async () => {
    currentTimer = { kind: 'activity', activityId: 'caso-123', activityTitle: 'Petição do caso X' };
    mountBridge();
    await trackFinanceEntry();

    expect(createActivity).not.toHaveBeenCalled();
    expect(startTimer).not.toHaveBeenCalled();
  });

  it('em pausa/almoço: respeita a pausa', async () => {
    currentTimer = { kind: 'break', activityId: null, activityTitle: 'Almoço' };
    mountBridge();
    await trackFinanceEntry();

    expect(startTimer).not.toHaveBeenCalled();
  });

  it('já contando a guarda-chuva: não reinicia o cronômetro a cada registro', async () => {
    mountBridge();
    await trackFinanceEntry(); // inicia — id 'nova-guarda-chuva'
    startTimer.mockClear();
    createActivity.mockClear();

    // O overlay re-renderiza a cada tick do cronômetro e reatualiza o bridge.
    currentTimer = { kind: 'activity', activityId: 'nova-guarda-chuva', activityTitle: 'Controle Financeiro — hoje' };
    mountBridge();
    await trackFinanceEntry();

    expect(startTimer).not.toHaveBeenCalled();
    expect(createActivity).not.toHaveBeenCalled();
  });
});

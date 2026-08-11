/**
 * Regressão: "o cronômetro fica desaparecendo".
 *
 * O overlay só desenhava algo em três casos — fora do expediente (botão de bater
 * o ponto), sessão recolhida (aba fina) e sessão aberta (painel). Faltava o
 * quarto: EXPEDIENTE ABERTO E SEM SESSÃO nesta aba. Acontece toda vez que outra
 * aba/janela assume o cronômetro (announceTakeover / assertOwnership chamam
 * sync(null) aqui) ou que uma troca falha — e a tela ficava sem nada: sem
 * contagem, sem botão, sem pista do que fazer, até um F5.
 *
 * A regra que este teste tranca: com o membro em expediente, SEMPRE existe um
 * controle de cronômetro na tela.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityTimerOverlay } from '../ActivityTimerOverlay';

const timer = vi.hoisted(() => ({
  current: null as unknown,
  lastActivity: null as unknown,
  onShift: true as boolean | null,
  hidden: true,
  dayTotals: { active: 0, idle: 0 },
  idlePrompt: false,
  leavePrompt: false,
  switchPrompt: false,
  awayPrompt: false,
  breakOverdue: false,
  managerAlert: null,
  resumeLast: vi.fn(),
  reclaimTimer: vi.fn(),
  keepRunning: vi.fn(),
  pauseAndClose: vi.fn(),
  hideTimer: vi.fn(),
  showTimer: vi.fn(),
  setEstimate: vi.fn(),
  dismissManagerAlert: vi.fn(),
  confirmStillWorking: vi.fn(),
  rejectStillWorking: vi.fn(),
  switchTo: vi.fn(),
  dismissSwitch: vi.fn(),
  startBreak: vi.fn(),
  endBreak: vi.fn(),
  extendBreak: vi.fn(),
  dismissAwayPrompt: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
  startTimer: vi.fn(),
}));

vi.mock('@/contexts/ActivityTimerContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/contexts/ActivityTimerContext')>();
  return { ...real, useActivityTimer: () => timer };
});
vi.mock('@/hooks/useWhatsAppTimeTracker', () => ({ useWhatsAppUmbrellaWatchdog: () => {} }));
vi.mock('@/hooks/useFinanceTimeTracker', () => ({ useFinanceUmbrellaWatchdog: () => {} }));
vi.mock('@/components/activities/TeamTimersPanel', () => ({ TeamTimersPanel: () => null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/integrations/supabase', () => ({
  db: { from: () => ({ select: () => ({ is: () => ({ neq: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) }) },
  ensureExternalSession: () => Promise.resolve(),
}));
vi.mock('@/integrations/supabase/uuid-remap', () => ({ remapToExternal: () => Promise.resolve('ext-u1') }));

beforeEach(() => {
  localStorage.removeItem('activity-timer-badge-pos');
  timer.current = null;
  timer.lastActivity = null;
  timer.onShift = true;
  timer.hidden = true;
  timer.reclaimTimer.mockClear();
  timer.startShift.mockClear();
});

describe('ActivityTimerOverlay — nunca fica sem cronômetro na tela', () => {
  it('em expediente e sem sessão nesta aba, oferece retomar o cronômetro', () => {
    render(<ActivityTimerOverlay />);
    expect(screen.getByRole('button', { name: /Retomar cronômetro/i })).toBeTruthy();
  });

  it('clicar em retomar reassume a contagem nesta aba', async () => {
    render(<ActivityTimerOverlay />);
    await userEvent.click(screen.getByRole('button', { name: /Retomar cronômetro/i }));
    expect(timer.reclaimTimer).toHaveBeenCalled();
  });

  it('fora do expediente segue mostrando só o botão de bater o ponto', () => {
    timer.onShift = false;
    render(<ActivityTimerOverlay />);
    expect(screen.getByRole('button', { name: /Iniciar expediente/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retomar cronômetro/i })).toBeNull();
  });

  /**
   * Regressão: "o cronômetro só está mexendo para cima e para baixo". O X vivia
   * preso na borda do conteúdo, então o badge ficava parado em cima da coluna
   * da esquerda (lista de conversas do WhatsApp) sem jeito de tirar dali.
   */
  it('arrasta nos dois eixos e guarda a posição', () => {
    render(<ActivityTimerOverlay />);
    const badge = screen.getByRole('button', { name: /Retomar cronômetro/i });

    fireEvent.pointerDown(badge, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(badge, { pointerId: 1, clientX: 500, clientY: 300, movementX: 490, movementY: 290 });
    fireEvent.pointerUp(badge, { pointerId: 1 });

    expect(badge.style.left).toBe('490px');
    expect(badge.style.top).toBe('290px');
    expect(JSON.parse(localStorage.getItem('activity-timer-badge-pos') || '{}')).toMatchObject({ x: 490, y: 290 });
  });

  it('com sessão rodando não duplica controle: mostra a aba do cronômetro', () => {
    timer.current = {
      kind: 'gap', entryId: 'e1', activityId: null, activityType: '',
      activityTitle: 'Ocioso (entre atividades)', leadName: null,
      userId: 'ext-u1', userName: 'Membro',
      activeSeconds: 0, idleSeconds: 90, status: 'running', estimateMinutes: null,
    };
    render(<ActivityTimerOverlay />);
    expect(screen.queryByRole('button', { name: /Retomar cronômetro/i })).toBeNull();
    expect(screen.getByText('01:30')).toBeTruthy();
  });
});

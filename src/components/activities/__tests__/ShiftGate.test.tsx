/**
 * Porteiro do expediente: sem ponto batido o sistema fica bloqueado.
 *
 * Cobre as quatro decisões do gate — bloqueia o membro fora do expediente,
 * libera diretoria, libera quem já bateu o ponto e não trava a tela de login
 * (sem sessão). Uma regressão em qualquer uma delas ou deixa o sistema aberto
 * sem registro de ponto, ou tranca alguém que deveria passar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftGate } from '../ShiftGate';

const timer = vi.hoisted(() => ({
  onShift: false as boolean | null,
  shiftEndedToday: false,
  startShift: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  user: { id: 'u1', email: 'membro@rprudencioadv.com' } as { id: string; email: string } | null,
  loading: false,
  signOut: vi.fn(),
}));
const leadership = vi.hoisted(() => ({ isDirector: false, loading: false }));

vi.mock('@/contexts/ActivityTimerContext', () => ({
  useActivityTimer: () => timer,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => auth,
}));
vi.mock('@/hooks/useTeamLeadership', () => ({
  useTeamLeadership: () => leadership,
}));

beforeEach(() => {
  timer.onShift = false;
  timer.shiftEndedToday = false;
  auth.user = { id: 'u1', email: 'membro@rprudencioadv.com' };
  auth.loading = false;
  leadership.isDirector = false;
  leadership.loading = false;
});

describe('ShiftGate', () => {
  it('bloqueia o membro sem expediente aberto e mostra o POP', () => {
    render(<ShiftGate />);
    expect(screen.getByText('Expediente não iniciado')).toBeTruthy();
    expect(screen.getByText('Início de expediente')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iniciar expediente/i })).toBeTruthy();
  });

  it('libera quem já bateu o ponto', () => {
    timer.onShift = true;
    const { container } = render(<ShiftGate />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('libera quem já encerrou o expediente hoje (voltou só para consultar)', () => {
    timer.onShift = false;
    timer.shiftEndedToday = true;
    const { container } = render(<ShiftGate />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('libera a diretoria', () => {
    leadership.isDirector = true;
    render(<ShiftGate />);
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('não bloqueia a tela de login (sem sessão)', () => {
    auth.user = null;
    render(<ShiftGate />);
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('não bloqueia enquanto o ponto ainda está carregando', () => {
    timer.onShift = null;
    render(<ShiftGate />);
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });
});

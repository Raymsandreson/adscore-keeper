/**
 * Porteiro do expediente: sem ponto batido o sistema fica bloqueado.
 *
 * Cobre as decisões do gate — bloqueia o membro fora do expediente, libera
 * diretoria, libera quem já bateu o ponto, libera quem já encerrou o dia,
 * libera as rotas de SHIFT_FREE_PATHS e não trava a tela de login (sem
 * sessão). Uma regressão em qualquer uma delas ou deixa o sistema aberto sem
 * registro de ponto, ou tranca alguém que deveria passar.
 *
 * O componente lê a rota (useLocation), então precisa de Router no teste —
 * em produção ele é montado dentro do SidebarLayout, já sob o BrowserRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ShiftGate } from '../ShiftGate';

const renderAt = (pathname = '/atividades') =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <ShiftGate />
    </MemoryRouter>,
  );

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
    renderAt();
    expect(screen.getByText('Expediente não iniciado')).toBeTruthy();
    expect(screen.getByText('Início de expediente')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iniciar expediente/i })).toBeTruthy();
  });

  it('libera quem já bateu o ponto', () => {
    timer.onShift = true;
    const { container } = renderAt();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('libera quem já encerrou o expediente hoje (voltou só para consultar)', () => {
    timer.onShift = false;
    timer.shiftEndedToday = true;
    const { container } = renderAt();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('libera a diretoria', () => {
    leadership.isDirector = true;
    renderAt();
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('não bloqueia a tela de login (sem sessão)', () => {
    auth.user = null;
    renderAt();
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('não bloqueia enquanto o ponto ainda está carregando', () => {
    timer.onShift = null;
    renderAt();
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('libera /gerar-procuracao mesmo sem ponto batido', () => {
    renderAt('/gerar-procuracao');
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
  });

  it('volta a bloquear ao sair da rota liberada', () => {
    renderAt('/casos');
    expect(screen.getByText('Expediente não iniciado')).toBeTruthy();
  });
});

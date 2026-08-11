/**
 * Aviso de expediente: sem ponto batido o POP aparece, mas fecha no X.
 *
 * Cobre as decisões do aviso — aparece para o membro fora do expediente e some
 * ao ser fechado (senão quem só vai gerar uma procuração fica preso de novo),
 * não aparece para diretoria, para quem já bateu o ponto, para quem já
 * encerrou o dia, nas rotas de SHIFT_FREE_PATHS, nem sobre a tela de login.
 *
 * O componente lê a rota (useLocation), então precisa de Router no teste —
 * em produção ele é montado dentro do SidebarLayout, já sob o BrowserRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('mostra o POP para o membro sem expediente aberto', () => {
    renderAt();
    expect(screen.getByText('Expediente não iniciado')).toBeTruthy();
    expect(screen.getByText('Início de expediente')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iniciar expediente/i })).toBeTruthy();
  });

  it('fecha no X e não prende quem não vai bater o ponto', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Fechar e usar o sistema/i }));
    expect(screen.queryByText('Expediente não iniciado')).toBeNull();
    expect(screen.queryByText('Início de expediente')).toBeNull();
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

  it('volta a avisar ao sair da rota liberada', () => {
    renderAt('/casos');
    expect(screen.getByText('Expediente não iniciado')).toBeTruthy();
  });
});

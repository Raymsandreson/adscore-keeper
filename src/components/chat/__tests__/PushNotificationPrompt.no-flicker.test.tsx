/**
 * A faixa de "ativar notificações" aparecia e sumia sozinha antes de dar tempo
 * de tocar: o modal de instalação do PWA só se declara depois de montado (no
 * iPhone quando o efeito detecta o iOS, no Android quando chega o evento
 * `beforeinstallprompt`), e essa virada derrubava a faixa já visível.
 *
 * Regra travada aqui: enquanto o modal estiver na tela a faixa não abre; depois
 * de aberta, ela não se fecha sozinha por causa do modal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const push = {
  supported: true,
  needsInstall: false,
  checked: true,
  permission: 'default' as NotificationPermission,
  subscribed: false,
  busy: false,
  enable: vi.fn(),
  disable: vi.fn(),
  testNotification: vi.fn(),
};

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => push,
}));

import { PushNotificationPrompt } from '../PushNotificationPrompt';
import { setPwaBannerVisible } from '@/lib/pwaBannerVisibility';

const SETTLE_MS = 2000;

function renderPrompt() {
  return render(
    <MemoryRouter>
      <PushNotificationPrompt />
    </MemoryRouter>,
  );
}

/** Passa o tempo de espera do "assentamento" do modal. */
function settle() {
  act(() => { vi.advanceTimersByTime(SETTLE_MS + 50); });
}

describe('PushNotificationPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setPwaBannerVisible(false);
    push.subscribed = false;
    push.needsInstall = false;
    push.permission = 'default';
  });

  afterEach(() => {
    // Ainda pode haver componente montado ouvindo o sinal — daí o act().
    act(() => { setPwaBannerVisible(false); });
    vi.useRealTimers();
  });

  it('não some quando o modal de instalação aparece depois (o bug)', () => {
    renderPrompt();
    settle();
    expect(screen.getByText('Ativar notificações')).toBeInTheDocument();

    // O `beforeinstallprompt` chega atrasado e acende o modal do PWA.
    act(() => { setPwaBannerVisible(true); });

    expect(screen.getByText('Ativar notificações')).toBeInTheDocument();
  });

  it('não abre por cima do modal de instalação', () => {
    act(() => { setPwaBannerVisible(true); });
    renderPrompt();
    settle();

    expect(screen.queryByText('Ativar notificações')).not.toBeInTheDocument();
  });

  it('abre assim que o modal de instalação sai da tela', () => {
    act(() => { setPwaBannerVisible(true); });
    renderPrompt();
    settle();
    expect(screen.queryByText('Ativar notificações')).not.toBeInTheDocument();

    act(() => { setPwaBannerVisible(false); });
    expect(screen.getByText('Ativar notificações')).toBeInTheDocument();
  });

  it('some quando a assinatura entra de fato', () => {
    const { rerender } = renderPrompt();
    settle();
    expect(screen.getByText('Ativar notificações')).toBeInTheDocument();

    push.subscribed = true;
    rerender(<MemoryRouter><PushNotificationPrompt /></MemoryRouter>);

    expect(screen.queryByText('Ativar notificações')).not.toBeInTheDocument();
  });

  it('no iPhone fora da tela inicial convida a instalar', () => {
    push.needsInstall = true;
    push.permission = 'denied'; // Safari sem PushManager: irrelevante neste caminho
    renderPrompt();
    settle();

    expect(screen.getByText('Instale para receber notificações')).toBeInTheDocument();
  });
});

/**
 * Popup de aviso: responder ali mesmo, com as ações extras da conversa.
 *
 * Cobre o que faz o popup deixar de ser só um cartaz: as ações injetadas
 * (sugestão da IA, agente da conversa) aparecem e escrevem no campo, e o
 * relógio de fechar sozinho para no primeiro toque — antes o aviso sumia no
 * meio da resposta sendo digitada, porque quem contava o tempo era o sonner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TeamNotificationToast } from '../TeamNotificationToast';

const dismiss = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { dismiss, success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/voice-input-button', () => ({
  VoiceInputButton: () => <button type="button">voz</button>,
}));

const base = {
  toastId: 'aviso-1',
  icon: <span />,
  title: 'Wana Lara',
  preview: '2 mensagens novas',
  onOpen: vi.fn(),
  onMuteForMinutes: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  dismiss.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TeamNotificationToast', () => {
  it('a ação extra escreve no campo e a resposta sai com o texto sugerido', async () => {
    const onReply = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNotificationToast
        {...base}
        onReply={onReply}
        composerActions={({ setReply }) => (
          <button type="button" onClick={() => setReply('Sugestão da IA')}>
            IA
          </button>
        )}
        footerActions={<span>Agente IA</span>}
      />
    );

    expect(screen.getByText('Agente IA')).toBeTruthy();

    fireEvent.click(screen.getByText('IA'));
    expect((screen.getByPlaceholderText(/Responder ou falar/) as HTMLInputElement).value).toBe('Sugestão da IA');

    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText(/Responder ou falar/), { key: 'Enter' });
    });
    expect(onReply).toHaveBeenCalledWith('Sugestão da IA');
  });

  it('fecha sozinho no tempo pedido enquanto ninguém encosta', () => {
    render(<TeamNotificationToast {...base} autoCloseMs={12_000} />);

    act(() => { vi.advanceTimersByTime(11_999); });
    expect(dismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(dismiss).toHaveBeenCalledWith('aviso-1');
  });

  it('quem encostou no aviso está tratando a mensagem: o relógio para', () => {
    render(<TeamNotificationToast {...base} autoCloseMs={12_000} onReply={vi.fn()} />);

    fireEvent.pointerDown(screen.getByPlaceholderText(/Responder ou falar/));
    act(() => { vi.advanceTimersByTime(60_000); });

    expect(dismiss).not.toHaveBeenCalled();
  });

  it('sem autoCloseMs quem conta o tempo continua sendo o sonner', () => {
    render(<TeamNotificationToast {...base} />);
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(dismiss).not.toHaveBeenCalled();
  });
});

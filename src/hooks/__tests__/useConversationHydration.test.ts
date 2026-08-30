/**
 * O skeleton "Carregando conversa…" tem que ter fim.
 *
 * Até 30/08/2026 não tinha: o timeout de segurança era criado dentro do mesmo
 * efeito que tinha `isHydratingConversation` na lista de dependências. O
 * `setState(true)` mudava a dependência, o React rodava o cleanup do efeito
 * anterior e o `clearTimeout` matava o timer antes de ele disparar. Na segunda
 * passada a chave já era a mesma e a contagem continuava <= 1, então nada
 * reagendava o timer nem baixava a flag: a conversa girava pra sempre sempre que
 * a hidratação não trouxesse mais de uma mensagem (falha de rede,
 * `instance_name` ausente, ou conversa que só tem uma mensagem mesmo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useConversationHydration } from '@/hooks/useConversationHydration';

const TIMEOUT = 8000;

describe('useConversationHydration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entra em hidratação quando a conversa chega só com a mensagem-resumo', () => {
    const { result } = renderHook(() =>
      useConversationHydration({ phone: '558695550865', instanceName: 'Raym', messageCount: 1 })
    );
    expect(result.current).toBe(true);
  });

  it('sai da hidratação pelo timeout quando o histórico não chega (bug original)', () => {
    const { result } = renderHook(() =>
      useConversationHydration({ phone: '558695550865', instanceName: 'Raym', messageCount: 1 })
    );
    expect(result.current).toBe(true);

    act(() => { vi.advanceTimersByTime(TIMEOUT + 1); });

    expect(result.current).toBe(false);
  });

  it('sai da hidratação assim que o histórico chega, sem esperar o timeout', () => {
    const { result, rerender } = renderHook(
      ({ messageCount }) =>
        useConversationHydration({ phone: '558695550865', instanceName: 'Raym', messageCount }),
      { initialProps: { messageCount: 1 } }
    );
    expect(result.current).toBe(true);

    act(() => { vi.advanceTimersByTime(500); });
    rerender({ messageCount: 42 });

    expect(result.current).toBe(false);
  });

  it('nem entra em hidratação quando a conversa já vem completa', () => {
    const { result } = renderHook(() =>
      useConversationHydration({ phone: '558695550865', instanceName: 'Raym', messageCount: 42 })
    );
    expect(result.current).toBe(false);
  });

  it('reidrata ao trocar de conversa e volta a ter fim', () => {
    const { result, rerender } = renderHook(
      ({ phone, messageCount }) =>
        useConversationHydration({ phone, instanceName: 'Raym', messageCount }),
      { initialProps: { phone: '558695550865', messageCount: 42 } }
    );
    expect(result.current).toBe(false);

    rerender({ phone: '5511999990000', messageCount: 1 });
    expect(result.current).toBe(true);

    act(() => { vi.advanceTimersByTime(TIMEOUT + 1); });
    expect(result.current).toBe(false);
  });

  it('trocar de instância no mesmo telefone conta como conversa nova', () => {
    const { result, rerender } = renderHook(
      ({ instanceName, messageCount }) =>
        useConversationHydration({ phone: '558695550865', instanceName, messageCount }),
      { initialProps: { instanceName: 'Raym', messageCount: 42 } }
    );
    expect(result.current).toBe(false);

    rerender({ instanceName: 'Comercial', messageCount: 1 });
    expect(result.current).toBe(true);
  });

  it('não deixa timer órfão setando estado depois do unmount', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useConversationHydration({ phone: '558695550865', instanceName: 'Raym', messageCount: 1 })
    );
    expect(result.current).toBe(true);

    unmount();
    act(() => { vi.advanceTimersByTime(TIMEOUT + 1); });

    expect(vi.getTimerCount()).toBe(0);
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});

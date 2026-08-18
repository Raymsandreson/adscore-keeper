import { describe, it, expect, vi } from 'vitest';
import { withTimeout, PromiseTimeoutError } from '../promiseTimeout';

describe('withTimeout', () => {
  it('resolve normalmente quando a promessa responde a tempo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'teste')).resolves.toBe('ok');
  });

  it('propaga a rejeição original sem virar timeout', async () => {
    const boom = new Error('boom');
    await expect(withTimeout(Promise.reject(boom), 50, 'teste')).rejects.toBe(boom);
  });

  it('rejeita com PromiseTimeoutError quando a promessa nunca resolve', async () => {
    vi.useFakeTimers();
    try {
      const pendente = withTimeout(new Promise(() => {}), 12_000, 'fetchMessagePage');
      const assertion = expect(pendente).rejects.toBeInstanceOf(PromiseTimeoutError);
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('não deixa timer pendurado depois de resolver', async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.resolve(1), 12_000, 'teste');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

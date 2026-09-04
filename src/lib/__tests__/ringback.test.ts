/**
 * Quem liga precisa OUVIR que está chamando — antes disso o silêncio até o
 * outro atender parecia travamento. O toque de saída é 1s de tom em 425 Hz a
 * cada 5s (padrão brasileiro); o de quem recebe segue com os dois bipes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ringtone, RINGBACK } from '../webrtcCall';

interface ToqueGravado { freq: number; startAt: number; stopAt: number }

const toques: ToqueGravado[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    const toque: ToqueGravado = { freq: 0, startAt: 0, stopAt: 0 };
    return {
      type: '',
      frequency: { set value(v: number) { toque.freq = v; }, get value() { return toque.freq; } },
      connect: () => {},
      start: (t: number) => { toque.startAt = t; toques.push(toque); },
      stop: (t: number) => { toque.stopAt = t; },
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  close() { return Promise.resolve(); }
}

describe('Ringtone — toque de saída e de entrada', () => {
  beforeEach(() => {
    toques.length = 0;
    vi.useFakeTimers();
    (window as any).AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).AudioContext;
  });

  it('o toque de quem liga é um tom de 1s a cada 5s', () => {
    const r = new Ringtone(RINGBACK);
    r.start();

    expect(toques).toHaveLength(1);
    expect(toques[0].freq).toBe(425);
    // 1 segundo de tom (a folga de 0,02s é o fade do oscilador)
    expect(toques[0].stopAt - toques[0].startAt).toBeCloseTo(1.02, 2);

    vi.advanceTimersByTime(5000);
    expect(toques).toHaveLength(2);

    r.stop();
    vi.advanceTimersByTime(20000);
    expect(toques).toHaveLength(2);
  });

  it('sem opções continua o toque de quem recebe: dois bipes a cada 2s', () => {
    const r = new Ringtone();
    r.start();

    expect(toques).toHaveLength(2);
    expect(toques[0].freq).toBe(480);
    expect(toques[1].startAt - toques[0].startAt).toBeCloseTo(0.25, 2);

    vi.advanceTimersByTime(2000);
    expect(toques).toHaveLength(4);
    r.stop();
  });
});

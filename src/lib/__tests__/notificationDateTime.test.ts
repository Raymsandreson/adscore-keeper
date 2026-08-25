import { describe, it, expect } from 'vitest';
import { buildNotificationAt, hydrateNotificationTime } from '@/lib/notificationDateTime';

// Fuso fixado em America/Sao_Paulo pelo vitest.config — as fixtures trazem
// `-03:00` explícito em vez de `Z` para não depender da máquina.
const iso = (s: string) => new Date(s).toISOString();

describe('buildNotificationAt', () => {
  it('sem data não há aviso', () => {
    expect(buildNotificationAt('', '14:30')).toBeNull();
  });

  it('data + hora viram o instante local', () => {
    expect(buildNotificationAt('2026-08-25', '14:30')).toBe(iso('2026-08-25T14:30:00-03:00'));
  });

  it('sem hora grava meia-noite (a convenção de "sem hora")', () => {
    expect(buildNotificationAt('2026-08-25', '')).toBe(iso('2026-08-25T00:00:00-03:00'));
  });

  it('aceita a data já com hora colada e usa a hora do segundo argumento', () => {
    // O `formNotificationDate` é `yyyy-MM-dd`, mas o payload da IA às vezes
    // chega como datetime — o slice evita um Invalid Date silencioso.
    expect(buildNotificationAt('2026-08-25T09:00', '14:30')).toBe(iso('2026-08-25T14:30:00-03:00'));
  });

  it('data inválida vira null em vez de Invalid Date', () => {
    expect(buildNotificationAt('nao-e-data', '14:30')).toBeNull();
  });
});

describe('hydrateNotificationTime', () => {
  it('nulo volta vazio', () => {
    expect(hydrateNotificationTime(null)).toBe('');
    expect(hydrateNotificationTime(undefined)).toBe('');
  });

  it('meia-noite volta vazio — atividade antiga não exibe "às 00:00"', () => {
    expect(hydrateNotificationTime(iso('2026-08-25T00:00:00-03:00'))).toBe('');
  });

  it('instante com hora volta HH:mm local', () => {
    expect(hydrateNotificationTime(iso('2026-08-25T14:30:00-03:00'))).toBe('14:30');
  });

  it('ida e volta preserva a hora escolhida', () => {
    const gravado = buildNotificationAt('2026-08-25', '08:05');
    expect(hydrateNotificationTime(gravado)).toBe('08:05');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUND_SETTINGS,
  SOUND_KEYS,
  isSoundEnabled,
  readSoundSettings,
  setSoundEnabled,
  subscribeSoundSettings,
} from '../soundSettings';

const KEY = 'sound-settings';

beforeEach(() => {
  localStorage.clear();
});

describe('padrão de fábrica', () => {
  it('todo aviso sonoro nasce desligado', () => {
    for (const key of SOUND_KEYS) {
      expect(isSoundEnabled(key)).toBe(false);
    }
    expect(Object.values(DEFAULT_SOUND_SETTINGS).every((v) => v === false)).toBe(true);
  });

  it('storage vazio não liga nada', () => {
    expect(readSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });
});

describe('gravação', () => {
  it('liga só a chave escolhida e persiste', () => {
    setSoundEnabled('timerIdle', true);
    expect(isSoundEnabled('timerIdle')).toBe(true);
    expect(isSoundEnabled('chatUrgent')).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY) as string).timerIdle).toBe(true);
  });

  it('desligar volta ao silêncio', () => {
    setSoundEnabled('managerAlert', true);
    setSoundEnabled('managerAlert', false);
    expect(isSoundEnabled('managerAlert')).toBe(false);
  });
});

describe('preferência corrompida cai no silêncio', () => {
  it('JSON inválido não quebra nem liga som', () => {
    localStorage.setItem(KEY, '{isso não é json');
    expect(readSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it('chave desconhecida é descartada', () => {
    localStorage.setItem(KEY, JSON.stringify({ somDoInimigo: true, timerIdle: true }));
    const settings = readSoundSettings() as Record<string, boolean>;
    expect(settings.somDoInimigo).toBeUndefined();
    expect(settings.timerIdle).toBe(true);
  });

  it('valor que não é booleano não liga o som', () => {
    localStorage.setItem(KEY, JSON.stringify({ timerIdle: 'sim' }));
    expect(isSoundEnabled('timerIdle')).toBe(false);
  });
});

describe('propagação', () => {
  it('avisa quem assinou, e para de avisar depois de cancelar', () => {
    const spy = vi.fn();
    const unsubscribe = subscribeSoundSettings(spy);

    setSoundEnabled('chatUrgent', true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].chatUrgent).toBe(true);

    unsubscribe();
    setSoundEnabled('chatUrgent', false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

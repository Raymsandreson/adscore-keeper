import { describe, it, expect } from 'vitest';
import { appOnlyShift, notStarted, type PresenceInput } from '../teamPresence';

const membro = (over: Partial<PresenceInput> = {}): PresenceInput => ({
  state: 'off', dayActive: 0, dayIdle: 0, shiftToday: false, ...over,
});

describe('notStarted', () => {
  it('quem não apareceu de jeito nenhum hoje é cobrado', () => {
    expect(notStarted(membro())).toBe(true);
  });

  it('ponto batido sem cronômetro NÃO é "não iniciou" — é o expediente do app', () => {
    // O caso que a correção existe para impedir: sem work_shifts na conta, esta
    // pessoa aparecia como "não entrou no sistema hoje" e recebia push de
    // cobrança enquanto trabalhava fora do escritório.
    expect(notStarted(membro({ shiftToday: true }))).toBe(false);
  });

  it('quem já cronometrou hoje continua fora, mesmo com o cronômetro parado', () => {
    expect(notStarted(membro({ dayActive: 3600 }))).toBe(false);
    expect(notStarted(membro({ dayIdle: 120 }))).toBe(false);
  });

  it('ninguém com sessão em andamento é "não iniciou"', () => {
    for (const state of ['working', 'idle', 'break'] as const) {
      expect(notStarted(membro({ state }))).toBe(false);
    }
  });
});

describe('appOnlyShift', () => {
  it('selo só para quem tem ponto aberto e zero segundo cronometrado', () => {
    expect(appOnlyShift(membro({ shiftToday: true }))).toBe(true);
  });

  it('quem bateu o ponto pela web e já cronometrou não leva o selo', () => {
    expect(appOnlyShift(membro({ shiftToday: true, dayActive: 60 }))).toBe(false);
  });

  it('quem acabou de entrar pela web não leva o selo do app', () => {
    // Janela real: o ponto da web cai em ocioso na hora, e até o primeiro flush
    // (30s) os dois totais ainda estão zerados. É o `state` que separa.
    expect(appOnlyShift(membro({ state: 'idle', shiftToday: true }))).toBe(false);
  });

  it('sem ponto no dia não há selo — esse é o caso do "não iniciou"', () => {
    expect(appOnlyShift(membro())).toBe(false);
  });
});

describe('as duas regras juntas', () => {
  it('são mutuamente exclusivas e cobrem quem está sem cronômetro', () => {
    const semPonto = membro();
    const comPonto = membro({ shiftToday: true });

    expect([notStarted(semPonto), appOnlyShift(semPonto)]).toEqual([true, false]);
    expect([notStarted(comPonto), appOnlyShift(comPonto)]).toEqual([false, true]);
  });
});

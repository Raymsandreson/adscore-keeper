// A tranca que impede o bug da rotina por IA de voltar.
//
// Contexto (15/09/2026): "Organizar rotina com IA" falhava SEMPRE com
// "A IA não conseguiu mapear sugestões aos tipos globais existentes". A causa não
// era a IA errar de vez em quando: a edge antiga mandava ela INVENTAR tipos
// ("reuniao", "audiencia") e a tela só aceitava as keys que existem no banco —
// que são `custom_<timestamp>`. Nunca casava.
//
// Agora os tipos reais viram enum na tool call, e esta função é a última tranca:
// o que não for key existente não passa, e horário impossível é consertado em vez
// de o bloco ser jogado fora (o pedido da pessoa é real; só a conta da IA errou).
import { describe, it, expect } from 'vitest';
import { sanitizeBlocks, snapMinute, clampHour } from '../suggest-routine';

const TIPOS = [
  { key: 'custom_1771000000000', label: 'FILTRAGEM DE LEADS' },
  { key: 'custom_1771000000001', label: 'Suporte Acolhedores' },
];

describe('sanitizeBlocks', () => {
  it('descarta bloco com tipo inventado — o erro original não volta pela porta dos fundos', () => {
    const out = sanitizeBlocks(
      [{ activityType: 'reuniao', days: [0], startHour: 9, endHour: 10 }],
      TIPOS,
    );
    expect(out).toHaveLength(0);
  });

  it('aceita a key que existe e devolve o rótulo de verdade', () => {
    const out = sanitizeBlocks(
      [{ activityType: 'custom_1771000000000', days: [0, 2], startHour: 8, startMinute: 30, endHour: 9, endMinute: 30 }],
      TIPOS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('FILTRAGEM DE LEADS');
    // O minuto tem que sobreviver: 08:30 virando 08:00 era outro defeito do caminho antigo.
    expect(out[0]).toMatchObject({ startHour: 8, startMinute: 30, endHour: 9, endMinute: 30, days: [0, 2] });
  });

  it('conserta fim antes do início empurrando uma hora, sem perder o bloco', () => {
    const out = sanitizeBlocks(
      [{ activityType: 'custom_1771000000001', days: [4], startHour: 15, startMinute: 30, endHour: 14, endMinute: 0 }],
      TIPOS,
    );
    expect(out[0]).toMatchObject({ startHour: 15, startMinute: 30, endHour: 16, endMinute: 30 });
  });

  it('sem dia utilizável, cai na semana toda — bloco invisível na grade seria pior', () => {
    const out = sanitizeBlocks(
      [{ activityType: 'custom_1771000000000', days: [9, -2, 'x'], startHour: 10, endHour: 11 }],
      TIPOS,
    );
    expect(out[0].days).toEqual([0, 1, 2, 3, 4]);
  });

  it('dia repetido e fora de ordem sai limpo e ordenado', () => {
    const out = sanitizeBlocks(
      [{ activityType: 'custom_1771000000000', days: [3, 0, 3], startHour: 10, endHour: 11 }],
      TIPOS,
    );
    expect(out[0].days).toEqual([0, 3]);
  });

  it('não quebra quando a IA devolve qualquer coisa no lugar da lista', () => {
    expect(sanitizeBlocks(null, TIPOS)).toEqual([]);
    expect(sanitizeBlocks('rotina pronta', TIPOS)).toEqual([]);
  });
});

describe('snapMinute', () => {
  it('encaixa na grade de 15 em 15 que a tela usa', () => {
    expect(snapMinute(0)).toBe(0);
    expect(snapMinute(20)).toBe(15);
    expect(snapMinute(40)).toBe(45);
    expect(snapMinute(58)).toBe(45); // 60 seria a hora seguinte — a tela não tem esse slot
    expect(snapMinute(undefined)).toBe(0);
    expect(snapMinute('meia hora')).toBe(0);
  });
});

describe('clampHour', () => {
  it('mantém a hora dentro do dia', () => {
    expect(clampHour(9, 8)).toBe(9);
    expect(clampHour(30, 8)).toBe(23);
    expect(clampHour(-4, 8)).toBe(0);
    expect(clampHour('nove', 8)).toBe(8);
  });
});

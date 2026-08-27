import { describe, it, expect } from 'vitest';
import { duracaoLegivel, decomporDuracao } from '../duracaoLegivel';

describe('os números reais da carteira', () => {
  it('440 dias no marco atual vira "1 a 2 m 15 d (14 meses)"', () => {
    expect(duracaoLegivel(440)).toBe('1 a 2 m 15 d (14 meses)');
  });

  it('782 dias de média no arquivamento vira "2 a 1 m 22 d (25 meses)"', () => {
    expect(duracaoLegivel(782)).toBe('2 a 1 m 22 d (25 meses)');
  });

  it('215 dias no alvará expedido', () => {
    expect(duracaoLegivel(215)).toBe('7 m 5 d (7 meses)');
  });
});

describe('o total entre parênteses sempre fecha com a decomposição', () => {
  it('anos × 12 + meses é exatamente o total', () => {
    for (const d of [30, 365, 400, 782, 1000, 3650]) {
      const x = decomporDuracao(d);
      expect(x.totalMeses).toBe(x.anos * 12 + x.meses);
    }
  });
});

describe('não mostra zero à esquerda', () => {
  it('menos de um ano começa no mês', () => {
    expect(duracaoLegivel(75)).toBe('2 m 15 d (2 meses)');
  });

  it('menos de um mês é só o dia, sem o total entre parênteses', () => {
    expect(duracaoLegivel(12)).toBe('12 d');
  });

  it('ano redondo não inventa mês nem dia', () => {
    expect(duracaoLegivel(365)).toBe('1 a (12 meses)');
  });

  it('um mês fala no singular', () => {
    expect(duracaoLegivel(30)).toBe('1 m (1 mês)');
  });
});

describe('borda', () => {
  it('zero é hoje, não "0 d"', () => {
    expect(duracaoLegivel(0)).toBe('hoje');
  });

  it('null vira travessão em vez de sumir', () => {
    expect(duracaoLegivel(null)).toBe('—');
    expect(duracaoLegivel(undefined)).toBe('—');
  });

  it('negativo não vira duração de trás para frente', () => {
    expect(duracaoLegivel(-50)).toBe('hoje');
    expect(decomporDuracao(-50).anos).toBe(0);
  });

  it('comTotal: false corta os parênteses onde não cabem', () => {
    expect(duracaoLegivel(782, { comTotal: false })).toBe('2 a 1 m 22 d');
  });
});

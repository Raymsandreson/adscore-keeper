/**
 * Régua da previsão de tempo. O que importa aqui é a previsão nunca nascer
 * ABAIXO da mediana do tipo — se nascesse, metade das atividades já começaria
 * estourada e o vermelho do cronômetro viraria ruído.
 */
import { describe, it, expect } from 'vitest';
import {
  snapEstimate,
  formatEstimate,
  formatSpent,
  ESTIMATE_OPTIONS,
} from '@/hooks/useActivityTimeEstimate';

describe('snapEstimate', () => {
  it('nunca devolve valor abaixo da mediana', () => {
    for (let m = 1; m <= 240; m++) {
      expect(snapEstimate(m)).toBeGreaterThanOrEqual(m);
    }
  });

  it('sempre cai numa opção do seletor', () => {
    for (let m = 1; m <= 300; m++) {
      expect(ESTIMATE_OPTIONS).toContain(snapEstimate(m));
    }
  });

  it('usa as medianas reais dos tipos mais frequentes', () => {
    expect(snapEstimate(7)).toBe(10);   // tarefa
    expect(snapEstimate(6)).toBe(10);   // acompanhamento
    expect(snapEstimate(10)).toBe(10);  // exato bate na opção
    expect(snapEstimate(35)).toBe(45);  // reunião
  });

  it('acima do teto fica no maior valor da régua', () => {
    expect(snapEstimate(999)).toBe(ESTIMATE_OPTIONS[ESTIMATE_OPTIONS.length - 1]);
  });
});

describe('formatEstimate', () => {
  it('minutos, horas e horas quebradas', () => {
    expect(formatEstimate(45)).toBe('45min');
    expect(formatEstimate(60)).toBe('1h');
    expect(formatEstimate(90)).toBe('1h30');
    expect(formatEstimate(240)).toBe('4h');
  });

  it('sem previsão vira travessão', () => {
    expect(formatEstimate(null)).toBe('—');
    expect(formatEstimate(0)).toBe('—');
  });
});

describe('formatSpent', () => {
  it('abaixo de uma hora usa mm:ss', () => {
    expect(formatSpent(0)).toBe('00:00');
    expect(formatSpent(72)).toBe('01:12');
    expect(formatSpent(3599)).toBe('59:59');
  });

  it('a partir de uma hora usa HhMM', () => {
    expect(formatSpent(3600)).toBe('1h00');
    expect(formatSpent(4027)).toBe('1h07');
  });
});

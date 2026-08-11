import { describe, it, expect } from 'vitest';
import { calcularVencimento, avaliarPrazo, prazoLabel } from '../popPrazo';

// 2026-08-06 é quinta-feira; 08 e 09 são sábado e domingo.
describe('calcularVencimento', () => {
  it('dias corridos passa por cima do fim de semana', () => {
    expect(calcularVencimento('2026-08-06', { valor: 5, unidade: 'dias' })).toBe('2026-08-11');
  });

  it('dias úteis pula sábado e domingo — é a diferença que mais erra na mão', () => {
    // qui 06 → sex 07(1) seg 10(2) ter 11(3) qua 12(4) qui 13(5)
    expect(calcularVencimento('2026-08-06', { valor: 5, unidade: 'dias_uteis' })).toBe('2026-08-13');
  });

  it('prazo de 8 dias úteis (recurso trabalhista) atravessa um fim de semana', () => {
    expect(calcularVencimento('2026-08-06', { valor: 8, unidade: 'dias_uteis' })).toBe('2026-08-18');
  });

  it('meses anda no calendário, não em 30 dias', () => {
    expect(calcularVencimento('2026-01-31', { valor: 1, unidade: 'meses' })).toBe('2026-03-03');
  });

  it('prazo zero ou negativo não gera vencimento', () => {
    expect(calcularVencimento('2026-08-06', { valor: 0, unidade: 'dias' })).toBeNull();
    expect(calcularVencimento('2026-08-06', { valor: -3, unidade: 'dias' })).toBeNull();
  });
});

describe('avaliarPrazo', () => {
  it('dentro do prazo conta os dias que faltam', () => {
    const r = avaliarPrazo('2026-08-06', { valor: 5, unidade: 'dias' }, '2026-08-09');
    expect(r.situacao).toBe('no_prazo');
    expect(r.diasRestantes).toBe(2);
  });

  it('vence hoje é estado próprio — não é atraso nem folga', () => {
    const r = avaliarPrazo('2026-08-06', { valor: 5, unidade: 'dias' }, '2026-08-11');
    expect(r.situacao).toBe('vence_hoje');
    expect(r.diasRestantes).toBe(0);
  });

  it('atrasado devolve o atraso em negativo', () => {
    const r = avaliarPrazo('2026-08-06', { valor: 5, unidade: 'dias' }, '2026-08-14');
    expect(r.situacao).toBe('atrasado');
    expect(r.diasRestantes).toBe(-3);
  });

  it('passo sem prazo não vira atraso', () => {
    expect(avaliarPrazo('2026-08-06', null, '2026-12-31').situacao).toBe('sem_prazo');
    expect(avaliarPrazo(null, { valor: 5, unidade: 'dias' }, '2026-12-31').situacao).toBe('sem_prazo');
  });
});

describe('prazoLabel', () => {
  it('singular e plural', () => {
    expect(prazoLabel({ valor: 1, unidade: 'dias_uteis' })).toBe('1 dia útil');
    expect(prazoLabel({ valor: 8, unidade: 'dias_uteis' })).toBe('8 dias úteis');
    expect(prazoLabel({ valor: 1, unidade: 'meses' })).toBe('1 mês');
    expect(prazoLabel({ valor: 3, unidade: 'meses' })).toBe('3 meses');
  });

  it('sem prazo não inventa rótulo', () => {
    expect(prazoLabel(null)).toBeNull();
    expect(prazoLabel({ valor: 0, unidade: 'dias' })).toBeNull();
  });
});

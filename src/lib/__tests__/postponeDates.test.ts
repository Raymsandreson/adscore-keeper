import { describe, it, expect } from 'vitest';
import { buildPostponeOptions, formatPostponeDate, minPostponeDate } from '@/lib/postponeDates';

// Datas fixas — meio-dia local para o fuso não empurrar o dia.
const sexta = new Date(2026, 7, 14, 12, 0);   // 14/08/2026, sexta (dia do incidente PREV 180)
const segunda = new Date(2026, 7, 17, 12, 0); // 17/08/2026
const terca = new Date(2026, 7, 18, 12, 0);   // 18/08/2026
const sabado = new Date(2026, 7, 15, 12, 0);  // 15/08/2026

describe('buildPostponeOptions', () => {
  it('numa sexta, o próximo dia útil é a segunda seguinte', () => {
    const [primeira] = buildPostponeOptions(sexta);
    expect(primeira.key).toBe('next_business');
    expect(primeira.dateStr).toBe('2026-08-17');
  });

  it('numa sexta, remove "próxima segunda" porque duplica o próximo dia útil', () => {
    const opts = buildPostponeOptions(sexta);
    const datas = opts.map(o => o.dateStr);
    expect(new Set(datas).size).toBe(datas.length);
    expect(opts.map(o => o.key)).not.toContain('next_monday');
    expect(datas).toEqual(['2026-08-17', '2026-08-19', '2026-08-21']);
  });

  it('numa terça, mantém as quatro opções (nenhuma coincide)', () => {
    const opts = buildPostponeOptions(terca);
    expect(opts.map(o => o.key)).toEqual(['next_business', 'three_business', 'next_monday', 'one_week']);
    expect(opts.map(o => o.dateStr)).toEqual(['2026-08-19', '2026-08-21', '2026-08-24', '2026-08-25']);
  });

  it('numa segunda, "em 1 semana" cai fora por bater com a próxima segunda', () => {
    const opts = buildPostponeOptions(segunda);
    expect(opts.map(o => o.key)).toEqual(['next_business', 'three_business', 'next_monday']);
    expect(opts.map(o => o.dateStr)).toEqual(['2026-08-18', '2026-08-20', '2026-08-24']);
  });

  it('nunca devolve data no passado, nem partindo de um sábado', () => {
    for (const base of [sexta, sabado, segunda]) {
      const hoje = minPostponeDate(base);
      for (const o of buildPostponeOptions(base)) {
        expect(o.dateStr > hoje).toBe(true);
      }
    }
  });

  it('traz um rótulo com o dia da semana abreviado em português', () => {
    const [primeira] = buildPostponeOptions(sexta);
    expect(primeira.when).toMatch(/^seg, 17\/08$/);
  });
});

describe('formatPostponeDate', () => {
  it('converte yyyy-MM-dd para dd/MM/yyyy', () => {
    expect(formatPostponeDate('2026-08-18')).toBe('18/08/2026');
  });

  it('devolve a entrada quando não é data', () => {
    expect(formatPostponeDate('')).toBe('');
    expect(formatPostponeDate('sem data')).toBe('sem data');
  });
});

describe('minPostponeDate', () => {
  it('é o próprio dia de referência', () => {
    expect(minPostponeDate(sexta)).toBe('2026-08-14');
  });
});

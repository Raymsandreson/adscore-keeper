import { describe, it, expect, vi, afterEach } from 'vitest';
import { diaLocal, diasAtras, corteDeDias, hojeISO, diaDoInstante, diaDaColuna } from '../diasSaoPaulo';

describe('dia civil brasileiro', () => {
  afterEach(() => vi.useRealTimers());

  it('vira o dia na meia-noite de Brasília, não na de Greenwich', () => {
    // 03:00Z é 00:00 em São Paulo. Um minuto antes ainda é o dia anterior.
    expect(diaLocal(new Date('2026-09-09T02:59:59Z'))).toBe('2026-09-08');
    expect(diaLocal(new Date('2026-09-09T03:00:00Z'))).toBe('2026-09-09');
  });

  it('não conta lead da noite de ontem como de hoje', () => {
    // O caso real que expôs o bug: 5 leads entre 21h e 22h30 de 08/09 estavam
    // sendo somados no card "Leads hoje" porque em UTC já era dia 09.
    expect(diaDoInstante('2026-09-09T00:01:00Z')).toBe('2026-09-08'); // 21:01 BRT
    expect(diaDoInstante('2026-09-09T01:24:00Z')).toBe('2026-09-08'); // 22:24 BRT
  });

  it('"últimos 7 dias" é hoje mais os 6 anteriores', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z')); // 09:00 em São Paulo
    expect(hojeISO()).toBe('2026-09-09');
    expect(diasAtras(6)).toBe('2026-09-03'); // 03..09 = 7 dias
    expect(diasAtras(29)).toBe('2026-08-11'); // 11/08..09/09 = 30 dias
  });

  it('coluna DATE não sofre conversão de fuso', () => {
    // Se passasse por diaDoInstante, viraria 2026-09-08 e todo fechamento
    // andaria um dia para trás.
    expect(diaDaColuna('2026-09-09')).toBe('2026-09-09');
    expect(diaDaColuna(null)).toBe('');
  });

  it('valor inválido vira string vazia em vez de "Invalid Date"', () => {
    expect(diaDoInstante('nada disso')).toBe('');
    expect(diaDoInstante(null)).toBe('');
  });
});

describe('corteDeDias', () => {
  afterEach(() => vi.useRealTimers());

  it('janela de N dias inclui hoje, então recua N-1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    expect(corteDeDias(1)).toBe('2026-09-09'); // só hoje
    expect(corteDeDias(7)).toBe('2026-09-03'); // 03..09 = 7 dias
    expect(corteDeDias(30)).toBe('2026-08-11'); // 11/08..09/09 = 30 dias
  });

  it('recusa janela sem sentido em vez de devolver data torta', () => {
    expect(() => corteDeDias(0)).toThrow();
    expect(() => corteDeDias(-3)).toThrow();
  });
});

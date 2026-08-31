import { describe, it, expect } from 'vitest';
import { resumirProcessos } from '../resumoDeProcessos';

const f = (process_number: string | null) => ({ process_number });

describe('resumirProcessos', () => {
  it('ficha não é processo: o mesmo CNJ duas vezes conta uma vez', () => {
    const r = resumirProcessos([
      f('0000581-03.2026.5.06.0391'),
      f('00005810320265060391'), // mesmo processo, grafia diferente
      f('0001155-57.2025.5.07.0029'),
    ]);
    expect(r.fichas).toBe(3);
    expect(r.processos).toBe(2);
    expect(r.excedentes).toBe(1);
  });

  it('separa o ramo que o POP promete do que entrou junto', () => {
    const r = resumirProcessos([
      f('0000581-03.2026.5.06.0391'), // trabalhista
      f('0001155-57.2025.5.07.0029'), // trabalhista
      f('0001351-46.2015.8.26.0001'), // estadual
      f('0800123-45.2024.4.05.8100'), // federal
    ]);
    expect(r.doRamo('trabalhista')).toMatchObject({ fichas: 2, processos: 2 });
    expect(r.doRamo('estadual')).toMatchObject({ fichas: 1, processos: 1 });
    expect(r.doRamo('federal')).toMatchObject({ fichas: 1, processos: 1 });
  });

  // Sem número não dá para saber se são o mesmo processo — deduplicar seria
  // fundir fichas de gente diferente.
  it('ficha sem número conta uma a uma, nunca deduplicada', () => {
    const r = resumirProcessos([f(null), f(''), f(null)]);
    expect(r.doRamo('SEM_NUMERO')).toMatchObject({ fichas: 3, processos: 3, excedentes: 0 });
    expect(r.processos).toBe(3);
  });

  it('número quebrado tem linha própria, não vira trabalhista por engano', () => {
    const r = resumirProcessos([f('123'), f('12345678901234567')]);
    expect(r.doRamo('NUMERO_INVALIDO')).toMatchObject({ fichas: 2, processos: 2 });
    expect(r.doRamo('trabalhista')).toBeUndefined();
  });

  it('os dois não-ramos ficam no fim da ordem, depois da jurisdição', () => {
    const r = resumirProcessos([f(null), f('0000581-03.2026.5.06.0391'), f('123')]);
    expect(r.porRamo.map(x => x.ramo)).toEqual(['trabalhista', 'NUMERO_INVALIDO', 'SEM_NUMERO']);
  });

  it('lista vazia dá zero, sem quebrar', () => {
    const r = resumirProcessos([]);
    expect(r).toMatchObject({ fichas: 0, processos: 0, excedentes: 0 });
    expect(r.porRamo).toEqual([]);
  });

  // A conta do POP trabalhista de 24/08/2026, em miniatura.
  it('o total é a soma dos ramos, fichas e processos separados', () => {
    const r = resumirProcessos([
      f('0000581-03.2026.5.06.0391'), f('00005810320265060391'),
      f('0001351-46.2015.8.26.0001'), f(null), f('123'),
    ]);
    expect(r.fichas).toBe(5);
    expect(r.processos).toBe(4);
    expect(r.excedentes).toBe(1);
  });
});

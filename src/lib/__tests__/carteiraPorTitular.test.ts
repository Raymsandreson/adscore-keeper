import { describe, it, expect } from 'vitest';
import {
  separarPorTitular, hsEhSuspeito, fatiaDoModo, type ParteDaCarteira,
} from '../carteiraPorTitular';

/** Números do caso 88 depois da correção pelo termo (26/08/2026). */
const caso88: ParteDaCarteira[] = [
  { processoCnj: '0011351-63.2022.5.15.0031', cliente: 'FRANCISCA', cota: 113636.36, hc: 48701.30, hs: 16233.77, estagio: 'PAGO' },
  { processoCnj: '0011351-63.2022.5.15.0031', cliente: 'JOÃO', cota: 113636.36, hc: 48701.30, hs: 16233.77, estagio: 'PAGO' },
  { processoCnj: '0011351-63.2022.5.15.0031', cliente: 'ALUÍZIO', cota: 56818.18, hc: 24350.65, hs: 8116.88, estagio: 'PAGO' },
];

describe('as três leituras do mesmo dado', () => {
  const c = separarPorTitular(caso88);

  it('a cota do cliente soma só o que é dele', () => {
    expect(c.cliente.total).toBeCloseTo(284090.90, 2);
  });

  it('o honorário soma contratual + sucumbencial', () => {
    expect(c.escritorio.total).toBeCloseTo(162337.67, 2);
  });

  it('juntos é exatamente a soma das duas', () => {
    expect(c.juntos.total).toBeCloseTo(c.cliente.total + c.escritorio.total, 2);
  });

  it('o modo escolhe a fatia sem recalcular nada', () => {
    expect(fatiaDoModo(c, 'CLIENTE').total).toBe(c.cliente.total);
    expect(fatiaDoModo(c, 'ESCRITORIO').total).toBe(c.escritorio.total);
    expect(fatiaDoModo(c, 'JUNTOS').total).toBe(c.juntos.total);
  });
});

describe('o sucumbencial impossível fica fora do total', () => {
  it('HS maior que a cota é suspeito — o juiz teria de arbitrar 70%', () => {
    expect(hsEhSuspeito({ hs: 9519047.50, cota: 100000 })).toBe(true);
  });

  it('HS de 15% do bruto é normal e entra', () => {
    // bruto 100.000 → cota 70.000, HS 15.000
    expect(hsEhSuspeito({ hs: 15000, cota: 70000 })).toBe(false);
  });

  it('HS zero não é suspeito: pode ter sido dispensado', () => {
    expect(hsEhSuspeito({ hs: 0, cota: 70000 })).toBe(false);
  });

  it('o suspeito sai do honorário e vai para o balde próprio', () => {
    const c = separarPorTitular([
      { processoCnj: 'X', cliente: 'A', cota: 100000, hc: 42857, hs: 9519047.50, estagio: 'CONDENACAO' },
    ]);
    expect(c.escritorio.total).toBeCloseTo(42857, 2); // só o contratual
    expect(c.hsSuspeito).toEqual({ valor: 9519047.5, partes: 1 });
  });

  it('o suspeito também não infla o "juntos"', () => {
    const c = separarPorTitular([
      { processoCnj: 'X', cliente: 'A', cota: 100000, hc: 0, hs: 500000, estagio: 'CONDENACAO' },
    ]);
    expect(c.juntos.total).toBeCloseTo(100000, 2);
  });
});

describe('quebra por estágio', () => {
  it('agrupa e ordena do maior para o menor', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', cota: 1000, hc: 0, hs: 0, estagio: 'A RECEBER' },
      { processoCnj: 'B', cliente: 'y', cota: 5000, hc: 0, hs: 0, estagio: 'CONDENACAO' },
      { processoCnj: 'C', cliente: 'z', cota: 2000, hc: 0, hs: 0, estagio: 'A RECEBER' },
    ]);
    expect(c.cliente.porEstagio[0]).toEqual({ estagio: 'CONDENACAO', valor: 5000, partes: 1 });
    expect(c.cliente.porEstagio[1]).toEqual({ estagio: 'A RECEBER', valor: 3000, partes: 2 });
  });

  it('estágio vazio vira rótulo em vez de sumir da conta', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', cota: 100, hc: 0, hs: 0, estagio: '' },
    ]);
    expect(c.cliente.porEstagio[0].estagio).toBe('SEM ESTÁGIO');
  });

  it('valor zero não cria linha de estágio', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', cota: 0, hc: 500, hs: 0, estagio: 'PAGO' },
    ]);
    expect(c.cliente.porEstagio).toEqual([]);
    expect(c.escritorio.porEstagio).toHaveLength(1);
  });

  it('o total sempre fecha com a soma dos estágios', () => {
    const c = separarPorTitular(caso88);
    for (const f of [c.cliente, c.escritorio, c.juntos]) {
      expect(f.total).toBeCloseTo(f.porEstagio.reduce((s, e) => s + e.valor, 0), 2);
    }
  });
});

describe('borda', () => {
  it('lista vazia devolve zeros, não NaN', () => {
    const c = separarPorTitular([]);
    expect(c.juntos.total).toBe(0);
    expect(c.hsSuspeito.partes).toBe(0);
  });

  it('não deixa vazar zero negativo para a tela', () => {
    const c = separarPorTitular([{ processoCnj: 'A', cliente: 'x', cota: 0, hc: 0, hs: 0, estagio: 'PAGO' }]);
    expect(Object.is(c.cliente.total, -0)).toBe(false);
  });
});

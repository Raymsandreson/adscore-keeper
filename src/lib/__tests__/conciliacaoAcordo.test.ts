import { describe, it, expect } from 'vitest';
import { conciliarAcordo, totalizarConciliacao, ordenarPorDivergencia } from '../conciliacaoAcordo';

/**
 * Números REAIS, medidos no Externo em 25/08/2026, e conferidos contra o termo
 * de acordo do caso 88 (0011351-63.2022.5.15.0031) que o Raym anexou.
 */
describe('caso 88 — a régua fecha contra o documento', () => {
  const c = conciliarAcordo({ cliente: 397727.26, hc: 284841.40, hs: 1992.59, multa: 66000 });

  it('reconstrói o HC do termo (R$ 170.454,55) a partir da cota do cliente', () => {
    expect(c.hcEsperado).toBeCloseTo(170454.54, 1);
  });

  it('reconstrói o HS do termo (R$ 56.818,18)', () => {
    expect(c.hsEsperado).toBeCloseTo(56818.18, 1);
  });

  it('o acordo esperado bate com os R$ 625.000 homologados', () => {
    expect(c.acordoEsperado).toBeCloseTo(625000, 0);
  });

  it('acusa honorário SOBRANDO — foi lançado mais do que o acordo previa', () => {
    expect(c.situacao).toBe('HC_SOBRANDO');
    expect(c.faltaHc).toBeCloseTo(-114386.86, 0);
  });

  it('a multa viaja para a tela mas fica fora da conciliação', () => {
    expect(c.multa).toBe(66000);
    expect(c.acordoLancado).toBeCloseTo(684561.25, 0); // sem a multa
  });
});

describe('os acordos que batem exatos ficam em paz', () => {
  it('cliente 35.000,04 com HC 15.000 é 30% redondo', () => {
    const c = conciliarAcordo({ cliente: 35000.04, hc: 15000 });
    expect(c.situacao).toBe('OK');
    expect(c.bruto).toBeCloseTo(50000.06, 1);
  });

  it('tolera centavo de arredondamento sem gritar', () => {
    expect(conciliarAcordo({ cliente: 70000, hc: 30000.4 }).situacao).toBe('OK');
    expect(conciliarAcordo({ cliente: 70000, hc: 30002 }).situacao).toBe('HC_SOBRANDO');
  });
});

describe('os buracos reais da carteira', () => {
  it('0000453-61.2023.5.20.0016: faltam R$ 126.428,57 de honorário', () => {
    const c = conciliarAcordo({ cliente: 645000, hc: 150000 });
    expect(c.situacao).toBe('HC_FALTANDO');
    expect(c.faltaHc).toBeCloseTo(126428.57, 1);
  });

  it('0002701-92.2017.5.22.0003: HC lançado é 10% do devido', () => {
    const c = conciliarAcordo({ cliente: 274553.84, hc: 11525.84 });
    expect(c.faltaHc).toBeCloseTo(106140.09, 1);
  });

  it('0024921-34.2021.5.24.0021: faltam R$ 54.422,84', () => {
    expect(conciliarAcordo({ cliente: 145978.46, hc: 8139.36 }).faltaHc).toBeCloseTo(54422.84, 1);
  });
});

describe('o que não dá para conferir, não se finge que confere', () => {
  it('acordo sem cota de cliente não tem régua — 30% de quê?', () => {
    const c = conciliarAcordo({ cliente: 0, hc: 50000 });
    expect(c.situacao).toBe('SEM_CLIENTE');
    expect(c.hcEsperado).toBe(0);
    expect(c.faltaHc).toBe(0);
  });

  it('valor ausente vale zero, não NaN', () => {
    const c = conciliarAcordo({ cliente: 70000, hc: 30000, hs: null, multa: undefined });
    expect(c.hs).toBe(0);
    expect(c.multa).toBe(0);
  });

  it('não deixa vazar zero negativo para a tela', () => {
    expect(Object.is(conciliarAcordo({ cliente: 70000, hc: 30000 }).faltaHc, -0)).toBe(false);
  });
});

describe('totalização', () => {
  const cs = [
    conciliarAcordo({ cliente: 645000, hc: 150000 }),          // falta 126.428,57
    conciliarAcordo({ cliente: 274553.84, hc: 11525.84 }),     // falta 106.140,09
    conciliarAcordo({ cliente: 70000, hc: 30000 }),            // ok
    conciliarAcordo({ cliente: 397727.26, hc: 284841.40, multa: 66000 }), // sobra
    conciliarAcordo({ cliente: 0, hc: 100 }),                  // sem cliente
  ];

  it('separa o que falta do que sobra, sem compensar um no outro', () => {
    const t = totalizarConciliacao(cs);
    expect(t.acordos).toBe(5);
    expect(t.ok).toBe(1);
    expect(t.semCliente).toBe(1);
    expect(t.hcFaltando).toBeCloseTo(232568.66, 0);
    expect(t.hcSobrando).toBeCloseTo(114386.86, 0);
    expect(t.saldo).toBeCloseTo(118181.80, 0);
  });

  it('soma a multa à parte', () => {
    expect(totalizarConciliacao(cs).multa).toBe(66000);
  });

  it('ordena pela maior divergência em reais, dos dois lados', () => {
    const itens = cs.map(c => ({ conciliacao: c }));
    expect(ordenarPorDivergencia(itens)[0].conciliacao.faltaHc).toBeCloseTo(126428.57, 1);
  });
});

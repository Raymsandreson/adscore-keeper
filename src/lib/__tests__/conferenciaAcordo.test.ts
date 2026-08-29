import { describe, it, expect } from 'vitest';
import { conferirAcordo, totalizarConferencia, ordenarPorDivergencia } from '../conferenciaAcordo';

/**
 * Números REAIS, medidos no Externo em 25/08/2026, e conferidos contra o termo
 * de acordo do caso 88 (0011351-63.2022.5.15.0031) que o Raym anexou.
 */
describe('caso 88 — a régua fecha contra o documento', () => {
  const c = conferirAcordo({ cliente: 397727.26, hc: 284841.40, hs: 1992.59, multa: 66000 });

  it('reconstrói o HC do termo (R$ 170.454,55) a partir da cota do cliente', () => {
    expect(c.hcEsperado).toBeCloseTo(170454.54, 1);
  });

  it('NÃO prevê o HS — ele varia de 5% a 15% conforme o juiz arbitrou', () => {
    // O termo do caso 88 traz HS de R$ 56.818,18, que calha de ser 10% redondos.
    // Foi coincidência daquele caso: a régua não deve reproduzi-la.
    expect(c).not.toHaveProperty('hsEsperado');
  });

  it('o acordo esperado usa o HS OBSERVADO, não um previsto', () => {
    // cota 397.727,26 + HC 170.454,54 + o HS que a planilha trouxe (1.992,59)
    expect(c.acordoEsperado).toBeCloseTo(570174.39, 0);
  });

  it('acusa honorário SOBRANDO — foi lançado mais do que o acordo previa', () => {
    expect(c.situacao).toBe('HC_SOBRANDO');
    expect(c.faltaHc).toBeCloseTo(-114386.86, 0);
  });

  it('a multa viaja para a tela mas fica fora da conferência', () => {
    expect(c.multa).toBe(66000);
    expect(c.acordoLancado).toBeCloseTo(684561.25, 0); // sem a multa
  });
});

describe('o sucumbencial é observado, nunca esperado', () => {
  it('HS ausente não é divergência: pode ter sido dispensado', () => {
    const c = conferirAcordo({ cliente: 70000, hc: 30000 });
    expect(c.situacao).toBe('OK');
    expect(c.hsPctDoBruto).toBeNull();
    expect(c.hsForaDaFaixa).toBe(false);
  });

  it('HS de 5% e de 15% são normais — a faixa inteira que o juiz pode arbitrar', () => {
    expect(conferirAcordo({ cliente: 70000, hc: 30000, hs: 5000 }).hsForaDaFaixa).toBe(false);
    expect(conferirAcordo({ cliente: 70000, hc: 30000, hs: 15000 }).hsForaDaFaixa).toBe(false);
  });

  it('fora da faixa a tela comenta, mas NÃO acusa divergência', () => {
    const c = conferirAcordo({ cliente: 70000, hc: 30000, hs: 30000 });
    expect(c.hsForaDaFaixa).toBe(true);
    expect(c.situacao).toBe('OK'); // o HC continua certo; só o HS chama atenção
  });

  it('majoração no cumprimento de sentença não vira erro', () => {
    // HS que subiu de 10% para 14% em execução continua dentro do usual.
    expect(conferirAcordo({ cliente: 70000, hc: 30000, hs: 14000 }).hsForaDaFaixa).toBe(false);
  });
});

describe('os acordos que batem exatos ficam em paz', () => {
  it('cliente 35.000,04 com HC 15.000 é 30% redondo', () => {
    const c = conferirAcordo({ cliente: 35000.04, hc: 15000 });
    expect(c.situacao).toBe('OK');
    expect(c.bruto).toBeCloseTo(50000.06, 1);
  });

  it('tolera centavo de arredondamento sem gritar', () => {
    expect(conferirAcordo({ cliente: 70000, hc: 30000.4 }).situacao).toBe('OK');
    expect(conferirAcordo({ cliente: 70000, hc: 30002 }).situacao).toBe('HC_SOBRANDO');
  });
});

describe('os buracos reais da carteira', () => {
  it('0000453-61.2023.5.20.0016: faltam R$ 126.428,57 de honorário', () => {
    const c = conferirAcordo({ cliente: 645000, hc: 150000 });
    expect(c.situacao).toBe('HC_FALTANDO');
    expect(c.faltaHc).toBeCloseTo(126428.57, 1);
  });

  it('0002701-92.2017.5.22.0003: HC lançado é 10% do devido', () => {
    const c = conferirAcordo({ cliente: 274553.84, hc: 11525.84 });
    expect(c.faltaHc).toBeCloseTo(106140.09, 1);
  });

  it('0024921-34.2021.5.24.0021: faltam R$ 54.422,84', () => {
    expect(conferirAcordo({ cliente: 145978.46, hc: 8139.36 }).faltaHc).toBeCloseTo(54422.84, 1);
  });
});

describe('o que não dá para conferir, não se finge que confere', () => {
  it('acordo sem cota de cliente não tem régua — 30% de quê?', () => {
    const c = conferirAcordo({ cliente: 0, hc: 50000 });
    expect(c.situacao).toBe('SEM_CLIENTE');
    expect(c.hcEsperado).toBe(0);
    expect(c.faltaHc).toBe(0);
  });

  it('valor ausente vale zero, não NaN', () => {
    const c = conferirAcordo({ cliente: 70000, hc: 30000, hs: null, multa: undefined });
    expect(c.hs).toBe(0);
    expect(c.multa).toBe(0);
  });

  it('não deixa vazar zero negativo para a tela', () => {
    expect(Object.is(conferirAcordo({ cliente: 70000, hc: 30000 }).faltaHc, -0)).toBe(false);
  });
});

describe('totalização', () => {
  const cs = [
    conferirAcordo({ cliente: 645000, hc: 150000 }),          // falta 126.428,57
    conferirAcordo({ cliente: 274553.84, hc: 11525.84 }),     // falta 106.140,09
    conferirAcordo({ cliente: 70000, hc: 30000 }),            // ok
    conferirAcordo({ cliente: 397727.26, hc: 284841.40, multa: 66000 }), // sobra
    conferirAcordo({ cliente: 0, hc: 100 }),                  // sem cliente
  ];

  it('separa o que falta do que sobra, sem compensar um no outro', () => {
    const t = totalizarConferencia(cs);
    expect(t.acordos).toBe(5);
    expect(t.ok).toBe(1);
    expect(t.semCliente).toBe(1);
    expect(t.hcFaltando).toBeCloseTo(232568.66, 0);
    expect(t.hcSobrando).toBeCloseTo(114386.86, 0);
    expect(t.saldo).toBeCloseTo(118181.80, 0);
  });

  it('soma a multa à parte', () => {
    expect(totalizarConferencia(cs).multa).toBe(66000);
  });

  it('ordena pela maior divergência em reais, dos dois lados', () => {
    const itens = cs.map(c => ({ conferencia: c }));
    expect(ordenarPorDivergencia(itens)[0].conferencia.faltaHc).toBeCloseTo(126428.57, 1);
  });
});

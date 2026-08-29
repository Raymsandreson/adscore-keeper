import { describe, it, expect } from 'vitest';
import {
  separarPorTitular, fatiaDoModo, composicao, temSeparacao, cotaZeradaComHonorario,
  type ParteDaCarteira,
} from '../carteiraPorTitular';

/** Três partes que separam titular, com a régua certa: cota 70%, honorário 30%. */
const separadas: ParteDaCarteira[] = [
  { processoCnj: '1', cliente: 'A', valor: 100000, cota: 70000, honorario: 30000, estagio: 'A_RECEBER' },
  { processoCnj: '1', cliente: 'B', valor: 50000, cota: 35000, honorario: 15000, estagio: 'A_RECEBER' },
  { processoCnj: '2', cliente: 'C', valor: 20000, cota: 14000, honorario: 6000, estagio: 'PAGO' },
];

describe('separarPorTitular', () => {
  it('separa o que é do cliente do que é do escritório', () => {
    const c = separarPorTitular(separadas);
    expect(c.cliente.total).toBe(119000);
    expect(c.escritorio.total).toBe(51000);
  });

  it('o total JUNTOS é a condenação da carteira, não a soma das fatias', () => {
    // Quando tudo fecha, dá no mesmo. O teste que importa é o de baixo.
    const c = separarPorTitular(separadas);
    expect(c.juntos.total).toBe(170000);
    expect(c.cobertura.semDono).toBe(0);
  });

  it('cada modo devolve a sua fatia', () => {
    const c = separarPorTitular(separadas);
    expect(fatiaDoModo(c, 'CLIENTE').total).toBe(c.cliente.total);
    expect(fatiaDoModo(c, 'ESCRITORIO').total).toBe(c.escritorio.total);
    expect(fatiaDoModo(c, 'JUNTOS').total).toBe(c.juntos.total);
  });

  it('abre cada fatia por estágio, do maior para o menor', () => {
    const c = separarPorTitular(separadas);
    expect(c.cliente.porEstagio.map(e => e.estagio)).toEqual(['A_RECEBER', 'PAGO']);
    expect(c.cliente.porEstagio[0]).toEqual({ estagio: 'A_RECEBER', valor: 105000, partes: 2 });
  });

  it('o estágio vazio some da abertura, mas o rótulo em branco vira SEM ESTÁGIO', () => {
    const c = separarPorTitular([
      { processoCnj: '1', cliente: 'A', valor: 1000, cota: 700, honorario: 300, estagio: '' },
    ]);
    expect(c.juntos.porEstagio[0].estagio).toBe('SEM ESTÁGIO');
  });
});

describe('a parte sem separação de titular soma na carteira e sai contada', () => {
  // 563 das 1.660 linhas do POP são assim: o valor vem de jm_valores, que fixa
  // quanto o processo vale sem dizer quanto é de quem.
  const semSeparar: ParteDaCarteira[] = [
    { processoCnj: '3', cliente: 'D', valor: 80000, cota: null, honorario: null, estagio: 'CONDENACAO' },
  ];

  it('entra inteira no total da carteira', () => {
    const c = separarPorTitular([...separadas, ...semSeparar]);
    expect(c.juntos.total).toBe(250000);
  });

  it('não entra em cliente nem em escritório — ninguém sabe de quem é', () => {
    const c = separarPorTitular([...separadas, ...semSeparar]);
    expect(c.cliente.total).toBe(119000);
    expect(c.escritorio.total).toBe(51000);
  });

  it('sai medida na cobertura, com valor e contagem', () => {
    const c = separarPorTitular([...separadas, ...semSeparar]);
    expect(c.cobertura.semSeparacao).toBe(80000);
    expect(c.cobertura.partesSemSeparacao).toBe(1);
    expect(c.cobertura.comSeparacao).toBe(170000);
    expect(c.cobertura.partesComSeparacao).toBe(3);
  });

  it('temSeparacao só é falso quando as DUAS colunas vêm nulas', () => {
    expect(temSeparacao({ cota: null, honorario: null })).toBe(false);
    expect(temSeparacao({ cota: 0, honorario: null })).toBe(true);
    expect(temSeparacao({ cota: null, honorario: 5000 })).toBe(true);
  });
});

describe('a cota zerada da importação é DETECTADA, nunca descontada', () => {
  // O caso real: 257 das 262 partes da Tab. Aux. deste POP vieram com
  // cota_parte_cjcm = 0 e honorário lançado — R$ 30,1 mi sem dono.
  const cotaZerada: ParteDaCarteira[] = [
    { processoCnj: '9', cliente: 'Z', valor: 600000, cota: 0, honorario: 300000, estagio: 'A_RECEBER' },
  ];

  it('a condenação inteira continua na carteira', () => {
    const c = separarPorTitular(cotaZerada);
    expect(c.juntos.total).toBe(600000);
  });

  it('o honorário continua somando, mesmo parecendo impossível ao lado da cota', () => {
    const c = separarPorTitular(cotaZerada);
    expect(c.escritorio.total).toBe(300000);
    expect(c.cliente.total).toBe(0);
  });

  it('o buraco vira número: R$ 300.000 sem dono, uma parte marcada', () => {
    const c = separarPorTitular(cotaZerada);
    expect(c.cobertura.semDono).toBe(300000);
    expect(c.cobertura.partesCotaZerada).toBe(1);
    expect(c.cobertura.valorCotaZerada).toBe(600000);
  });

  it('cota 0 sem honorário nenhum não é acusada — não há o que consertar', () => {
    expect(cotaZeradaComHonorario({ cota: 0, honorario: 0 })).toBe(false);
    expect(cotaZeradaComHonorario({ cota: 0, honorario: 1 })).toBe(true);
  });

  it('cota nula (a fonte não separa) não é cota zerada', () => {
    expect(cotaZeradaComHonorario({ cota: null, honorario: 300000 })).toBe(false);
  });

  it('cota positiva, ainda que pequena, não é acusada', () => {
    expect(cotaZeradaComHonorario({ cota: 0.01, honorario: 300000 })).toBe(false);
  });
});

describe('composicao', () => {
  it('reparte 100% entre cliente, escritório e sem dono', () => {
    const c = separarPorTitular(separadas);
    const p = composicao(c);
    expect(p.cliente).toBe(70);
    expect(p.escritorio).toBe(30);
    expect(p.semDono).toBe(0);
  });

  it('a base é o que separa, não a carteira inteira', () => {
    // A parte sem separação não pode empurrar os percentuais para baixo: ela
    // não está sendo repartida, está fora da barra.
    const c = separarPorTitular([
      ...separadas,
      { processoCnj: '3', cliente: 'D', valor: 999999, cota: null, honorario: null, estagio: 'CONDENACAO' },
    ]);
    expect(composicao(c).cliente).toBe(70);
  });

  it('carteira sem nenhuma separação devolve zeros, não NaN', () => {
    const c = separarPorTitular([
      { processoCnj: '3', cliente: 'D', valor: 80000, cota: null, honorario: null, estagio: 'CONDENACAO' },
    ]);
    expect(composicao(c)).toEqual({ cliente: 0, escritorio: 0, semDono: 0 });
  });
});

describe('bordas', () => {
  it('carteira vazia devolve zeros', () => {
    const c = separarPorTitular([]);
    expect(c.juntos.total).toBe(0);
    expect(c.cobertura.comSeparacao).toBe(0);
  });

  it('parte zerada não vira linha de estágio', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', valor: 0, cota: 0, honorario: 0, estagio: 'PAGO' },
    ]);
    expect(c.juntos.porEstagio).toEqual([]);
    expect(c.juntos.partes).toBe(0);
  });

  it('não devolve zero negativo — a tela mostraria "-R$ 0,00"', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', valor: 100, cota: 70, honorario: 30, estagio: 'PAGO' },
    ]);
    expect(Object.is(c.cobertura.semDono, -0)).toBe(false);
    expect(c.cobertura.semDono).toBe(0);
  });

  it('fatia passando do bolo aparece como sem dono negativo, não escondida', () => {
    const c = separarPorTitular([
      { processoCnj: 'A', cliente: 'x', valor: 100, cota: 70, honorario: 90, estagio: 'PAGO' },
    ]);
    expect(c.cobertura.semDono).toBe(-60);
  });
});

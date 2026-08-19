// "Quanto vale o processo" — os números vêm da Tab. Aux importada em 18/08/2026.
// Cada caso aqui é uma linha real da planilha, não um número inventado.
import { describe, it, expect } from 'vitest';
import {
  montarParteValor, honorarioDaParte, cotaBrutaDaParte, cotaClienteDaParte,
  vincendoBrutoDaParte, cotaEhProjecao, parteSemValor, resumirValorProcesso,
  type ParteValor,
} from '../valorProcesso';

/** Caso 10 (P0302): acordo fechado e pago, sem parcelamento de honorário. */
const parte = (over: Partial<ParteValor> = {}): ParteValor => ({
  parteId: 'P0302', cliente: 'ANTONIO JOSE DA SILVA',
  condenacao: 28571.43, cota: 20000, cotaVista: 20000,
  hcVista: 8571.43, hcParcelado: 0, hs: 0,
  status: 'PAGO', fase: 'Conclusão',
  ...over,
});

/** P1000: linha PROJETADA — "TOTAL PARTE CJCM" vem 0, o valor está no "à vista". */
const projetada = (over: Partial<ParteValor> = {}): ParteValor => ({
  parteId: 'P1000', cliente: null,
  condenacao: 175571.11, cota: 0, cotaVista: 95317.1,
  hcVista: 40850.18, hcParcelado: 0, hs: 39403.83,
  status: 'PROJETADO', fase: 'Conhecimento',
  ...over,
});

/**
 * P0043, processo 0000072-69.2023.5.13.0009 (TRT13): PENSIONAMENTO. Parte da
 * pensão já venceu e vira pagamento à vista; o resto segue correndo. O honorário
 * contratual é 30% do bruto de cada fatia, e a cota já vem líquida nas duas.
 */
const pensionada = (over: Partial<ParteValor> = {}): ParteValor => ({
  parteId: 'P0043', cliente: null,
  condenacao: 346134.35, cota: 290622.07, cotaVista: 110279.95,
  hcVista: 47262.84, hcParcelado: 77289.48, hs: 8249.44,
  status: 'A RECEBER', fase: 'Recurso Instância Superior',
  ...over,
});

describe('valor do processo', () => {
  it('lê a linha crua de jm_partes sem inventar zero onde não há valor', () => {
    const p = montarParteValor({
      parte_id: 'P0302', cliente: ' ANTONIO ', condenacao_cjcm: '28571.43',
      cota_parte_cjcm: '20000', hc_vista: '8571.43', hs: null,
      status_pagamento: 'PAGO', fase_atual: '',
    });
    expect(p.cliente).toBe('ANTONIO');
    expect(p.condenacao).toBeCloseTo(28571.43);
    expect(p.hs).toBeNull();       // null é "não veio", não é zero
    expect(p.fase).toBeNull();     // string vazia da planilha também não é dado
  });

  it('honorário da parte é contratual vencido + vincendo + sucumbencial', () => {
    expect(honorarioDaParte(parte())).toBeCloseTo(8571.43);
    expect(honorarioDaParte(pensionada())).toBeCloseTo(132801.76);
    expect(honorarioDaParte(parte({ hcVista: null, hcParcelado: null, hs: null }))).toBe(0);
  });

  it('cota zerada com "à vista" preenchido é projeção, e a projeção vale como cota', () => {
    // Sem esse fallback a linha PROJETADA some da conta do cliente: são 251 das
    // 688 partes com valor, e o total do processo ficaria só com o honorário.
    expect(cotaEhProjecao(projetada())).toBe(true);
    expect(cotaBrutaDaParte(projetada())).toBeCloseTo(95317.1);
    expect(cotaEhProjecao(parte())).toBe(false);
    expect(cotaBrutaDaParte(parte())).toBe(20000);
  });

  it('a cota da planilha JÁ é líquida — descontar o parcelado dela rouba o cliente', () => {
    // O erro que estava em produção: mostrava 213.332,59 para a Ivonete, tirando
    // dela R$ 77.289,48 de honorário que a planilha já havia descontado.
    expect(cotaClienteDaParte(pensionada())).toBeCloseTo(290622.07);
    const r = resumirValorProcesso([pensionada()]);
    expect(r.cotaCliente).toBeCloseTo(290622.07);
    expect(r.diferenca).toBe(0);   // condenação = cota + hc vencido + hs
  });

  it('o honorário é 30% do BRUTO de cada fatia — vencida e vincenda', () => {
    const p = pensionada();
    const brutoVencido = (p.cotaVista as number) + (p.hcVista as number);
    expect((p.hcVista as number) / brutoVencido).toBeCloseTo(0.30, 4);
    // O vincendo bruto se recupera do líquido: 70% dele é o que sobrou na cota.
    expect(vincendoBrutoDaParte(p)).toBeCloseTo(257631.6, 1);
    expect((p.hcParcelado as number) / vincendoBrutoDaParte(p)).toBeCloseTo(0.30, 4);
  });

  it('a coluna "condenação" deixa o honorário das vincendas de fora', () => {
    // Por isso ela sozinha subestima o processo: o bruto é condenação + parcelado.
    const r = resumirValorProcesso([pensionada()]);
    expect(r.condenacao).toBeCloseTo(346134.35);
    expect(r.escritorioApurado).toBeCloseTo(55512.28);   // hc vencido + hs
    expect(r.hcParcelado).toBeCloseTo(77289.48);         // ainda vai ser apurado
    expect(r.bruto).toBeCloseTo(423423.83);
    // Fecha por baixo: cliente + o nosso já apurado = a condenação registrada.
    expect(r.cotaCliente + r.escritorioApurado).toBeCloseTo(346134.35);
  });

  it('sem vincendo, apurado e total do escritório coincidem', () => {
    // P0040/P0044 do mesmo processo: pensão encerrada, nada mais a vencer.
    const r = resumirValorProcesso([pensionada({
      parteId: 'P0040', condenacao: 133119, cota: 88746, cotaVista: 88746,
      hcVista: 38034, hcParcelado: 0, hs: 6339,
    })]);
    expect(vincendoBrutoDaParte(r.partes[0])).toBe(0);
    expect(r.escritorio).toBe(r.escritorioApurado);
    expect(r.bruto).toBe(r.condenacao);
    expect(r.diferenca).toBe(0);
  });

  it('parte que a planilha trouxe só com status não conta como parte com valor', () => {
    const so = parte({ condenacao: null, cota: 0, cotaVista: null, hcVista: null, hcParcelado: 0, hs: null });
    expect(parteSemValor(so)).toBe(true);
    expect(parteSemValor(parte())).toBe(false);
    const r = resumirValorProcesso([parte(), so]);
    expect(r.comValor).toBe(1);
    expect(r.semValor).toBe(1);
  });

  it('o caso que originou tudo: 200k é o TOTAL, não a cota do cliente', () => {
    // 7 partes iguais. A tela antiga mostrava os 200k como se fossem do cliente.
    const r = resumirValorProcesso(Array.from({ length: 7 }, (_, i) => parte({ parteId: `P${i}` })));
    expect(r.condenacao).toBe(200000.01);
    expect(r.cotaCliente).toBe(140000);
    expect(r.escritorio).toBe(60000.01);   // 8.571,43 de cada
    expect(r.hs).toBe(0);
    expect(r.diferenca).toBe(0);
    expect(r.cotaProjetada).toBe(0);
    expect(r.status).toEqual([{ status: 'PAGO', partes: 7 }]);
  });

  it('processo projetado fecha e se declara projeção', () => {
    const r = resumirValorProcesso([projetada(), projetada({ parteId: 'P1001' })]);
    expect(r.condenacao).toBeCloseTo(351142.22);
    expect(r.cotaCliente).toBeCloseTo(190634.2);
    expect(r.escritorio).toBeCloseTo(160508.02);
    expect(r.diferenca).toBe(0);
    expect(r.cotaProjetada).toBe(2);
  });

  it('quando a planilha não fecha, a diferença aparece em vez de sumir', () => {
    // 9 das 688 partes não fecham em nenhuma leitura das colunas.
    const r = resumirValorProcesso([parte({ condenacao: 30000 })]);
    expect(r.diferenca).toBeCloseTo(1428.57);
  });

  it('soma de float não deixa resíduo na diferença', () => {
    const r = resumirValorProcesso([
      parte({ condenacao: 0.1, cota: 0.05, cotaVista: null, hcVista: 0.05, hcParcelado: null, hs: null }),
      parte({ condenacao: 0.2, cota: 0.1, cotaVista: null, hcVista: 0.1, hcParcelado: null, hs: null }),
    ]);
    expect(r.diferenca).toBe(0);
  });

  it('ordena por condenação: numa ação com muitas partes, a maior vem antes', () => {
    const r = resumirValorProcesso([
      parte({ parteId: 'pequena', condenacao: 100 }),
      parte({ parteId: 'grande', condenacao: 900 }),
      parte({ parteId: 'sem', condenacao: null }),
    ]);
    expect(r.partes.map(p => p.parteId)).toEqual(['grande', 'pequena', 'sem']);
  });

  it('status agrupa por frequência, e parte sem status não vira "null"', () => {
    const r = resumirValorProcesso([
      parte({ status: 'A RECEBER' }), parte({ status: 'A RECEBER' }),
      parte({ status: 'PAGO' }), parte({ status: null }),
    ]);
    expect(r.status).toEqual([{ status: 'A RECEBER', partes: 2 }, { status: 'PAGO', partes: 1 }]);
  });

  it('processo sem parte importada devolve zeros, não NaN', () => {
    const r = resumirValorProcesso([]);
    expect(r).toMatchObject({
      condenacao: 0, cotaCliente: 0, cotaVencida: 0, escritorio: 0,
      escritorioApurado: 0, bruto: 0, diferenca: 0,
      comValor: 0, semValor: 0, cotaProjetada: 0,
    });
    expect(r.status).toEqual([]);
  });
});

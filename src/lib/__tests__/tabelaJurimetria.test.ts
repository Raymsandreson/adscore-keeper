// A tabela crua da carteira (jm_partes / aba Tab. Aux).
import { describe, it, expect } from 'vitest';
import {
  montarLinha, honorarioDaLinha, filtrar, totalizar, opcoes, gerarCsv,
  FILTRO_VAZIO, type LinhaTabela,
} from '../tabelaJurimetria';

const linha = (over: Partial<LinhaTabela> = {}): LinhaTabela => ({
  parteId: 'P0043', processo: '0000072-69.2023.5.13.0009',
  cliente: 'IVONETE CARDOSO DO NASCIMENTO', uf: 'PB', cidade: 'João Pessoa',
  status: 'A RECEBER', fase: 'Recurso Instância Superior',
  termoInicial: '2024-04-25',
  condenacao: 346134.35, cota: 290622.07, cotaVista: 110279.95,
  hcVista: 47262.84, hcParcelado: 77289.48, hs: 8249.44,
  importadoEm: '2026-08-18T23:00:00Z',
  ...over,
});

describe('montar a linha', () => {
  it('lê a linha crua sem transformar ausência em zero', () => {
    const l = montarLinha({
      parte_id: 'P0043', processo_cnj: '0000072-69.2023.5.13.0009',
      cliente: ' IVONETE ', condenacao_cjcm: '346134.35', hs: null,
      status_pagamento: 'A RECEBER', fase_atual: '',
    });
    expect(l.cliente).toBe('IVONETE');
    expect(l.condenacao).toBeCloseTo(346134.35);
    expect(l.hs).toBeNull();
    expect(l.fase).toBeNull();
  });

  it('honorário da linha é contratual vencido + vincendo + sucumbencial', () => {
    expect(honorarioDaLinha(linha())).toBeCloseTo(132801.76);
    expect(honorarioDaLinha(linha({ hcVista: null, hcParcelado: null, hs: null }))).toBe(0);
  });
});

describe('filtrar', () => {
  const base = [
    linha(),
    linha({ parteId: 'P0040', cliente: 'BRAYE IOGOR', status: 'PAGO', hcParcelado: 0 }),
    linha({ parteId: 'P0041', cliente: 'DAYANE DA SILVA', status: null, condenacao: null,
            cota: null, cotaVista: null, hcVista: null, hcParcelado: null, hs: null }),
  ];

  it('sem filtro devolve tudo', () => {
    expect(filtrar(base, FILTRO_VAZIO)).toHaveLength(3);
  });

  it('busca ignora acento e caixa', () => {
    // Metade dos nomes da planilha está sem acento; exigir o acento não acharia.
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'ivonete' })).toHaveLength(1);
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'IVONETE' })).toHaveLength(1);
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'joão' })).toHaveLength(3);  // cidade
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'joao' })).toHaveLength(3);
  });

  it('vários termos se somam em vez de se alargarem', () => {
    // "braye pago" tem que achar o Braye que está pago, não tudo que tem "pago".
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'braye pago' })).toHaveLength(1);
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'ivonete pago' })).toHaveLength(0);
  });

  it('acha pelo id da parte e pelo processo', () => {
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: 'P0040' })).toHaveLength(1);
    expect(filtrar(base, { ...FILTRO_VAZIO, busca: '0000072-69' })).toHaveLength(3);
  });

  it('filtra por com ou sem valor', () => {
    expect(filtrar(base, { ...FILTRO_VAZIO, valor: 'com' })).toHaveLength(2);
    expect(filtrar(base, { ...FILTRO_VAZIO, valor: 'sem' })).toHaveLength(1);
  });

  it('filtro de status casa exato — não confunde "PAGO" com "A RECEBER"', () => {
    expect(filtrar(base, { ...FILTRO_VAZIO, status: 'PAGO' })).toHaveLength(1);
    expect(filtrar(base, { ...FILTRO_VAZIO, status: 'A RECEBER' })).toHaveLength(1);
  });
});

describe('totalizar', () => {
  it('conta partes e partes com valor separadamente', () => {
    const t = totalizar([linha(), linha({ parteId: 'x', condenacao: null, cota: null,
      cotaVista: null, hcVista: null, hcParcelado: null, hs: null })]);
    expect(t.partes).toBe(2);
    expect(t.comValor).toBe(1);
    expect(t.condenacao).toBeCloseTo(346134.35);
    expect(t.honorario).toBeCloseTo(132801.76);
  });

  it('lista vazia devolve zeros, não NaN', () => {
    expect(totalizar([])).toEqual({ partes: 0, comValor: 0, condenacao: 0, cota: 0, honorario: 0 });
  });
});

describe('opções de filtro', () => {
  it('valores distintos, ordenados, sem nulo', () => {
    const l = [linha({ status: 'PAGO' }), linha({ status: 'A RECEBER' }), linha({ status: null })];
    expect(opcoes(l, 'status')).toEqual(['A RECEBER', 'PAGO']);
  });
});

describe('CSV', () => {
  it('abre no Excel em português: BOM, ponto-e-vírgula e decimal com vírgula', () => {
    const csv = gerarCsv([linha()]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('parte_id;processo;cliente');
    expect(csv).toContain('346134,35');
    expect(csv).not.toContain('346134.35');
  });

  it('escapa o campo que tem ponto-e-vírgula, senão a coluna vaza', () => {
    const csv = gerarCsv([linha({ cliente: 'SOUSA; MARIA' })]);
    expect(csv).toContain('"SOUSA; MARIA"');
  });

  it('aspas dentro do texto viram aspas duplas', () => {
    const csv = gerarCsv([linha({ cliente: 'JOSE "ZEZO" LIMA' })]);
    expect(csv).toContain('"JOSE ""ZEZO"" LIMA"');
  });

  it('campo nulo vira vazio, não "null"', () => {
    const csv = gerarCsv([linha({ hs: null, fase: null })]);
    expect(csv).not.toContain('null');
  });
});

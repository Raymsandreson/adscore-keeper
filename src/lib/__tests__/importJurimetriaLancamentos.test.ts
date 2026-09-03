// Importadores da aba "Lançamentos" (Jurimetria/indenização).
// Os casos vêm do CSV real exportado em 03/09/2026: 2.926 linhas úteis,
// 1.904 de decisão e 1.022 de parcela.
import { describe, it, expect } from 'vitest';
import {
  valor, percentual, data, cnj, nomeChave, chaveParte,
  classificarDecisao, rotulosDesconhecidos, separar, chaveDecisao,
} from '../../../scripts/jurimetria-lancamentos-comum.mjs';
import {
  planejar as planejarDecisoes, proximoDecId, gerarSql as sqlDecisoes,
} from '../../../scripts/import-jurimetria-decisoes.mjs';
import {
  statusParcela, planejar as planejarParcelas, gerarSql as sqlParcelas,
} from '../../../scripts/import-jurimetria-parcelas.mjs';

describe('leitura de células', () => {
  it('valor em real brasileiro', () => {
    expect(valor('R$ 1.635.037,25')).toBe(1635037.25);
    expect(valor('R$ 0,00')).toBe(0);
    expect(valor('(R$ 1.420,82)')).toBe(-1420.82);
  });

  it('#N/A e vazio viram null, não zero — zero é um valor decidido', () => {
    expect(valor('#N/A')).toBeNull();
    expect(valor('')).toBeNull();
    expect(valor('-')).toBeNull();
  });

  it('percentual da planilha vira fração do banco', () => {
    expect(percentual('10,00%')).toBe(0.1);
    expect(percentual('33,33%')).toBeCloseTo(0.3333, 4);
  });

  it('data brasileira vira ISO', () => {
    expect(data('26/09/2020')).toBe('2020-09-26');
    expect(data('4/7/2022')).toBe('2022-07-04');
  });

  it('a data zero do Excel não é data', () => {
    // 30/12/1899 aparece em célula vazia formatada como data. Gravar isso como
    // termo inicial faria a correção monetária render 126 anos.
    expect(data('30/12/1899')).toBeNull();
  });

  it('CNJ só passa com 20 dígitos', () => {
    expect(cnj('0100419-74.2021.5.01.0281')).toBe('0100419-74.2021.5.01.0281');
    expect(cnj('s/ nº pendente protocolo')).toBeNull();
  });

  it('nome casa apesar de acento e espaço duplo', () => {
    expect(nomeChave('ANTÔNIA  COQUEIRO DA LUZ')).toBe('ANTONIA COQUEIRO DA LUZ');
  });
});

describe('classificação do rótulo da planilha', () => {
  it('mapeia os rótulos de decisão para (tipo, instância) do banco', () => {
    expect(classificarDecisao('SENTENÇA')).toEqual(['SENTENÇA', '1º GRAU']);
    expect(classificarDecisao('ACÓRDÃO 2º GRAU')).toEqual(['ACÓRDÃO', '2º GRAU']);
    expect(classificarDecisao('EMBARGOS 2º GRAU')).toEqual(['EMBARGOS DE DECLARAÇÃO', '2º GRAU']);
    expect(classificarDecisao('DECISÃO TST')).toEqual(['DECISÃO', 'TST']);
    expect(classificarDecisao('2º EMBARGOS 1º GRAU')).toEqual(['EMBARGOS DE DECLARAÇÃO', '1º GRAU']);
  });

  it('acordo carrega a instância do sufixo', () => {
    expect(classificarDecisao('ACORDO ANTES DA SENTENÇA')).toEqual(['HOMOLOGAÇÃO DE ACORDO', '1º GRAU']);
    expect(classificarDecisao('ACORDO COM ACÓRDÃO 2º GRAU')).toEqual(['HOMOLOGAÇÃO DE ACORDO', '2º GRAU']);
    expect(classificarDecisao('ACORDO COM ACÓRDÃO TST')).toEqual(['HOMOLOGAÇÃO DE ACORDO', 'TST']);
  });

  it('"SEM DECISÃO" NÃO é decisão — o valor ali é projeção', () => {
    // 612 linhas na planilha de 03/09/2026. Virassem decisão, a escada do
    // honorário liberaria tranche sobre número que ninguém julgou.
    expect(classificarDecisao('SEM DECISÃO')).toBeNull();
    expect(classificarDecisao('ARQUIVAMENTO')).toBeNull();
    expect(classificarDecisao('SUSPENSO')).toBeNull();
    expect(classificarDecisao('cancelado')).toBeNull();
  });

  it('rótulo novo aparece no relatório em vez de virar decisão silenciosa', () => {
    const fora = rotulosDesconhecidos([{ decisao: 'ACÓRDÃO REGIONAL INÉDITO' } as never]);
    expect(fora).toEqual([['ACÓRDÃO REGIONAL INÉDITO', 1]]);
  });
});

describe('separação decisão x parcela', () => {
  it('N° DA PARCELA é o que separa fluxo de julgamento', () => {
    const { decisoes, parcelas } = separar([
      { processo: '0000034-39.2023.5.05.0281', cliente: 'A', n_parcela: null, data_parcela: null },
      { processo: '0000034-39.2023.5.05.0281', cliente: 'A', n_parcela: '2', data_parcela: '2023-11-10' },
      { processo: '0000034-39.2023.5.05.0281', cliente: 'A', n_parcela: null, data_parcela: '2023-12-10' },
    ] as never);
    expect(decisoes).toHaveLength(1);
    expect(parcelas).toHaveLength(2);
  });

  it('linha sem processo ou sem cliente não entra em nenhum dos dois', () => {
    const { decisoes, parcelas } = separar([
      { processo: null, cliente: 'A', n_parcela: null, data_parcela: null },
      { processo: '0000034-39.2023.5.05.0281', cliente: null, n_parcela: '1', data_parcela: null },
    ] as never);
    expect(decisoes).toHaveLength(0);
    expect(parcelas).toHaveLength(0);
  });
});

describe('planejar decisões', () => {
  const PARTES = [
    { parte_id: 'P0922', processo_cnj: '0100419-74.2021.5.01.0281', cliente: 'CHANGRILLAYNE BIAZINI' },
    { parte_id: 'P0926', processo_cnj: '0100419-74.2021.5.01.0281', cliente: 'MARIA RIBEIRO FERNANDES' },
  ];
  const linha = (cliente: string, decisao: string, dt: string, dm: number) => ({
    cliente, processo: '0100419-74.2021.5.01.0281', decisao, data_decisao: dt,
    termo_inicial_jcm: '2025-05-27', dano_moral: dm, dano_estetico: null,
    base_calculo: 161.39, meses_pensionamento: 474, meses_pensionamento_raw: '474',
    hs_pct: 0.1, titulo_judicial: null, orgao: null, relator: null, link: null,
  });

  it('reaproveita o dec_id da decisão que já está no banco', () => {
    const banco = [{
      dec_id: 'D0406', processo_cnj: '0100419-74.2021.5.01.0281',
      tipo_evento: 'ACÓRDÃO', instancia: '2º GRAU', data_decisao: '2025-05-21',
    }];
    const p = planejarDecisoes(
      [linha('MARIA RIBEIRO FERNANDES', 'ACÓRDÃO 2º GRAU', '2025-05-21', 200000)],
      banco, PARTES, []);
    expect(p.decisoesNovas).toHaveLength(0);
    expect(p.valores[0]).toMatchObject({ dec_id: 'D0406', parte_id: 'P0926', dano_moral: 200000 });
  });

  it('cria dec_id novo continuando a sequência, e uma só por decisão', () => {
    const banco = [{
      dec_id: 'D0439', processo_cnj: 'x', tipo_evento: 'SENTENÇA',
      instancia: '1º GRAU', data_decisao: '2024-08-11',
    }];
    const p = planejarDecisoes([
      linha('MARIA RIBEIRO FERNANDES', 'ACÓRDÃO 2º GRAU', '2025-05-21', 200000),
      linha('CHANGRILLAYNE BIAZINI', 'ACÓRDÃO 2º GRAU', '2025-05-21', 25000),
    ], banco, PARTES, []);
    expect(p.decisoesNovas).toHaveLength(1);          // duas partes, UMA decisão
    expect(p.decisoesNovas[0].dec_id).toBe('D0440');
    expect(p.valores.map((v) => v.parte_id)).toEqual(['P0926', 'P0922']);
  });

  it('decisão sem data não entra — sem data não há degrau na escada', () => {
    const p = planejarDecisoes(
      [linha('MARIA RIBEIRO FERNANDES', 'SENTENÇA', null as never, 5000)], [], PARTES, []);
    expect(p.decisoesNovas).toHaveLength(0);
    expect(p.semData).toHaveLength(1);
  });

  it('parte que não existe no banco vai para o relatório, não é inventada', () => {
    const p = planejarDecisoes(
      [linha('FULANO QUE NAO EXISTE', 'SENTENÇA', '2024-05-29', 5000)], [], PARTES, []);
    expect(p.semParte).toHaveLength(1);
    expect(p.valores).toHaveLength(0);
    expect(p.decisoesNovas).toHaveLength(1);  // a decisão existe mesmo sem a parte
  });

  it('decisão do banco ausente da planilha vira órfã, nunca DELETE', () => {
    const banco = [{
      dec_id: 'D0091', processo_cnj: '0000352-23.2023.5.09.0665',
      tipo_evento: 'HOMOLOGAÇÃO DE ACORDO', instancia: '1º GRAU', data_decisao: '2023-12-11',
    }];
    const p = planejarDecisoes([], banco, PARTES, []);
    expect(p.orfas).toHaveLength(1);
    expect(p.orfas[0].dec_id).toBe('D0091');
    expect(sqlDecisoes(p)).not.toMatch(/delete/i);
  });

  it('valor que já existe é marcado para UPDATE, não duplicado', () => {
    const banco = [{
      dec_id: 'D0406', processo_cnj: '0100419-74.2021.5.01.0281',
      tipo_evento: 'ACÓRDÃO', instancia: '2º GRAU', data_decisao: '2025-05-21',
    }];
    const p = planejarDecisoes(
      [linha('MARIA RIBEIRO FERNANDES', 'ACÓRDÃO 2º GRAU', '2025-05-21', 200000)],
      banco, PARTES, [{ dec_id: 'D0406', parte_id: 'P0926' }]);
    expect(p.valores).toHaveLength(1);
    expect(p.valoresNovos).toHaveLength(0);
    expect(sqlDecisoes(p)).toMatch(/on conflict \(dec_id, parte_id\) do update/);
  });

  it('proximoDecId zera direito quando o banco está vazio', () => {
    expect(proximoDecId([])()).toBe('D0001');
    expect(proximoDecId(['D0439'])()).toBe('D0440');
  });
});

describe('planejar parcelas', () => {
  const PARTES = [
    { parte_id: 'P0025', processo_cnj: '0000034-39.2023.5.05.0281', cliente: 'ANTONIO BENEDITO DOS SANTOS' },
  ];
  const parcela = (n: number, status: string, dt: string) => ({
    cliente: 'ANTONIO BENEDITO DOS SANTOS', processo: '0000034-39.2023.5.05.0281',
    status, forma: 'ACORDO', desagio: 0, n_parcela: n, data_parcela: dt,
    data_recebida: status === 'RECEBIDA' ? dt : null,
    data_prevista: status === 'RECEBIDA' ? null : dt,
    valor_previsto: 7405.21,
  });

  it('"Pago" e "A receber" viram o status do banco', () => {
    expect(statusParcela('Pago')).toBe('RECEBIDA');
    expect(statusParcela('A receber')).toBe('A_RECEBER');
  });

  it('a data cai no campo do status — nunca nos dois', () => {
    // Misturar previsto com recebido é o que faz o caixa mostrar como realizado
    // o que ainda não entrou.
    const p = planejarParcelas(
      [parcela(1, 'RECEBIDA', '2023-10-10'), parcela(2, 'A_RECEBER', '2023-11-10')],
      [], PARTES);
    expect(p.inserir[0]).toMatchObject({ data_recebida: '2023-10-10', data_prevista: null });
    expect(p.inserir[1]).toMatchObject({ data_recebida: null, data_prevista: '2023-11-10' });
  });

  it('parcela que já está no banco não é reinserida', () => {
    const p = planejarParcelas(
      [parcela(1, 'RECEBIDA', '2023-10-10'), parcela(2, 'RECEBIDA', '2023-11-10')],
      [{ id: 619, processo_cnj: '0000034-39.2023.5.05.0281', parte_id: 'P0025', n_parcela: 1 }],
      PARTES);
    expect(p.inserir.map((r) => r.n_parcela)).toEqual([2]);
    expect(p.jaExiste.map((r) => r.n_parcela)).toEqual([1]);
  });

  it('pagamento do banco ausente da planilha vira órfão, nunca DELETE', () => {
    const p = planejarParcelas([],
      [{ id: 619, processo_cnj: '0000034-39.2023.5.05.0281', parte_id: 'P0025', n_parcela: 1 }],
      PARTES);
    expect(p.orfaos).toHaveLength(1);
    expect(sqlParcelas(p)).not.toMatch(/delete/i);
  });

  it('parcela sem número não entra — a chave é (parte, número)', () => {
    const p = planejarParcelas([{ ...parcela(1, 'RECEBIDA', '2023-10-10'), n_parcela: null }], [], PARTES);
    expect(p.semNumero).toHaveLength(1);
    expect(p.inserir).toHaveLength(0);
  });
});

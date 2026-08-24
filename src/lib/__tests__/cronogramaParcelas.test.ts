import { describe, it, expect } from 'vitest';
import {
  expandirCronograma, ratear, casarParte, type ParcelaLida,
} from '../cronogramaParcelas';

/**
 * Dados reais do Externo (24/08/2026), caso 88 — CNJ 0011351-63.2022.5.15.0031.
 * A homologação (leitura 268) fixa R$ 625.000 em PARCELAMENTO e devolve
 * `cronograma: []`: as parcelas estão no termo de acordo, que é peça restrita.
 * É o estado real de TODAS as 21 leituras hoje — nenhuma trouxe cronograma.
 */
describe('a peça que promete parcela mas não a detalha', () => {
  it('acordo com forma PARCELAMENTO e cronograma vazio não inventa parcela', () => {
    const r = expandirCronograma([], ['ANTONIO', 'MARIA']);
    expect(r.parcelas).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.avisos).toEqual([]);
  });
});

describe('quando a peça diz de quem é cada parcela', () => {
  const cron: ParcelaLida[] = [
    { nParcela: 1, dataPrevista: '2026-09-10', valor: 10000, beneficiario: 'JOAO DA SILVA' },
    { nParcela: 2, dataPrevista: '2026-10-10', valor: 10000, beneficiario: 'MARIA SOUZA' },
  ];
  const partes = ['JOÃO DA SILVA', 'MARIA SOUZA', 'PEDRO LIMA'];

  it('NÃO multiplica pelas partes — seria triplicar o processo', () => {
    const r = expandirCronograma(cron, partes);
    expect(r.parcelas).toHaveLength(2);
    expect(r.total).toBe(20000);
  });

  it('casa o beneficiário com a parte mesmo sem acento', () => {
    const r = expandirCronograma(cron, partes);
    expect(r.parcelas[0].parteNome).toBe('JOÃO DA SILVA');
  });

  it('preserva a data e o número da parcela', () => {
    const r = expandirCronograma(cron, partes);
    expect(r.parcelas[1]).toMatchObject({ nParcela: 2, dataPrevista: '2026-10-10' });
  });

  it('avisa quando o beneficiário não bate com parte nenhuma, mas guarda o nome', () => {
    const r = expandirCronograma(
      [{ nParcela: 1, dataPrevista: '2026-09-10', valor: 500, beneficiario: 'CARLOS' }],
      partes,
    );
    expect(r.parcelas[0].parteNome).toBe('CARLOS');
    expect(r.avisos.join(' ')).toContain('não bate com nenhuma parte');
  });
});

describe('cronograma global', () => {
  const cron: ParcelaLida[] = [{ nParcela: 1, dataPrevista: '2026-09-10', valor: 10000 }];

  it('com uma parte só, atribui: não há a quem mais', () => {
    const r = expandirCronograma(cron, ['ANTONIO']);
    expect(r.parcelas[0].parteNome).toBe('ANTONIO');
    expect(r.parcelas[0].precisaRateio).toBe(false);
    expect(r.totalAtribuido).toBe(10000);
  });

  it('com várias partes e sem ordem, se recusa a dividir e marca para conferência', () => {
    const r = expandirCronograma(cron, ['A', 'B', 'C']);
    expect(r.parcelas).toHaveLength(1);
    expect(r.parcelas[0].parteNome).toBeNull();
    expect(r.parcelas[0].precisaRateio).toBe(true);
    expect(r.totalAtribuido).toBe(0); // sem dono não entra em total
    expect(r.avisos.join(' ')).toContain('sem dizer de quem é');
  });

  it('sem parte nenhuma fica sem dono, e não há rateio a fazer', () => {
    const r = expandirCronograma(cron, []);
    expect(r.parcelas[0].parteNome).toBeNull();
    expect(r.parcelas[0].precisaRateio).toBe(false);
    expect(r.avisos.join(' ')).toContain('não abriu partes');
  });
});

describe('o exemplo do Raym: 10 parcelas de 10k para cada parte, 3 partes', () => {
  const dez: ParcelaLida[] = Array.from({ length: 10 }, (_, i) => ({
    nParcela: i + 1,
    dataPrevista: `2026-${String(i + 1).padStart(2, '0')}-10`,
    valor: 10000,
  }));

  it('POR_PARTE dá as 30 linhas, cada uma com seu vencimento', () => {
    const r = expandirCronograma(dez, ['A', 'B', 'C'], { rateio: 'POR_PARTE' });
    expect(r.parcelas).toHaveLength(30);
    expect(r.total).toBe(300000);
    expect(r.totalAtribuido).toBe(300000);
    const daParteA = r.parcelas.filter((p) => p.parteNome === 'A');
    expect(daParteA).toHaveLength(10);
    expect(daParteA.map((p) => p.dataPrevista)).toContain('2026-10-10');
  });

  it('DIVIDIR também dá 30 linhas, mas o total continua o do plano', () => {
    const r = expandirCronograma(dez, ['A', 'B', 'C'], { rateio: 'DIVIDIR' });
    expect(r.parcelas).toHaveLength(30);
    expect(r.total).toBe(100000);
  });
});

describe('rateio não pode perder centavo', () => {
  it('10.000 em 3 fecha exatamente em 10.000', () => {
    const f = ratear(10000, 3);
    expect(f).toEqual([3333.34, 3333.33, 3333.33]);
    expect(f.reduce((s, v) => s + v, 0)).toBeCloseTo(10000, 10);
  });

  it('a sobra vai para as primeiras, nunca some', () => {
    expect(ratear(100, 7).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
    expect(ratear(0.05, 3)).toEqual([0.02, 0.02, 0.01]);
  });

  it('valor rateado soma de volta dentro da expansão', () => {
    const r = expandirCronograma(
      [{ nParcela: 1, dataPrevista: '2026-09-10', valor: 10000 }],
      ['A', 'B', 'C'],
      { rateio: 'DIVIDIR' },
    );
    expect(r.total).toBe(10000);
  });
});

describe('defeito da peça aparece, não some', () => {
  it('parcela sem valor não vira lançamento', () => {
    const r = expandirCronograma([{ nParcela: 1, valor: null }], ['A']);
    expect(r.parcelas).toEqual([]);
    expect(r.avisos.join(' ')).toContain('sem valor');
  });

  it('data fora do padrão vira null e avisa, em vez de virar vencimento errado', () => {
    const r = expandirCronograma(
      [{ nParcela: 1, dataPrevista: '10/09/2026', valor: 100 }], ['A'],
    );
    expect(r.parcelas[0].dataPrevista).toBeNull();
    expect(r.avisos.join(' ')).toContain('não é AAAA-MM-DD');
  });

  it('valor fixado sem data sai como parcela sem vencimento, e avisa', () => {
    const r = expandirCronograma([{ nParcela: 1, valor: 100 }], ['A']);
    expect(r.parcelas[0].dataPrevista).toBeNull();
    expect(r.avisos.join(' ')).toContain('não a data de vencimento');
  });

  it('número de parcela repetido é denunciado', () => {
    const r = expandirCronograma(
      [{ nParcela: 1, dataPrevista: '2026-09-10', valor: 100 },
       { nParcela: 1, dataPrevista: '2026-10-10', valor: 100 }], ['A'],
    );
    expect(r.avisos.join(' ')).toContain('mais de uma vez');
  });

  it('sem nParcela, numera pela ordem do cronograma', () => {
    const r = expandirCronograma(
      [{ dataPrevista: '2026-09-10', valor: 100 }, { dataPrevista: '2026-10-10', valor: 100 }],
      ['A'],
    );
    expect(r.parcelas.map((p) => p.nParcela)).toEqual([1, 2]);
  });
});

describe('casarParte', () => {
  it('acha por nome parcial quando o palpite é único', () => {
    expect(casarParte('JOAO', ['JOÃO DA SILVA', 'MARIA'])).toBe('JOÃO DA SILVA');
  });

  it('devolve o nome cru quando o parcial bate em mais de uma parte', () => {
    expect(casarParte('MARIA', ['MARIA SOUZA', 'MARIA LIMA'])).toBe('MARIA');
  });
});

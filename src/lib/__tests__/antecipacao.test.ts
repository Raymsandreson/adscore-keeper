// Parcelamento e deságio. Os números conferidos na mão — se um destes quebrar,
// alguém mudou a conta que vai virar proposta ao cliente.
import { describe, it, expect } from 'vitest';
import {
  gerarParcelas, vencimentoDaParcela, antecipar, totalAntecipacao,
} from '@/lib/antecipacao';

describe('gerarParcelas', () => {
  it('dividir joga a sobra de centavo na última, e a soma fecha com o total', () => {
    const p = gerarParcelas({
      valor: 100, parcelas: 3, periodicidade: 'mensal',
      primeiraData: '2026-08-25', modo: 'dividir',
    });
    expect(p.map(x => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(p.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(100, 2);
    expect(p.map(x => x.data)).toEqual(['2026-08-25', '2026-09-25', '2026-10-25']);
    expect(p.map(x => x.n)).toEqual([1, 2, 3]);
    expect(p.every(x => x.de === 3)).toBe(true);
  });

  it('repetir mantém o valor cheio em cada parcela', () => {
    const p = gerarParcelas({
      valor: 1200, parcelas: 12, periodicidade: 'mensal',
      primeiraData: '2026-09-05', modo: 'repetir',
    });
    expect(p).toHaveLength(12);
    expect(p.every(x => x.valor === 1200)).toBe(true);
    expect(p[11].data).toBe('2027-08-05');
  });

  it('mensal respeita fim de mês — 31/01 não escorrega para 03/03', () => {
    const p = gerarParcelas({
      valor: 300, parcelas: 3, periodicidade: 'mensal',
      primeiraData: '2026-01-31', modo: 'dividir',
    });
    expect(p.map(x => x.data)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('quinzenal é a cada 15 dias, não duas vezes por mês', () => {
    expect(vencimentoDaParcela('2026-08-20', 'quinzenal', 1)).toBe('2026-09-04');
    expect(vencimentoDaParcela('2026-08-20', 'semanal', 2)).toBe('2026-09-03');
    expect(vencimentoDaParcela('2026-08-20', 'diaria', 3)).toBe('2026-08-23');
    expect(vencimentoDaParcela('2026-08-20', 'anual', 1)).toBe('2027-08-20');
  });

  it('recusa dividir valor pequeno demais em vez de gerar parcela de R$ 0,00', () => {
    expect(() => gerarParcelas({
      valor: 0.02, parcelas: 3, periodicidade: 'mensal',
      primeiraData: '2026-08-20', modo: 'dividir',
    })).toThrow(/pequeno demais/);
  });
});

describe('antecipar', () => {
  it('desconta pelo tempo que falta, em juros compostos', () => {
    // 30 dias a 3% a.m.: 10.000 / 1,03 = 9.708,74
    const um = antecipar({ valorFuturo: 10000, vencimento: '2026-09-19', taxaMes: 3, hoje: '2026-08-20' });
    expect(um.dias).toBe(30);
    expect(um.valorPresente).toBe(9708.74);
    expect(um.desconto).toBe(291.26);

    // 180 dias a 3% a.m.: 10.000 / 1,03^6 = 8.374,84 — e NÃO 8.200 (18% simples)
    const seis = antecipar({ valorFuturo: 10000, vencimento: '2027-02-16', taxaMes: 3, hoje: '2026-08-20' });
    expect(seis.dias).toBe(180);
    expect(seis.meses).toBe(6);
    expect(seis.valorPresente).toBe(8374.84);
  });

  it('o que já venceu não desconta — deságio paga tempo, não atraso', () => {
    const a = antecipar({ valorFuturo: 5000, vencimento: '2026-07-10', taxaMes: 5, hoje: '2026-08-20' });
    expect(a.dias).toBe(0);
    expect(a.valorPresente).toBe(5000);
    expect(a.desconto).toBe(0);
  });

  it('taxa zero devolve o valor de face', () => {
    const a = antecipar({ valorFuturo: 777.77, vencimento: '2027-01-01', taxaMes: 0, hoje: '2026-08-20' });
    expect(a.valorPresente).toBe(777.77);
    expect(a.desconto).toBe(0);
  });

  it('soma da carteira bate com a soma das linhas mostradas', () => {
    const itens = [
      antecipar({ valorFuturo: 1000, vencimento: '2026-09-19', taxaMes: 3, hoje: '2026-08-20' }),
      antecipar({ valorFuturo: 2000, vencimento: '2026-10-19', taxaMes: 3, hoje: '2026-08-20' }),
    ];
    const t = totalAntecipacao(itens);
    expect(t.valorFuturo).toBe(3000);
    expect(t.valorPresente).toBe(itens[0].valorPresente + itens[1].valorPresente);
    // A soma crua daria 143.94000000000005; o total arredonda para o que a tela mostra.
    expect(t.desconto).toBe(143.94);
  });
});

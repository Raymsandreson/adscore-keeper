import { describe, it, expect } from 'vitest';
import {
  ehAdiantamento,
  resumirDinheiro,
  montarLinhasDoRelacionamento,
  type LancamentoDoLead,
} from '../relacionamentoDoContato';

const lanc = (p: Partial<LancamentoDoLead>): LancamentoDoLead => ({
  entry_type: 'expense',
  category: null,
  description: null,
  amount: 0,
  entry_date: null,
  ...p,
});

describe('ehAdiantamento', () => {
  it('pega adiantamento, empréstimo e antecipação, pela categoria ou pela descrição', () => {
    expect(ehAdiantamento(lanc({ category: 'Honorários Adiantados (FIDC)' }))).toBe(true);
    expect(ehAdiantamento(lanc({ category: 'Outros', description: 'Empréstimo ao cliente' }))).toBe(true);
    expect(ehAdiantamento(lanc({ category: 'Antecipação de parcela' }))).toBe(true);
    expect(ehAdiantamento(lanc({ category: 'Custas Processuais' }))).toBe(false);
  });
});

describe('resumirDinheiro', () => {
  it('sem lançamento, não escreve linha nenhuma', () => {
    expect(resumirDinheiro([])).toBeNull();
    expect(resumirDinheiro(null)).toBeNull();
  });

  it('diz que o dinheiro adiantado é o cliente que devolve', () => {
    const r = resumirDinheiro([
      lanc({ category: 'Honorários Adiantados (FIDC)', amount: 3000, entry_date: '2026-07-12' }),
      lanc({ category: 'Honorários Adiantados (FIDC)', amount: 1500, entry_date: '2026-08-01' }),
    ]);
    expect(r).toContain('ADIANTOU');
    expect(r).toContain('4.500,00');
    expect(r).toContain('o último em 01/08/2026');
    expect(r).toMatch(/ELA deve devolver/);
    expect(r).toMatch(/nunca escreva como se o escritório fosse pagar/);
  });

  it('conta só entrada como valor recebido', () => {
    const r = resumirDinheiro([
      lanc({ entry_type: 'income', category: 'Honorários Contratuais', amount: 1200 }),
      lanc({ entry_type: 'expense', category: 'Custas Processuais', amount: 300 }),
    ]);
    expect(r).toContain('já recebeu');
    expect(r).toContain('1.200,00');
    expect(r).not.toContain('300,00');
  });

  it('ignora valor inválido em vez de somar NaN', () => {
    const r = resumirDinheiro([
      lanc({ category: 'Empréstimo', amount: null as any, entry_date: '2026-07-12' }),
      lanc({ category: 'Empréstimo', amount: 500, entry_date: '2026-07-12' }),
    ]);
    expect(r).toContain('500,00');
    expect(r).not.toContain('NaN');
  });
});

describe('montarLinhasDoRelacionamento', () => {
  it('sem dado nenhum, não inventa contexto', () => {
    expect(montarLinhasDoRelacionamento({ relacionamento: [], origem: 'desconhecido' })).toEqual([]);
  });

  it('marca como indício o que a IA leu, e não marca o que está salvo', () => {
    const daIA = montarLinhasDoRelacionamento({ relacionamento: ['Cliente'], origem: 'ia' })[0];
    expect(daIA).toMatch(/lido pela IA/);
    expect(daIA).toMatch(/trate como indício/);

    const salvo = montarLinhasDoRelacionamento({ relacionamento: ['Cliente'], origem: 'salvo' })[0];
    expect(salvo).not.toMatch(/indício/);
  });

  it('junta relacionamento, caso e dinheiro — o caso do Cláudio', () => {
    const linhas = montarLinhasDoRelacionamento({
      relacionamento: ['Cliente', 'Parceiro'],
      origem: 'salvo',
      caso: { tipoDoCaso: 'Acidente de trabalho', status: 'Em andamento', numeroDoProcesso: '0001234-55.2026.5.02.0001' },
      lancamentos: [lanc({ category: 'Honorários Adiantados (FIDC)', amount: 4500, entry_date: '2026-07-12' })],
    });
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toContain('Cliente, Parceiro');
    expect(linhas[1]).toContain('Acidente de trabalho');
    expect(linhas[1]).toContain('0001234-55.2026.5.02.0001');
    expect(linhas[2]).toContain('ADIANTOU');
  });

  it('caso sem nenhum campo preenchido não vira linha vazia', () => {
    const linhas = montarLinhasDoRelacionamento({
      relacionamento: [],
      origem: 'desconhecido',
      caso: { nome: null, status: null, tipoDoCaso: null, numeroDoProcesso: null },
    });
    expect(linhas).toEqual([]);
  });
});

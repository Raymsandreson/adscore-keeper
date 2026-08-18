// Vocabulário dos lançamentos — os casos vêm das categorias que EXISTEM em
// `jm_lancamentos` (conferidas no Externo em 18/08/2026), com as variações de
// caixa e acento que a planilha produziu ("oriz"/"Oriz", "INDENIZAÇÃO").
import { describe, it, expect } from 'vitest';
import { classificarLancamento, estagioDoLancamento } from '@/lib/lancamentoCategorias';

describe('classificarLancamento', () => {
  it('honorário a receber é recebível do escritório, não caixa', () => {
    const c = classificarLancamento({ categoria: 'Honorários a receber', pessoa: 'HC' });
    expect(c.titular).toBe('escritorio');
    expect(c.previsto).toBe(true);
    expect(c.especie).toBe('honorario_contratual');
  });

  it('honorário recebido é caixa do escritório', () => {
    const c = classificarLancamento({ categoria: 'Honorários', pessoa: 'HS' });
    expect(c.titular).toBe('escritorio');
    expect(c.previsto).toBe(false);
    expect(c.especie).toBe('honorario_sucumbencial');
  });

  it('HC/HS vem de PESSOA na planilha e da categoria no lançamento manual', () => {
    expect(classificarLancamento({ categoria: 'Honorários', pessoa: 'HC PENSIONAMENTO' }).especie)
      .toBe('honorario_contratual');
    expect(classificarLancamento({ categoria: 'Honorários Contratuais' }).especie)
      .toBe('honorario_contratual');
    expect(classificarLancamento({ categoria: 'Honorários Sucumbenciais' }).especie)
      .toBe('honorario_sucumbencial');
  });

  it('honorário com nome de parte em PESSOA continua sendo do escritório', () => {
    // 54 linhas de "Honorários a receber" trazem o nome da parte em PESSOA — a
    // planilha marca Beneficiário = Escritório nelas.
    const c = classificarLancamento({ categoria: 'Honorários a receber', pessoa: 'RENARA PEREIRA DA SILVA' });
    expect(c.titular).toBe('escritorio');
    expect(c.especie).toBe('honorario');
  });

  it('adiantado pela Oriz não é o processo pagando, em qualquer caixa', () => {
    for (const cat of ['Honorários Adiantados Oriz', 'Honorários Adiantados oriz']) {
      const c = classificarLancamento({ categoria: cat, pessoa: 'HC' });
      expect(c.especie).toBe('adiantamento_fidc');
      expect(c.adiantado).toBe(true);
      expect(c.titular).toBe('escritorio');
      // Antecipação é caixa de verdade — só não é o processo liquidando.
      expect(c.previsto).toBe(false);
    }
  });

  it('indenização é a cota do cliente, com ou sem acento/caixa', () => {
    for (const cat of ['Indenização', 'INDENIZAÇÃO']) {
      const c = classificarLancamento({ categoria: cat, pessoa: 'MARIA GOMES' });
      expect(c.titular).toBe('cliente');
      expect(c.especie).toBe('cota_cliente');
      expect(c.previsto).toBe(false);
    }
  });

  it('indenização a receber é a cota do cliente ainda por pagar', () => {
    const c = classificarLancamento({ categoria: 'Indenização a receber', pessoa: 'MARIA GOMES' });
    expect(c.titular).toBe('cliente');
    expect(c.previsto).toBe(true);
  });

  it('indenização COMPRADA passa a ser do escritório', () => {
    // A armadilha: casa com "indeniza" mas o crédito é nosso desde a compra.
    const c = classificarLancamento({ categoria: 'Indenização comprada', pessoa: 'MARIA GOMES' });
    expect(c.titular).toBe('escritorio');
    expect(c.especie).toBe('credito_comprado');
  });

  it('honorário de advogado parceiro é REPASSE: o titular é o parceiro', () => {
    // Na planilha PESSOA vem "HC ITELVINA DR LUCIANO" — tem prefixo HC, mas o
    // dinheiro é do parceiro. A categoria tem que ganhar do prefixo.
    for (const cat of ['Honorários Adv Parceiro', 'Honorários adv parceiro', 'Honorários advogado parceiro']) {
      const c = classificarLancamento({ categoria: cat, pessoa: 'HC ITELVINA DR LUCIANO' });
      expect(c.especie).toBe('honorario_parceiro');
      expect(c.titular).toBe('parceiro');
    }
  });

  it('despesa de operação é do escritório', () => {
    for (const cat of ['Custas Processuais', 'Perícia', 'FOLHA DE PAGAMENTO FIXO', 'Imposto', null]) {
      const c = classificarLancamento({ categoria: cat });
      expect(c.titular).toBe('escritorio');
      expect(c.especie).toBe('operacao');
      expect(c.previsto).toBe(false);
    }
  });

  it('repasse ao cliente lançado à mão é dinheiro do cliente', () => {
    expect(classificarLancamento({ categoria: 'Cota do Cliente' }).titular).toBe('cliente');
    expect(classificarLancamento({ categoria: 'Pagamento Cliente' }).titular).toBe('cliente');
  });

  it('honorário de condenação não é "a receber"', () => {
    // 29 linhas (R$ 4,42 mi) carregavam a data da DECISÃO dentro de
    // "Honorários a receber" e por isso apareciam vencidas há anos.
    const c = classificarLancamento({ categoria: 'Honorários condenação', pessoa: 'HC' });
    expect(c.titular).toBe('escritorio');
    expect(c.especie).toBe('honorario_condenacao');
    expect(c.previsto).toBe(false);
  });
});

describe('estagioDoLancamento', () => {
  const hoje = '2026-08-18';

  it('a receber com data futura está no prazo', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários a receber', data: '2027-01-10', hoje }))
      .toBe('A_RECEBER');
  });

  it('a receber com data passada está vencido', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários a receber', data: '2024-03-20', hoje }))
      .toBe('VENCIDO');
  });

  it('condenação nunca vence — a data dela é a da decisão', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários condenação', data: '2021-05-31', hoje }))
      .toBe('CONDENACAO');
  });

  it('sem data não inventa atraso', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários a receber', data: null, hoje }))
      .toBe('A_RECEBER');
  });

  it('o que já é caixa fica REALIZADO', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários', data: '2024-01-10', hoje })).toBe('REALIZADO');
    expect(estagioDoLancamento({ categoria: 'Indenização', data: '2024-01-10', hoje })).toBe('REALIZADO');
  });

  it('a cota do cliente também vence', () => {
    expect(estagioDoLancamento({ categoria: 'Indenização a receber', data: '2025-01-01', hoje }))
      .toBe('VENCIDO');
  });
});

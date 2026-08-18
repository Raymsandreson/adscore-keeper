// Vocabulário dos lançamentos — os casos vêm das categorias que EXISTEM em
// `jm_lancamentos` (conferidas no Externo em 18/08/2026), com as variações de
// caixa e acento que a planilha produziu ("oriz"/"Oriz", "INDENIZAÇÃO").
import { describe, it, expect } from 'vitest';
import { classificarLancamento } from '@/lib/lancamentoCategorias';

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

  it('honorário de advogado parceiro não vira contratual nem sucumbencial', () => {
    for (const cat of ['Honorários Adv Parceiro', 'Honorários adv parceiro', 'Honorários advogado parceiro']) {
      expect(classificarLancamento({ categoria: cat, pessoa: 'HC' }).especie).toBe('honorario_parceiro');
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
});

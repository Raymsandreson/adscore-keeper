// Vocabulário dos lançamentos — os casos vêm das categorias que EXISTEM em
// `jm_lancamentos` (conferidas no Externo em 18/08/2026), com as variações de
// caixa e acento que a planilha produziu ("oriz"/"Oriz", "INDENIZAÇÃO").
import { describe, it, expect } from 'vitest';
import {
  classificarLancamento, estagioDoLancamento, categoriaCanonica, naturezaDoLancamento,
  mesclarCategorias,
} from '@/lib/lancamentoCategorias';

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

  it('sem cronograma é CONDENAÇÃO e nunca vence, por mais velha que a data seja', () => {
    // 31 linhas assim: a data é a da DECISÃO ("Condenação em 2º grau"), e lê-la
    // como vencimento marcava R$ 4,72 mi como atrasado há anos.
    expect(estagioDoLancamento({
      categoria: 'Honorários a receber', data: '2021-05-31', temDataPagamento: false, hoje,
    })).toBe('CONDENACAO');
  });

  it('a mesma categoria com cronograma segue a régua da data', () => {
    // O que separa condenação de vencido é a coluna, não a categoria.
    expect(estagioDoLancamento({
      categoria: 'Honorários a receber', data: '2021-05-31', temDataPagamento: true, hoje,
    })).toBe('VENCIDO');
    // Ausente vale como true — é o padrão da coluna no banco.
    expect(estagioDoLancamento({ categoria: 'Honorários a receber', data: '2021-05-31', hoje }))
      .toBe('VENCIDO');
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

  // O lançamento manual não tem "a receber" em categoria nenhuma: quem diz se o
  // dinheiro entrou é `lead_financials.settled_at`. Sem isto, honorário com
  // vencimento futuro entrava como caixa no mesmo instante.
  it('o previsto explícito do lançamento manual manda na categoria', () => {
    expect(estagioDoLancamento({ categoria: 'Honorários Contratuais', previsto: true, data: '2026-08-25', hoje }))
      .toBe('A_RECEBER');
    expect(estagioDoLancamento({ categoria: 'Honorários Contratuais', previsto: true, data: '2026-08-10', hoje }))
      .toBe('VENCIDO');
    expect(estagioDoLancamento({ categoria: 'Honorários Contratuais', previsto: false, data: '2026-08-25', hoje }))
      .toBe('REALIZADO');
  });

  it('previsto explícito também vale contra o texto da planilha', () => {
    expect(classificarLancamento({ categoria: 'Honorários a receber', previsto: false }).previsto).toBe(false);
    expect(classificarLancamento({ categoria: 'Cota do Cliente', previsto: true }).previsto).toBe(true);
  });

  it('categoria usada uma vez entra na lista, sem duplicar grafia', () => {
    const lista = mesclarCategorias(
      ['Honorários Contratuais', 'Honorários Sucumbenciais', 'Perícia', 'Outros'],
      ['PERICIA', 'Honorários Periciais', null, '', '  ', 'honorarios periciais'],
    );
    // Contratual e sucumbencial são DUAS: `categoriaCanonica` juntaria as duas em
    // "HONORARIOS" e uma sumiria da lista sem aviso.
    expect(lista).toContain('Honorários Contratuais');
    expect(lista).toContain('Honorários Sucumbenciais');
    // As curadas continuam na frente e na grafia delas.
    expect(lista.slice(0, 4)).toEqual(['Honorários Contratuais', 'Honorários Sucumbenciais', 'Perícia', 'Outros']);
    // "PERICIA" é a mesma "Perícia": não entra de novo.
    expect(lista.filter(c => c.toUpperCase().startsWith('PER'))).toEqual(['Perícia']);
    // A nova entra uma vez só, na primeira grafia vista.
    expect(lista.filter(c => c.toLowerCase().includes('pericia'))).toEqual(['Honorários Periciais']);
    expect(lista).toHaveLength(5);
  });

  it('adiantamento do FIDC segue caixa por padrão, e cede ao previsto explícito', () => {
    const semFlag = classificarLancamento({ categoria: 'Honorários Adiantados (FIDC)' });
    expect(semFlag.adiantado).toBe(true);
    expect(semFlag.previsto).toBe(false);
    const contratado = classificarLancamento({ categoria: 'Honorários Adiantados (FIDC)', previsto: true });
    expect(contratado.adiantado).toBe(true);
    expect(contratado.previsto).toBe(true);
  });
});

// ── Organização da tabela de lançamentos (19/08/2026) ────────────────────────
// Os casos abaixo são categorias REAIS da planilha, com a grafia que elas têm
// no banco. Nada aqui é hipotético.
describe('categoria canônica', () => {
  it('as cinco grafias de folha variável viram uma só', () => {
    for (const v of ['FOLHA DE PAGAMENTO Variável', 'FOLHA DE PAGAMENTO variavel',
                     'FOLHA DE PAGAMENTO VARIÁVEL', 'FOLHA DE PAGAMENTO VARIAVEL',
                     'FOLHA DE PAGAMENTO VIARIAVEL', 'VARIAVEL', 'PESOAL VARIAVEL']) {
      expect(categoriaCanonica(v)).toBe('FOLHA DE PAGAMENTO VARIAVEL');
    }
    expect(categoriaCanonica('FOLHA DE PAGAMENTO FIXO')).toBe('FOLHA DE PAGAMENTO FIXO');
  });

  it('"Idenização" é erro de digitação, não categoria nova', () => {
    expect(categoriaCanonica('Idenização')).toBe('INDENIZACAO');
    expect(categoriaCanonica('INDENIZAÇÃO')).toBe('INDENIZACAO');
    expect(categoriaCanonica('Indenização')).toBe('INDENIZACAO');
  });

  it('a receber não se mistura com recebido', () => {
    // São estágios diferentes do MESMO lançamento — colapsar os dois apagaria a
    // diferença entre "vai entrar" e "entrou".
    expect(categoriaCanonica('Indenização a receber')).toBe('INDENIZACAO A RECEBER');
    expect(categoriaCanonica('Honorários a receber')).toBe('HONORARIOS A RECEBER');
    expect(categoriaCanonica('Honorários')).toBe('HONORARIOS');
  });

  it('as três grafias do honorário de parceiro viram uma', () => {
    for (const v of ['Honorários Adv Parceiro', 'Honorários adv parceiro',
                     'Honorários advogado parceiro']) {
      expect(categoriaCanonica(v)).toBe('HONORARIOS ADV PARCEIRO');
    }
  });

  it('"Parceria" NÃO é colapsada em honorário de parceiro', () => {
    // Pode ser rateio de sociedade em vez de repasse de honorário. São 5 linhas
    // e o dado não decide sozinho — juntar por parecer seria adivinhar.
    expect(categoriaCanonica('Parceria')).toBe('PARCERIA');
    expect(categoriaCanonica('Parceira')).toBe('PARCEIRA');
  });

  it('adiantamento do FIDC não vira "honorários"', () => {
    expect(categoriaCanonica('Honorários Adiantados oriz')).toBe('HONORARIOS ADIANTADOS FIDC');
    expect(categoriaCanonica('Honorários Adiantados Oriz')).toBe('HONORARIOS ADIANTADOS FIDC');
  });

  it('categoria vazia é dito, não escondido', () => {
    expect(categoriaCanonica(null)).toBe('SEM CATEGORIA');
    expect(categoriaCanonica('  ')).toBe('SEM CATEGORIA');
  });
});

describe('natureza do lançamento', () => {
  it('linha com processo é sempre de processo, qualquer que seja a categoria', () => {
    // Uma custa lançada num processo é do processo mesmo que a categoria diga
    // "Outros" — o vínculo vence o texto.
    expect(naturezaDoLancamento({ categoria: 'Outros', temProcesso: true })).toBe('processo');
    expect(naturezaDoLancamento({ categoria: 'Movimentação conta', temProcesso: true })).toBe('processo');
  });

  it('sem processo, a categoria decide', () => {
    expect(naturezaDoLancamento({ categoria: 'Indenização' })).toBe('processo');
    expect(naturezaDoLancamento({ categoria: 'Honorários a receber' })).toBe('processo');
    expect(naturezaDoLancamento({ categoria: 'Custas Processuais' })).toBe('processo');
  });

  it('separa a vida pessoal do custo de operar', () => {
    for (const v of ['Supermercado', 'Restaurante', 'Farra', 'Noivado', 'Uber',
                     'Roupa', 'Viagem', 'AJUDA FAMILIA', 'IPVA HILLUX 2026',
                     'saúde(plano de saúde, consultas, remédios e etc)']) {
      expect(naturezaDoLancamento({ categoria: v })).toBe('pessoal');
    }
  });

  it('folha, aluguel e imposto são o escritório funcionando', () => {
    for (const v of ['FOLHA DE PAGAMENTO FIXO', 'Aluguel', 'Imposto', 'Contador',
                     'AWS- Amazon Web services', 'Movimentação conta', 'Empréstimo Bancário']) {
      expect(naturezaDoLancamento({ categoria: v })).toBe('escritorio');
    }
  });

  it('categoria desconhecida cai no escritório, não em processo', () => {
    // Errar para o lado do escritório é seguro: infla custo, não infla carteira.
    expect(naturezaDoLancamento({ categoria: 'Bred' })).toBe('escritorio');
    expect(naturezaDoLancamento({ categoria: null })).toBe('escritorio');
  });
});

import { describe, it, expect } from 'vitest';
import { classificarEsfera, ramoFromCnj } from '../esferaJustica';

/**
 * Filtro do sino de atualizações. Os números abaixo têm a estrutura real do
 * CNJ — o que importa é o dígito J (segmento) e o TR, não o sequencial.
 */
describe('classificarEsfera', () => {
  it('separa trabalhista pelo dígito J=5 (caso do print de 11/08/2026)', () => {
    expect(classificarEsfera({ numeroCnj: '0001249-29.2026.5.08.0130' })).toBe('trabalhista');
  });

  it('Justiça Federal com matéria previdenciária vira prev. JF', () => {
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      area: 'Previdenciário',
      assuntos: ['Auxílio-doença previdenciário'],
    })).toBe('federal_prev');
  });

  it('Justiça Federal sem matéria previdenciária continua cível', () => {
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      area: 'Cível',
      assuntos: ['Sistema Financeiro da Habitação'],
    })).toBe('federal_civel');
  });

  it('estadual é justiça comum mesmo com assunto previdenciário (competência delegada)', () => {
    expect(classificarEsfera({
      numeroCnj: '0800123-45.2024.8.18.0140',
      assuntos: ['Aposentadoria por idade rural'],
    })).toBe('comum');
  });

  it('processo administrativo do INSS não é confundido com judicial', () => {
    expect(classificarEsfera({
      numeroCnj: null,
      processType: 'administrativo',
      caseType: 'BPC/LOAS',
    })).toBe('administrativo_prev');
    expect(classificarEsfera({
      numeroCnj: null,
      processType: 'administrativo',
      caseType: 'Consumidor',
    })).toBe('administrativo');
  });

  it('processo cadastrado como administrativo que já tem CNJ vale pelo ramo do número', () => {
    // Requerimento no INSS que virou ação: o número manda.
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      processType: 'administrativo',
      caseType: 'Aposentadoria',
    })).toBe('federal_prev');
  });

  // Medido no Externo em 11/08/2026: 199 dos 207 feeds da Justiça Federal
  // vinham com área, assuntos, classe E case_type vazios. Sem olhar título e
  // polo, 138 processos previdenciários caíam no balde genérico "Federal".
  it('reconhece previdenciário pelo INSS no polo passivo, sem área nem assunto', () => {
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      poloPassivo: 'INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS',
    })).toBe('federal_prev');
  });

  it('reconhece previdenciário pelo título do processo', () => {
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      titulo: 'Aposentadoria por invalidez',
    })).toBe('federal_prev');
  });

  it('BPC/LOAS entra como previdenciário mesmo escrito "Pessoa com Deficiência"', () => {
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      assuntos: ['Pessoa com Deficiência'],
    })).toBe('federal_prev');
  });

  it('federal sem nenhum sinal de matéria não é chutado como previdenciário', () => {
    // Casos reais que sobraram: título literal "Processo", MS, ação contra a Caixa.
    expect(classificarEsfera({ numeroCnj: '5001234-56.2025.4.01.3200', titulo: 'Processo' })).toBe('federal_civel');
    expect(classificarEsfera({
      numeroCnj: '5001234-56.2025.4.01.3200',
      titulo: 'PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL (436)',
      poloPassivo: 'Caixa Economica Federal Cef',
    })).toBe('federal_civel');
  });

  it('tribunais superiores, eleitoral e militar caem em outros', () => {
    expect(classificarEsfera({ numeroCnj: '0001234-56.2025.3.00.0000' })).toBe('outros');
    expect(classificarEsfera({ numeroCnj: '0001234-56.2025.6.18.0001' })).toBe('outros');
  });

  it('sem número e sem tipo administrativo, não chuta ramo', () => {
    expect(classificarEsfera({ numeroCnj: null })).toBe('outros');
    expect(classificarEsfera({ numeroCnj: 'protocolo interno 123' })).toBe('outros');
  });
});

describe('ramoFromCnj', () => {
  it('extrai o dígito J e ignora lixo', () => {
    expect(ramoFromCnj('0001249-29.2026.5.08.0130')).toBe('5');
    expect(ramoFromCnj('sem número')).toBeNull();
    expect(ramoFromCnj(null)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { extractBenefitNumber, extractTipoBeneficio } from '../inss-despacho';

// Os textos abaixo são recortes reais do corpus de despachos (09/09/2026), com
// nome e CPF trocados. Cada um representa um dos quatro formatos medidos.
describe('extractBenefitNumber', () => {
  it('lê o NB pontuado da carta de concessão (47 dos 100 deferidos)', () => {
    expect(extractBenefitNumber('NB: 189.936.277-8 Prezado(a) Senhor(a), Nome: FULANO DE TAL, CPF: 000.000.000-00 Pelas regras vigentes'))
      .toBe('1899362778');
  });

  it('lê o NB da prorrogação (24)', () => {
    expect(extractBenefitNumber('O benefício 7232761377 foi prorrogado. Data da cessação: 10/10/2026'))
      .toBe('7232761377');
  });

  it('lê o NB entre parênteses (21)', () => {
    expect(extractBenefitNumber('O requerimento solicitado foi concedido sob número de benefício (NB) 2430575919. Aguarde correspondência'))
      .toBe('2430575919');
  });

  it('lê o NB depois de "nº", como no e-mail de auxílio por incapacidade (8)', () => {
    expect(extractBenefitNumber('A perícia médica reconheceu a sua incapacidade e o AUXÍLIO POR INCAPACIDADE TEMPORÁRIA PREVIDENCIÁRIO nº 7333804209 foi concedido.'))
      .toBe('7333804209');
  });

  it('não confunde número de requerimento com NB', () => {
    expect(extractBenefitNumber('Em atenção ao requerimento nº 4773574531, informamos que foi concedido.'))
      .toBeUndefined();
  });

  it('não confunde número de processo com NB', () => {
    expect(extractBenefitNumber('Conforme o processo nº 1234567890, o pedido foi analisado.'))
      .toBeUndefined();
  });

  it('devolve undefined quando o INSS concedeu sem informar o número', () => {
    expect(extractBenefitNumber('Em atenção ao requerimento de Benefício de Prestação Continuada, o pedido foi concedido. Aguarde correspondência.'))
      .toBeUndefined();
  });

  it('devolve undefined para despacho vazio', () => {
    expect(extractBenefitNumber(undefined)).toBeUndefined();
    expect(extractBenefitNumber('')).toBeUndefined();
  });

  it('ignora número que não tem os 10 dígitos do NB', () => {
    expect(extractBenefitNumber('O benefício 12345 foi concedido.')).toBeUndefined();
  });
});

describe('extractTipoBeneficio', () => {
  // O corpo real chega achatado numa linha só: é o que gmailBodyToText devolve
  // no caminho HTML, e o que quebrava o regex antigo.
  const corpoAchatado =
    'Protocolo : 477357453 Serviço : BENEFÍCIO POR INCAPACIDADE Data do Protocolo : 05/08/2026 ' +
    'Unidade responsável : COORDENAÇÃO DE GESTÃO DAS CENTRAIS DE ANÁLISE Status atual : CONCLUÍDA';

  it('para no rótulo seguinte em vez de engolir o bloco', () => {
    expect(extractTipoBeneficio(corpoAchatado)).toBe('BENEFÍCIO POR INCAPACIDADE');
  });

  it('não deixa o texto do bloco vazar para benefit_type', () => {
    const v = extractTipoBeneficio(corpoAchatado) || '';
    expect(v).not.toContain('Data do Protocolo');
    expect(v).not.toContain('Unidade respons');
  });

  it('cai para o rótulo "Benefício:" quando não há "Serviço:"', () => {
    expect(extractTipoBeneficio('Benefício : APOSENTADORIA POR IDADE Data do Protocolo : 01/02/2026'))
      .toBe('APOSENTADORIA POR IDADE');
  });


  it('corta no rótulo do e-mail de agendamento (5 registros em 09/09/2026)', () => {
    expect(extractTipoBeneficio('Serviço : Agendamento - Perícia Médica de Auxílio-Acidente Data e hora agendada : 31/07/2026 (14:20)'))
      .toBe('Agendamento - Perícia Médica de Auxílio-Acidente');
  });

  it('devolve undefined quando não há nenhum dos dois rótulos', () => {
    expect(extractTipoBeneficio('Prezado(a) Sr(a), seu pedido foi recebido.')).toBeUndefined();
  });
});

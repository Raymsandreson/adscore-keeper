import { describe, it, expect } from 'vitest';
import {
  beneficioLegivel,
  ehSalarioMaternidade,
  fallbackMensagemCliente,
  promptMensagemCliente,
} from '../inss-mensagem-cliente';
import { chaveDoAudio, ROTEIROS } from '../inss-audio-categoria';

// Correção do usuário (08/09/2026): salário-maternidade indeferido não entra
// com ação, entra com RECURSO no próprio INSS. O resto dos benefícios segue no
// caminho da ação judicial, que é o que o áudio gravado pela equipe promete.

const DESPACHO =
  'Requerimento indeferido: não foi comprovada a qualidade de segurada na data do parto, ' +
  'conforme análise do CNIS e dos documentos apresentados.';

const JUSTICA = /Justi[çc]a|judicial|ju[íi]z/i;

describe('ehSalarioMaternidade', () => {
  it('reconhece pelo serviço, urbano e rural', () => {
    expect(ehSalarioMaternidade({ servico: 'SALÁRIO-MATERNIDADE URBANO' })).toBe(true);
    expect(ehSalarioMaternidade({ servico: 'SALÁRIO-MATERNIDADE RURAL' })).toBe(true);
  });

  it('reconhece pelo benefício quando o serviço não veio (reserva)', () => {
    expect(ehSalarioMaternidade({ servico: null, beneficio: 'Salário Maternidade' })).toBe(true);
  });

  it('não confunde com os outros benefícios', () => {
    expect(ehSalarioMaternidade({ servico: 'BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA' })).toBe(false);
    expect(ehSalarioMaternidade({ servico: 'PENSÃO POR MORTE URBANA', beneficio: '' })).toBe(false);
    expect(ehSalarioMaternidade({})).toBe(false);
  });
});

describe('texto fixo do indeferimento', () => {
  it('maternidade promete recurso no INSS e nunca a Justiça', () => {
    const texto = fallbackMensagemCliente('indeferido', {
      servico: 'SALÁRIO-MATERNIDADE URBANO',
    });
    expect(texto).toMatch(/recurso no próprio INSS/i);
    expect(texto).not.toMatch(JUSTICA);
  });

  it('os demais benefícios seguem prometendo a ação judicial', () => {
    const texto = fallbackMensagemCliente('indeferido', {
      servico: 'BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA',
    });
    expect(texto).toMatch(/ação na Justiça/i);
    expect(texto).not.toMatch(/recurso/i);
  });
});

describe('prompt do humanizador', () => {
  it('em maternidade manda falar em recurso e proíbe falar em Justiça', () => {
    const prompt = promptMensagemCliente('indeferido', {
      despacho: DESPACHO,
      servico: 'SALÁRIO-MATERNIDADE RURAL',
    })!;
    expect(prompt).toMatch(/recurso no próprio INSS/i);
    expect(prompt).toMatch(/NUNCA diga que o caso vai para a Justiça/i);
    expect(prompt).not.toMatch(/entrar com uma ação na Justiça/i);
  });

  it('nos demais benefícios o prompt não muda', () => {
    const prompt = promptMensagemCliente('indeferido', {
      despacho: DESPACHO,
      servico: 'BENEFÍCIO POR INCAPACIDADE',
    })!;
    expect(prompt).toMatch(/entrar com uma ação na Justiça/i);
    expect(prompt).not.toMatch(/NUNCA diga que o caso vai para a Justiça/i);
  });

  it('a exigência de um cliente de maternidade segue com o vocabulário de sempre', () => {
    const prompt = promptMensagemCliente('exigencia', {
      despacho: DESPACHO,
      pontosPendentes: 'Enviar certidão de nascimento da criança e documento de identidade.',
      servico: 'SALÁRIO-MATERNIDADE URBANO',
    })!;
    expect(prompt).toMatch(/entrar com uma ação na Justiça/i);
  });
});

describe('rótulo do benefício', () => {
  it('usa o serviço quando o benefit_type está vazio (441 requerimentos na base)', () => {
    expect(beneficioLegivel(null, 'SALÁRIO-MATERNIDADE URBANO')).toBe('seu pedido de salário-maternidade');
    expect(beneficioLegivel('', 'BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA')).toBe('seu pedido de BPC/LOAS');
  });

  it('o benefit_type continua mandando quando ele diz alguma coisa', () => {
    expect(beneficioLegivel('PENSÃO POR MORTE URBANA', 'SALÁRIO-MATERNIDADE URBANO'))
      .toBe('seu pedido de pensão por morte');
  });

  it('sem nenhuma das duas fontes, segue o rótulo genérico', () => {
    expect(beneficioLegivel(null, null)).toBe('seu pedido no INSS');
  });
});

describe('áudio', () => {
  it('maternidade tem chave e roteiro próprios, no mesmo caminho do catálogo', () => {
    const chave = chaveDoAudio('indeferido', 'maternidade');
    expect(chave).toBe('indeferido:maternidade');
    const roteiro = ROTEIROS[chave];
    expect(roteiro).toBeTruthy();
    expect(roteiro).toMatch(/recurso no próprio INSS/i);
    expect(roteiro).not.toMatch(JUSTICA);
  });

  it('o áudio genérico do indeferimento continua sem roteiro (é o gravado da equipe)', () => {
    expect(ROTEIROS['indeferido']).toBeUndefined();
  });
});

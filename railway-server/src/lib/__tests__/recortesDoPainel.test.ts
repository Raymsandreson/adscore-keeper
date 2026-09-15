import { describe, it, expect } from 'vitest';
import { acolhedorDoConjunto, funilDoNome, ehPrev, ehBoardDeCaptacao } from '../recortesDoPainel';

describe('acolhedorDoConjunto', () => {
  // Os 30 formatos que existem hoje em leads.adset_name (medido em 10/09/2026).
  it('lê os formatos reais de nome de conjunto', () => {
    expect(acolhedorDoConjunto('CONJUNTO 3 - ISRAEL — Cópia')).toBe('ISRAEL');
    expect(acolhedorDoConjunto('CONJUNTO 6 - MATEUS — Cópia')).toBe('MATEUS');
    expect(acolhedorDoConjunto('CONJUNTO 5 EDILAN [2]')).toBe('EDILAN');
    expect(acolhedorDoConjunto('CONJUNTO - [ISRAEL]')).toBe('ISRAEL');
    expect(acolhedorDoConjunto('LEADS - MATEUS')).toBe('MATEUS');
    expect(acolhedorDoConjunto('ISRAEL 3')).toBe('ISRAEL');
  });

  it('trata KAROL como a mesma pessoa que KAROLYNE', () => {
    // Há uma só no quadro: Maria Karolyne de Aguiar Nunes. Separá-las partiria
    // o número dela em duas linhas que ninguém saberia somar.
    expect(acolhedorDoConjunto('CONJUNTO 4 KAROL — Cópia')).toBe('KAROLYNE');
    expect(acolhedorDoConjunto('CONJUNTO - KAROLYNE')).toBe('KAROLYNE');
    expect(acolhedorDoConjunto('LEADS - KAROL')).toBe('KAROLYNE');
  });

  it('devolve null quando o nome não nomeia ninguém', () => {
    expect(acolhedorDoConjunto('CONJUNTO 1')).toBeNull();
    expect(acolhedorDoConjunto('C1')).toBeNull();
    expect(acolhedorDoConjunto('C2-[ESTAGIÁRIO]')).toBeNull();
    expect(acolhedorDoConjunto('')).toBeNull();
    expect(acolhedorDoConjunto(null)).toBeNull();
  });

  it('não casa token dentro de outra palavra', () => {
    // O erro que este teste existe para impedir: `includes('KAROL')` daria
    // KAROLYNE aqui, e o número de uma pessoa entraria no recorte de outra.
    expect(acolhedorDoConjunto('CONJUNTO - KAROLINA')).toBeNull();
    expect(acolhedorDoConjunto('CONJUNTO - ISRAELITA')).toBeNull();
  });

  it('ignora o erro da Graph API gravado no lugar do nome', () => {
    expect(
      acolhedorDoConjunto("You don't have enough permission. Please refer to this help: https://www.facebook.com/business/help/766393076839635"),
    ).toBeNull();
  });
});

describe('funilDoNome', () => {
  it('lê a campanha da Meta', () => {
    expect(funilDoNome('BPC-LOAS')).toBe('bpc');
    expect(funilDoNome('[AUXÍLIO-ACIDENTE]')).toBe('auxilio_acidente');
    expect(funilDoNome('[AUXÍLIO-ACIDENTE][SETEMBRO.26]')).toBe('auxilio_acidente');
    expect(funilDoNome('AUXÍLIO - ACIDENTE [EDILAN]')).toBe('auxilio_acidente');
  });

  it('lê o board do CRM, que tem outro nome para o mesmo funil', () => {
    expect(funilDoNome('BPC - Autismo')).toBe('bpc');
    expect(funilDoNome('Auxílio Acidente')).toBe('auxilio_acidente');
  });

  it('NÃO confunde Acidente de Trabalho com Auxílio Acidente', () => {
    // O defeito que este teste existe para impedir. Medido em 14/09/2026:
    // filtrar a aba por "Auxílio Acidente" devolvia 3.224 leads do board de
    // Acidente de Trabalho contra 544 do funil de verdade — 86% do recorte era
    // o funil errado. Trabalhista é outro negócio, com outra equipe.
    expect(funilDoNome('Acidente de Trabalho')).toBeNull();
    expect(funilDoNome('Acidentes de Trabalho: Fatais e Graves (Incapacitantes)')).toBeNull();
    expect(funilDoNome('[ANALYNE][ACD. DE TRABALHO]')).toBeNull();
    expect(funilDoNome('Funil de Acidentes de Trabalho e INSS (Vítimas e Familiares)')).toBeNull();
  });

  it('não casa campanha de outro produto que fala em acidente', () => {
    expect(funilDoNome('[SEGURO ACIDENTE DE TRÂNSITO]')).toBeNull();
    expect(funilDoNome('CAMINHONEIRO ACIDENTADO - JOÃO MANOEL')).toBeNull();
  });

  it('devolve null para funil desconhecido', () => {
    expect(funilDoNome('Trabalhista')).toBeNull();
    expect(funilDoNome('[CBO][VENDAS][MÃES-ATÍPICAS]')).toBeNull();
    expect(funilDoNome('')).toBeNull();
  });
});

describe('ehPrev', () => {
  it('separa o que a aba cobre do que ela não cobre', () => {
    expect(ehPrev('BPC - Autismo')).toBe(true);
    expect(ehPrev('Auxílio Acidente')).toBe(true);
    expect(ehPrev('Acidente de Trabalho')).toBe(false);
    expect(ehPrev('Auxílio-Maternidade Administrativo (INSS)')).toBe(false);
    expect(ehPrev('Notícias ')).toBe(false);
  });
});

describe('ehBoardDeCaptacao', () => {
  // Os nomes reais dos 27 boards do Externo, medidos em 15/09/2026.
  it('aceita o board que recebe lead', () => {
    expect(ehBoardDeCaptacao('BPC - Autismo')).toBe(true);
    expect(ehBoardDeCaptacao('Auxílio Acidente')).toBe(true);
  });

  it('recusa o POP — é o fluxo do processo, não a porta de entrada', () => {
    // 174 leads no board, ZERO com id da Meta ou origem de planilha.
    expect(ehBoardDeCaptacao('POP - BPC (Administrativo e Judicial)')).toBe(false);
    expect(ehBoardDeCaptacao('POP — Fluxo do Processo Judicial de Aposentadoria (Idade, Tempo de Contribuição e Especial)')).toBe(false);
  });

  it('recusa board desativado', () => {
    expect(ehBoardDeCaptacao('BPC JUDICIAL (desativado — unificado no POP BPC em 30/08/2026)')).toBe(false);
    expect(ehBoardDeCaptacao('Trabalhistas judicial (fases antigas — desativado)')).toBe(false);
  });

  it('não confunde POP no meio do nome com board de POP', () => {
    // O corte é pelo prefixo: "POPULAR" e citação a POP no meio não podem sair.
    expect(ehBoardDeCaptacao('BPC POPULAR')).toBe(true);
    expect(ehBoardDeCaptacao('Auxílio Acidente (migrado do POP em 2026)')).toBe(true);
  });
});

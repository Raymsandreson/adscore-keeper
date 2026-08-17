import { describe, expect, it } from 'vitest';

import {
  compararSequencia,
  dentroDaFaixa,
  descreverFaixa,
  formatCasoSequencia,
  parseCasoSequencia,
  parseEntradaFaixa,
} from '@/lib/casoSequencia';

// Todos os literais deste arquivo saíram de `legal_cases.case_number` e
// `leads.case_number` do Externo (leitura de 17/08/2026) — nada inventado.
describe('parseCasoSequencia', () => {
  it('lê as formas comuns de PREV e CASO', () => {
    expect(parseCasoSequencia('PREV 1394')).toMatchObject({ familia: 'PREV', numero: 1394 });
    expect(parseCasoSequencia('CASO 250')).toMatchObject({ familia: 'CASO', numero: 250 });
    expect(parseCasoSequencia('CASO-0474')).toMatchObject({ familia: 'CASO', numero: 474 });
    expect(parseCasoSequencia('Caso 322')).toMatchObject({ familia: 'CASO', numero: 322 });
    expect(parseCasoSequencia('SM-0009')).toMatchObject({ familia: 'SM', numero: 9 });
    expect(parseCasoSequencia('DG-0002')).toMatchObject({ familia: 'DG', numero: 2 });
  });

  it('ignora emoji e acento colados no prefixo', () => {
    expect(parseCasoSequencia('✅PREV 2027')).toMatchObject({ familia: 'PREV', numero: 2027 });
    expect(parseCasoSequencia('✅️ Prev 133')).toMatchObject({ familia: 'PREV', numero: 133 });
    expect(parseCasoSequencia('✅ PREV 2043')).toMatchObject({ familia: 'PREV', numero: 2043 });
  });

  it('trata case_number só com o número como família sem prefixo', () => {
    expect(parseCasoSequencia('248')).toMatchObject({ familia: 'NUM', numero: 248 });
    expect(parseCasoSequencia('1298')).toMatchObject({ familia: 'NUM', numero: 1298 });
  });

  it('recusa número de processo — CNJ, CNJ colado e NUP do INSS', () => {
    expect(parseCasoSequencia('0001723-93.2025.5.17.0191')).toBeNull();
    expect(parseCasoSequencia('0011351-63.2022.5.15.0031')).toBeNull();
    expect(parseCasoSequencia('00001048020255230056')).toBeNull();
    expect(parseCasoSequencia('13621.214680/2024-67')).toBeNull();
    // O prefixo não salva um CNJ: "CASO 0001723-93..." não é o caso 93.
    expect(parseCasoSequencia('CASO 0001723-93.2025.5.17.0191')).toBeNull();
  });

  it('recusa bloco longo de dígitos em vez de devolver um pedaço', () => {
    expect(parseCasoSequencia('1332519476')).toBeNull();
    expect(parseCasoSequencia('550980')).toBeNull();
  });

  it('pega o primeiro número quando o caso é desdobrado', () => {
    expect(parseCasoSequencia('CASO 17 e 17.1')).toMatchObject({ familia: 'CASO', numero: 17 });
    // Desdobramento sem prefixo, como está gravado em 8 linhas do Externo.
    expect(parseCasoSequencia('222.1')).toMatchObject({ familia: 'NUM', numero: 222 });
    expect(parseCasoSequencia('26.1')).toMatchObject({ familia: 'NUM', numero: 26 });
  });

  it('devolve null para vazio e para texto sem número', () => {
    expect(parseCasoSequencia(null)).toBeNull();
    expect(parseCasoSequencia('')).toBeNull();
    expect(parseCasoSequencia('MATERNIDADE')).toBeNull();
  });

  it('preserva o texto original para exibição', () => {
    expect(parseCasoSequencia('✅PREV 2027')?.original).toBe('✅PREV 2027');
  });
});

describe('parseEntradaFaixa', () => {
  it('aceita prefixo junto do número, com ou sem espaço', () => {
    expect(parseEntradaFaixa('PREV 1200')).toEqual({ familia: 'PREV', numero: 1200 });
    expect(parseEntradaFaixa('prev1200')).toEqual({ familia: 'PREV', numero: 1200 });
    expect(parseEntradaFaixa('Caso 300')).toEqual({ familia: 'CASO', numero: 300 });
  });

  it('aceita só o número — a família vem do seletor', () => {
    expect(parseEntradaFaixa('1200')).toEqual({ familia: null, numero: 1200 });
  });

  it('devolve null quando não há número', () => {
    expect(parseEntradaFaixa('')).toBeNull();
    expect(parseEntradaFaixa('PREV')).toBeNull();
    expect(parseEntradaFaixa(null)).toBeNull();
  });
});

describe('dentroDaFaixa', () => {
  const prev = (n: number) => parseCasoSequencia(`PREV ${n}`);

  it('inclui as pontas', () => {
    const faixa = { familia: 'PREV' as const, de: 1200, ate: 1400 };
    expect(dentroDaFaixa(prev(1200), faixa)).toBe(true);
    expect(dentroDaFaixa(prev(1400), faixa)).toBe(true);
    expect(dentroDaFaixa(prev(1199), faixa)).toBe(false);
    expect(dentroDaFaixa(prev(1401), faixa)).toBe(false);
  });

  it('não mistura famílias diferentes', () => {
    const faixa = { familia: 'PREV' as const, de: 100, ate: 500 };
    expect(dentroDaFaixa(parseCasoSequencia('CASO 250'), faixa)).toBe(false);
    expect(dentroDaFaixa(parseCasoSequencia('250'), faixa)).toBe(false);
  });

  it('com família nula compara só o número', () => {
    const faixa = { familia: null, de: 100, ate: 500 };
    expect(dentroDaFaixa(parseCasoSequencia('CASO 250'), faixa)).toBe(true);
    expect(dentroDaFaixa(parseCasoSequencia('250'), faixa)).toBe(true);
    expect(dentroDaFaixa(prev(600), faixa)).toBe(false);
  });

  it('aceita faixa aberta de um lado só', () => {
    expect(dentroDaFaixa(prev(2000), { familia: null, de: 1500, ate: null })).toBe(true);
    expect(dentroDaFaixa(prev(1000), { familia: null, de: 1500, ate: null })).toBe(false);
    expect(dentroDaFaixa(prev(1000), { familia: null, de: null, ate: 1500 })).toBe(true);
  });

  it('lê faixa invertida como intervalo, não como vazio', () => {
    expect(dentroDaFaixa(prev(1300), { familia: null, de: 1400, ate: 1200 })).toBe(true);
  });

  it('deixa de fora quem não tem sequência legível', () => {
    expect(dentroDaFaixa(null, { familia: null, de: 1, ate: 9999 })).toBe(false);
    expect(dentroDaFaixa(parseCasoSequencia('0011351-63.2022.5.15.0031'), { familia: null, de: 1, ate: 9999 }))
      .toBe(false);
  });

  it('sem faixa e sem família não filtra ninguém', () => {
    expect(dentroDaFaixa(null, { familia: null, de: null, ate: null })).toBe(true);
  });

  it('família sozinha, sem números, filtra pela família', () => {
    const faixa = { familia: 'CASO' as const, de: null, ate: null };
    expect(dentroDaFaixa(parseCasoSequencia('CASO 250'), faixa)).toBe(true);
    expect(dentroDaFaixa(prev(250), faixa)).toBe(false);
  });
});

describe('rótulos', () => {
  it('formata a sequência para a badge da linha', () => {
    expect(formatCasoSequencia(parseCasoSequencia('✅PREV 2027'))).toBe('PREV 2027');
    expect(formatCasoSequencia(parseCasoSequencia('248'))).toBe('nº 248');
    expect(formatCasoSequencia(null)).toBe('');
  });

  it('descreve a faixa para o rodapé de contagem', () => {
    expect(descreverFaixa({ familia: 'PREV', de: 1200, ate: 1400 })).toBe('de PREV 1200 até PREV 1400');
    expect(descreverFaixa({ familia: 'PREV', de: 1400, ate: 1200 })).toBe('de PREV 1200 até PREV 1400');
    expect(descreverFaixa({ familia: null, de: 100, ate: null })).toBe('de nº 100 em diante');
    expect(descreverFaixa({ familia: null, de: null, ate: 100 })).toBe('até nº 100');
  });
});

describe('compararSequencia', () => {
  it('ordena por número dentro da mesma família', () => {
    const lista = [parseCasoSequencia('PREV 99'), parseCasoSequencia('PREV 1000')];
    expect(lista.sort(compararSequencia).map((s) => s?.numero)).toEqual([99, 1000]);
  });

  it('joga quem não tem sequência para o fim', () => {
    const lista = [null, parseCasoSequencia('PREV 10')];
    expect(lista.sort(compararSequencia)[0]?.numero).toBe(10);
  });
});

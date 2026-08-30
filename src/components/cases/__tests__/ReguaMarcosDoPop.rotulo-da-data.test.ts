// A execução provisória (30/08/2026) trouxe uma estação obrigatória PENDENTE
// atrás do marco atual: o trânsito em julgado, enquanto a execução corre sem
// ele (art. 899 da CLT — recurso só com efeito devolutivo). Até então isso não
// existia, porque obrigatório atrás do atual sempre virava "presumido"; com
// `presumivel = false` no trânsito, ele passa a cair na coluna da direita.
//
// A régua escrevia "não houve" para qualquer pendente que o trem já tivesse
// passado — o que, no trânsito, daria o caso por encerrado sem trânsito nenhum.
// Medido no dia: 122 processos do POP trabalhista estão adiante do trânsito sem
// tê-lo detectado — 70 deles com execução correndo.
import { describe, expect, it } from 'vitest';
import { rotuloDaData, type MarcoDaRegua } from '@/components/cases/ReguaMarcosDoPop';

function marco(p: Partial<MarcoDaRegua> & Pick<MarcoDaRegua, 'chave'>): MarcoDaRegua {
  return {
    rotulo: p.chave,
    ordem: 1,
    estado: 'pendente',
    eventual: false,
    terminal: false,
    atravessaFases: false,
    data: null,
    fonte: null,
    temProvaDocumental: false,
    atual: false,
    ...p,
  };
}

describe('rotuloDaData', () => {
  it('trânsito pendente atrás do marco atual diz "falta", nunca "não houve"', () => {
    const transito = marco({ chave: 'transito_julgado', eventual: false, presumivel: false });
    expect(rotuloDaData(transito, true)).toBe('falta');
  });

  it('degrau eventual já ultrapassado diz "não houve"', () => {
    const recurso = marco({ chave: 'recurso_extraordinario', eventual: true });
    expect(rotuloDaData(recurso, true)).toBe('não houve');
  });

  it('degrau eventual ainda à frente diz "falta"', () => {
    const penhora = marco({ chave: 'constricao', eventual: true });
    expect(rotuloDaData(penhora, false)).toBe('falta');
  });

  it('estação com data mostra a data em pt-BR, tenha o trem passado ou não', () => {
    const sentenca = marco({ chave: 'sentenca', estado: 'atingido', data: '2026-04-22' });
    expect(rotuloDaData(sentenca, true)).toBe('22/04/2026');
    expect(rotuloDaData(sentenca, false)).toBe('22/04/2026');
  });

  it('presumido não escreve nada — não é falta nem prova', () => {
    const audiencia = marco({ chave: 'audiencia_inicial', estado: 'presumido' });
    expect(rotuloDaData(audiencia, true)).toBe('');
  });
});

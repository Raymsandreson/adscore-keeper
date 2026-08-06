import { describe, it, expect } from 'vitest';
import { chaveNome, cruzarComAtividades, type CarteiraPessoa } from '../carteiraMarcos';

const p = (nome: string, processos: number, comMarco: number): CarteiraPessoa => ({
  userId: null,
  nome,
  processos,
  processosComMarco: comMarco,
  pctComMarco: processos > 0 ? Math.round((100 * comMarco) / processos) : 0,
});

describe('chaveNome', () => {
  it('ignora acento, caixa e espaco extra — o ranking de atividades so tem o nome', () => {
    expect(chaveNome('Thaíres  Luana ')).toBe(chaveNome('THAIRES LUANA'));
    expect(chaveNome('João Vitor Coelho')).toBe('joao vitor coelho');
  });

  it('nome nulo vira string vazia em vez de estourar', () => {
    expect(chaveNome(null)).toBe('');
    expect(chaveNome(undefined)).toBe('');
  });
});

describe('cruzarComAtividades', () => {
  it('casa por nome normalizado', () => {
    const out = cruzarComAtividades([p('João Vitor Coelho', 68, 23)],
      new Map([['joao vitor coelho', 46]]));
    expect(out[0].atividades).toBe(46);
    expect(out[0].atividadesPorMarco).toBe(2); // 46 / 23
  });

  it('quem nao aparece no ranking fica com atividades null, nao zero', () => {
    // Zero diria "nao trabalhou"; null diz "nao sabemos". São coisas diferentes
    // e a tela precisa distinguir para não acusar ninguém injustamente.
    const out = cruzarComAtividades([p('Fulano', 10, 2)], new Map());
    expect(out[0].atividades).toBeNull();
    expect(out[0].atividadesPorMarco).toBeNull();
  });

  it('sem marco nenhum nao divide por zero', () => {
    const out = cruzarComAtividades([p('Ciclano', 26, 0)],
      new Map([['ciclano', 30]]));
    expect(out[0].atividades).toBe(30);
    expect(out[0].atividadesPorMarco).toBeNull();
    expect(out[0].pctComMarco).toBe(0);
  });

  it('carteira vazia nao gera NaN no percentual', () => {
    const out = cruzarComAtividades([p('Beltrano', 0, 0)], new Map());
    expect(out[0].pctComMarco).toBe(0);
    expect(Number.isNaN(out[0].pctComMarco)).toBe(false);
  });

  it('o caso real que motivou a vista: volume alto nao significa processo andando', () => {
    const out = cruzarComAtividades(
      [p('Maria Lydia Ribeiro', 148, 11), p('Thaires Luana', 13, 8)],
      new Map([['maria lydia ribeiro', 120], ['thaires luana', 40]]),
    );
    const lydia = out[0], thaires = out[1];
    expect(lydia.pctComMarco).toBe(7);
    expect(thaires.pctComMarco).toBe(62);
    // Muito mais atividade gasta por processo que efetivamente andou.
    expect(lydia.atividadesPorMarco!).toBeGreaterThan(thaires.atividadesPorMarco!);
  });
});

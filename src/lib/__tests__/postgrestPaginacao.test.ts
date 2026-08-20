import { describe, it, expect } from 'vitest';
import { buscarTudo } from '../postgrestPaginacao';

/** Fake do PostgREST: devolve a fatia pedida de um array, como o `.range()`. */
function tabela<T>(linhas: T[], espiao?: number[][]) {
  return (de: number, ate: number) => {
    espiao?.push([de, ate]);
    return Promise.resolve({ data: linhas.slice(de, ate + 1), error: null });
  };
}

describe('buscarTudo', () => {
  it('junta as páginas até vir uma incompleta', async () => {
    const linhas = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const pedidos: number[][] = [];
    const out = await buscarTudo(tabela(linhas, pedidos), 2);
    expect(out).toHaveLength(5);
    expect(out.map((l: any) => l.id)).toEqual([0, 1, 2, 3, 4]);
    expect(pedidos).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('página cheia exata pede a seguinte antes de parar', async () => {
    // Sem esta ida a mais, uma tabela com exatamente 1000 linhas passaria por
    // completa — e a linha 1001 do dia seguinte sumiria calada.
    const linhas = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const pedidos: number[][] = [];
    await buscarTudo(tabela(linhas, pedidos), 2);
    expect(pedidos).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('tabela vazia devolve lista vazia numa consulta só', async () => {
    const pedidos: number[][] = [];
    expect(await buscarTudo(tabela([], pedidos), 2)).toEqual([]);
    expect(pedidos).toHaveLength(1);
  });

  it('erro do PostgREST sobe em vez de virar lista curta', async () => {
    await expect(
      buscarTudo(() => Promise.resolve({ data: null, error: { message: 'boom' } }), 2),
    ).rejects.toEqual({ message: 'boom' });
  });
});

import { describe, it, expect } from 'vitest';
import { alternarComShift, alternarSelecaoDoPool, podarSelecao } from '../activitySelection';

describe('alternarSelecaoDoPool', () => {
  it('marca todo o pool quando nenhum está marcado', () => {
    expect([...alternarSelecaoDoPool(new Set(), ['a', 'b'])]).toEqual(['a', 'b']);
  });

  it('completa o pool quando só uma parte está marcada', () => {
    expect([...alternarSelecaoDoPool(new Set(['a']), ['a', 'b', 'c'])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('desmarca o pool quando todos já estão marcados', () => {
    expect([...alternarSelecaoDoPool(new Set(['a', 'b']), ['a', 'b'])]).toEqual([]);
  });

  it('preserva o que foi marcado fora do pool', () => {
    // O caso que motivou extrair isso: marcar todas dentro do bloco "Prazo"
    // não pode apagar o que já estava marcado no bloco "Audiência".
    const atual = new Set(['fora-1', 'fora-2']);
    expect([...alternarSelecaoDoPool(atual, ['a', 'b'])].sort()).toEqual(['a', 'b', 'fora-1', 'fora-2']);
    const tudoMarcado = new Set(['fora-1', 'a', 'b']);
    expect([...alternarSelecaoDoPool(tudoMarcado, ['a', 'b'])]).toEqual(['fora-1']);
  });

  it('pool vazio não mexe em nada', () => {
    const atual = new Set(['a']);
    expect(alternarSelecaoDoPool(atual, [])).toBe(atual);
  });
});

describe('alternarComShift', () => {
  const ordem = ['a', 'b', 'c', 'd'];

  it('sem âncora é toggle simples', () => {
    expect([...alternarComShift(new Set(), 'b', null, ordem)]).toEqual(['b']);
    expect([...alternarComShift(new Set(['b']), 'b', null, ordem)]).toEqual([]);
  });

  it('marca o intervalo entre âncora e clique, nos dois sentidos', () => {
    expect([...alternarComShift(new Set(['a']), 'c', 'a', ordem)].sort()).toEqual(['a', 'b', 'c']);
    expect([...alternarComShift(new Set(['d']), 'b', 'd', ordem)].sort()).toEqual(['b', 'c', 'd']);
  });

  it('desmarca o intervalo quando o item clicado já estava marcado', () => {
    const atual = new Set(['a', 'b', 'c', 'd']);
    expect([...alternarComShift(atual, 'c', 'a', ordem)]).toEqual(['d']);
  });

  it('âncora fora da lista visível cai no toggle simples', () => {
    // Shift+clique no painel de um bloco depois de ter clicado em outro bloco:
    // a âncora não existe nesta ordem, então não dá para inventar intervalo.
    expect([...alternarComShift(new Set(), 'b', 'de-outro-bloco', ordem)]).toEqual(['b']);
  });
});

describe('podarSelecao', () => {
  it('tira o que saiu da tela', () => {
    expect([...podarSelecao(new Set(['a', 'b']), ['a'])]).toEqual(['a']);
  });

  it('devolve o mesmo Set quando nada muda', () => {
    const atual = new Set(['a']);
    expect(podarSelecao(atual, ['a', 'b'])).toBe(atual);
  });

  it('universo vazio zera a seleção', () => {
    expect([...podarSelecao(new Set(['a']), [])]).toEqual([]);
  });
});

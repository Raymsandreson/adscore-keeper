/**
 * `fetchCities` tem de manter a MESMA identidade entre renders.
 *
 * Não é preciosismo de performance. Oito telas listam essa função nas
 * dependências de efeitos, e a mais dependente é o `TransactionCategorizer`:
 * lá o efeito com `fetchCities` nas deps é justamente o que ZERA o formulário
 * ao abrir o diálogo. Enquanto a função nascia de novo a cada render, a cadeia
 * era esta:
 *
 *   clicar na categoria -> setState -> render -> nova `fetchCities`
 *   -> deps mudaram -> efeito roda -> `setSelectedCategory('')`
 *
 * Ou seja: a escolha se apagava sozinha e o botão Salvar nunca habilitava.
 * Sem erro no console, sem linha vermelha — só uma tela que "não obedece".
 * Conferido em 14/09/2026 rodando o diálogo contra a versão anterior do hook.
 *
 * Este teste é barato e pega o dia em que alguém tirar o `useCallback`.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useBrazilianLocations } from '../useBrazilianLocations';

describe('useBrazilianLocations', () => {
  it('devolve a MESMA `fetchCities` depois de re-renderizar', () => {
    const { result, rerender } = renderHook(() => useBrazilianLocations());

    const primeira = result.current.fetchCities;
    rerender();
    rerender();

    expect(result.current.fetchCities).toBe(primeira);
  });

  it('a lista de estados também não muda de identidade', () => {
    const { result, rerender } = renderHook(() => useBrazilianLocations());

    const estados = result.current.states;
    rerender();

    // `states` já vinha de `useState`, e é o que segura o combo de UF de
    // remontar em tela nenhuma. Prende junto para não regredir pelo mesmo motivo.
    expect(result.current.states).toBe(estados);
    expect(estados.some(e => e.sigla === 'PI')).toBe(true);
  });
});

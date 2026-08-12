import { describe, it, expect } from 'vitest';
import { resolverResponsavel } from '../popResponsavel';

describe('resolverResponsavel', () => {
  it('o passo vence todos os outros níveis', () => {
    const r = resolverResponsavel({ passo: 'A', objetivo: 'B', fase: 'C', processo: 'D' });
    expect(r).toEqual({ assigneeId: 'A', origem: 'passo' });
  });

  it('sem passo, herda do objetivo', () => {
    const r = resolverResponsavel({ objetivo: 'B', fase: 'C', processo: 'D' });
    expect(r).toEqual({ assigneeId: 'B', origem: 'objetivo' });
  });

  it('sem passo e sem objetivo, herda da fase — é o caso que cobre dezenas de passos', () => {
    const r = resolverResponsavel({ fase: 'C', processo: 'D' });
    expect(r).toEqual({ assigneeId: 'C', origem: 'fase' });
  });

  it('cai no responsável do processo quando o POP não designou ninguém', () => {
    const r = resolverResponsavel({ processo: 'D' });
    expect(r).toEqual({ assigneeId: 'D', origem: 'processo' });
  });

  // O degrau do POP atende os leads sem responsável processual — 97 dos 314 que
  // apareciam no sino em 12/08/2026.
  it('sem ninguém no lead, cai no responsável de notificações do POP', () => {
    const r = resolverResponsavel({ pop: 'E' });
    expect(r).toEqual({ assigneeId: 'E', origem: 'pop' });
  });

  // Ordem que importa na prática: o dono do caso é mais específico do que o do
  // POP. Inverter faria uma pessoa só receber tudo e o dono certo, nada.
  it('o responsável do lead vence o do POP', () => {
    const r = resolverResponsavel({ processo: 'D', pop: 'E' });
    expect(r).toEqual({ assigneeId: 'D', origem: 'processo' });
  });

  it('devolve nenhum quando não há responsável em lugar algum', () => {
    expect(resolverResponsavel({})).toEqual({ assigneeId: null, origem: 'nenhum' });
  });

  // Campo vazio no formulário chega como '' e não como null — sem tratar, um
  // passo "limpo" na tela bloquearia a herança e a atividade nasceria sem dono.
  it('string vazia e espaços não bloqueiam a herança', () => {
    const r = resolverResponsavel({ passo: '', objetivo: '   ', fase: 'C' });
    expect(r).toEqual({ assigneeId: 'C', origem: 'fase' });
  });

  it('null explícito em um nível não impede o próximo', () => {
    const r = resolverResponsavel({ passo: null, objetivo: null, fase: null, processo: 'D' });
    expect(r.assigneeId).toBe('D');
  });
});

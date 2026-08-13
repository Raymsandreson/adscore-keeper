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

// ─── Responsável por CARGO (13/08/2026) ───
// O nível pode apontar um cargo do time vinculado ao POP em vez de uma pessoa;
// membroPorCargo traduz cargo → user_id (null = cargo inexistente ou empate).
import { resolverResponsavelComCargos } from '../popResponsavel';

describe('resolverResponsavelComCargos', () => {
  const time = (mapa: Record<string, string | null>) => (cargo: string) => mapa[cargo] ?? null;

  it('cargo no nível resolve pela pessoa do time', () => {
    const r = resolverResponsavelComCargos({}, { fase: 'Advogado' }, time({ Advogado: 'U1' }));
    expect(r).toEqual({ assigneeId: 'U1', origem: 'fase' });
  });

  it('pessoa explícita no nível vence o cargo do mesmo nível', () => {
    const r = resolverResponsavelComCargos({ passo: 'PESSOA' }, { passo: 'Advogado' }, time({ Advogado: 'U1' }));
    expect(r).toEqual({ assigneeId: 'PESSOA', origem: 'passo' });
  });

  it('cargo que não resolve (empate ou ninguém) desce a cascata', () => {
    const r = resolverResponsavelComCargos(
      { processo: 'D' },
      { passo: 'Advogado', fase: 'Estagiário' },
      time({ Advogado: null, Estagiário: null }),
    );
    expect(r).toEqual({ assigneeId: 'D', origem: 'processo' });
  });

  it('cargo do passo vence pessoa da fase — o nível mais específico manda', () => {
    const r = resolverResponsavelComCargos({ fase: 'PESSOA_FASE' }, { passo: 'Advogado' }, time({ Advogado: 'U1' }));
    expect(r).toEqual({ assigneeId: 'U1', origem: 'passo' });
  });

  it('sem cargo e sem pessoa em nível algum, devolve nenhum', () => {
    const r = resolverResponsavelComCargos({}, {}, time({}));
    expect(r).toEqual({ assigneeId: null, origem: 'nenhum' });
  });

  it('comporta-se igual à cascata antiga quando só há pessoas', () => {
    const r = resolverResponsavelComCargos({ objetivo: 'B', fase: 'C' }, {}, time({}));
    expect(r).toEqual({ assigneeId: 'B', origem: 'objetivo' });
  });
});

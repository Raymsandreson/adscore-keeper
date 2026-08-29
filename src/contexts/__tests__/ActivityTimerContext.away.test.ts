import { describe, it, expect } from 'vitest';
import { activityTickMode } from '../ActivityTimerContext';

/**
 * Regressão (queixa dos usuários, 28/08/2026): sair da aba pra trabalhar no
 * PJe/Word com a atividade aberta jogava TODO o tempo em ocioso a partir de
 * 5 min, e o "Sim, continuar contando" não devolvia nada — 690h de ocioso
 * contra 1.642h de ativo entre 01/08 e 28/08, com só 11,7% das entradas tendo
 * previsão (o único caminho que salvava o tempo).
 *
 * Regra nova: fora da aba conta ATIVO por 10 min; depois disso o sistema
 * pergunta e o tempo fica REATRIBUÍVEL.
 */
const MIN = 60 * 1000;
const base = {
  awayFor: null as number | null,
  idleFor: 0,
  locked: false,
  machineSuspended: false,
  withinEstimate: false,
  awaitingConfirm: false,
  reclaimArmed: false,
};

describe('activityTickMode — trabalho fora da aba x ociosidade real', () => {
  it('na aba, interagindo: conta ativo', () => {
    expect(activityTickMode(base)).toEqual({ count: 'active', ask: false, reclaimable: false });
  });

  it('fora da aba conta ATIVO dentro dos 10 min de carência', () => {
    for (const min of [0, 1, 5, 9]) {
      expect(activityTickMode({ ...base, awayFor: min * MIN, idleFor: min * MIN }).count).toBe('active');
    }
    // 8 min fora da aba já passou do IDLE_THRESHOLD de 5 min — antes virava ocioso.
    expect(activityTickMode({ ...base, awayFor: 8 * MIN, idleFor: 8 * MIN }).ask).toBe(false);
  });

  it('passados os 10 min, pergunta e o ocioso fica reatribuível', () => {
    const t = activityTickMode({ ...base, awayFor: 10 * MIN, idleFor: 10 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: true });
  });

  it('segue reatribuível enquanto a pessoa não responde (fora da aba)', () => {
    const t = activityTickMode({ ...base, awayFor: 40 * MIN, idleFor: 40 * MIN, awaitingConfirm: true });
    expect(t).toEqual({ count: 'idle', ask: false, reclaimable: true });
  });

  it('previsão declarada cobre o trabalho fora da aba além dos 10 min', () => {
    const t = activityTickMode({ ...base, awayFor: 90 * MIN, idleFor: 90 * MIN, withinEstimate: true });
    expect(t.count).toBe('active');
  });

  it('parado NA aba por 5 min é ocioso de verdade: pergunta e não volta', () => {
    const t = activityTickMode({ ...base, idleFor: 5 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: false });
    // e continua não-reatribuível enquanto a pergunta está de pé
    expect(activityTickMode({ ...base, idleFor: 30 * MIN, awaitingConfirm: true }).reclaimable).toBe(false);
  });

  it('tela bloqueada é ocioso, sem pergunta e sem volta', () => {
    expect(activityTickMode({ ...base, locked: true, awayFor: 30 * MIN }))
      .toEqual({ count: 'idle', ask: false, reclaimable: false });
  });

  it('PC suspenso é ocioso: pergunta uma vez e não devolve o tempo', () => {
    const t = activityTickMode({ ...base, machineSuspended: true, awayFor: 8 * 60 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: false });
    expect(activityTickMode({ ...base, machineSuspended: true, awaitingConfirm: true }).ask).toBe(false);
  });

  it('ocioso pós-estouro da previsão continua reatribuível dentro da aba', () => {
    const t = activityTickMode({ ...base, idleFor: 0, awaitingConfirm: true, reclaimArmed: true });
    expect(t).toEqual({ count: 'idle', ask: false, reclaimable: true });
  });
});

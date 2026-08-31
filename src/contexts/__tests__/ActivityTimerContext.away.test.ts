import { describe, it, expect } from 'vitest';
import { activityTickMode } from '../ActivityTimerContext';

/**
 * Regressão (queixa dos usuários, 28/08/2026): sair da aba pra trabalhar no
 * PJe/Word com a atividade aberta jogava TODO o tempo em ocioso a partir de
 * 5 min, e o "Sim, continuar contando" não devolvia nada — 690h de ocioso
 * contra 1.642h de ativo entre 01/08 e 28/08, com só 11,7% das entradas tendo
 * previsão (o único caminho que salvava o tempo).
 *
 * Segunda rodada (31/08/2026): a carência de 10 min não resolveu (19,8% de
 * ocioso no dia). Três causas apareceram, todas cobertas aqui:
 *   1. o detector de "PC suspenso" (salto >= 2 min entre ticks) disparava com a
 *      aba só estrangulada em segundo plano, passava POR CIMA da previsão
 *      declarada e o tempo não voltava nem confirmando — foi o que gerou o
 *      "computador ficou suspenso 6 min" com a pessoa redigindo no PJe;
 *   2. pergunta pendente congelava o cronômetro de quem estava digitando;
 *   3. estourar a previsão armava essa pergunta (102h de ocioso em 3 semanas).
 *
 * Regra atual: fora da aba conta ATIVO por 45 min; depois disso o sistema
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

  it('fora da aba conta ATIVO dentro dos 45 min de carência', () => {
    for (const min of [0, 1, 5, 9, 20, 44]) {
      expect(activityTickMode({ ...base, awayFor: min * MIN, idleFor: min * MIN }).count).toBe('active');
    }
    // 20 min fora da aba já passou do IDLE_THRESHOLD de 15 min — não pergunta.
    expect(activityTickMode({ ...base, awayFor: 20 * MIN, idleFor: 20 * MIN }).ask).toBe(false);
  });

  it('passados os 45 min, pergunta e o ocioso fica reatribuível', () => {
    const t = activityTickMode({ ...base, awayFor: 45 * MIN, idleFor: 45 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: true });
  });

  it('segue reatribuível enquanto a pessoa não responde (fora da aba)', () => {
    const t = activityTickMode({ ...base, awayFor: 90 * MIN, idleFor: 90 * MIN, awaitingConfirm: true });
    expect(t).toEqual({ count: 'idle', ask: false, reclaimable: true });
  });

  it('previsão declarada cobre o trabalho fora da aba além dos 45 min', () => {
    const t = activityTickMode({ ...base, awayFor: 90 * MIN, idleFor: 90 * MIN, withinEstimate: true });
    expect(t.count).toBe('active');
  });

  it('parado NA aba por 15 min é ocioso de verdade: pergunta e não volta', () => {
    expect(activityTickMode({ ...base, idleFor: 14 * MIN }).count).toBe('active');
    const t = activityTickMode({ ...base, idleFor: 15 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: false });
    // e continua não-reatribuível enquanto a pergunta está de pé
    expect(activityTickMode({ ...base, idleFor: 30 * MIN, awaitingConfirm: true }).reclaimable).toBe(false);
  });

  it('tela bloqueada é ocioso, sem pergunta e sem volta', () => {
    expect(activityTickMode({ ...base, locked: true, awayFor: 30 * MIN }))
      .toEqual({ count: 'idle', ask: false, reclaimable: false });
  });

  it('PC suspenso na frente do sistema, sem previsão: ocioso que não volta', () => {
    const t = activityTickMode({ ...base, machineSuspended: true });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: false });
    expect(activityTickMode({ ...base, machineSuspended: true, awaitingConfirm: true }).ask).toBe(false);
  });

  /**
   * O caso do print de 31/08/2026: "computador ficou suspenso 6 min" enquanto a
   * pessoa redigia fora do sistema, com os minutos já declarados na atividade.
   * O tempo tem que ser devolvível — antes era ocioso morto.
   */
  it('suspensão com previsão em andamento devolve o tempo ao confirmar', () => {
    const t = activityTickMode({ ...base, machineSuspended: true, withinEstimate: true });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: true });
  });

  it('suspensão com o app fora de foco devolve o tempo ao confirmar', () => {
    const t = activityTickMode({ ...base, machineSuspended: true, awayFor: 8 * 60 * MIN });
    expect(t).toEqual({ count: 'idle', ask: true, reclaimable: true });
  });

  /**
   * A pergunta classifica o tempo; não para o cronômetro de quem está ali.
   * Sem isto, estourar a previsão zerava a produtividade de quem seguia
   * digitando até alguém clicar no diálogo.
   */
  it('pergunta pendente NÃO congela quem está mexendo na aba', () => {
    const t = activityTickMode({ ...base, idleFor: 0, awaitingConfirm: true, reclaimArmed: true });
    expect(t).toEqual({ count: 'active', ask: false, reclaimable: false });
    expect(activityTickMode({ ...base, idleFor: 3 * MIN, awaitingConfirm: true }).count).toBe('active');
  });

  it('pergunta pendente com a pessoa parada segue ocioso reatribuível pós-estouro', () => {
    const t = activityTickMode({ ...base, idleFor: 20 * MIN, awaitingConfirm: true, reclaimArmed: true });
    expect(t).toEqual({ count: 'idle', ask: false, reclaimable: true });
  });
});

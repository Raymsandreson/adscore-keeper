import { describe, it, expect } from 'vitest';
import { ordenarPorUrgencia, type RiscoDaInstancia } from '../useRiscoDeBanimento';

/**
 * Casos montados com os números reais das instâncias que perdemos em 2026,
 * medidos na véspera de cada queda (backtest em produção):
 *   Karolyne 90 e Israel 62 no corte de 10/08 — Israel morreu 11h depois
 *   Mateus 77 no corte de 10/09 — morreu 11h depois
 * Se um dia a ordenação parar de colocar essas na frente, o painel vira
 * enfeite: a pessoa abre e vê a instância saudável primeiro.
 */
function inst(p: Partial<RiscoDaInstancia>): RiscoDaInstancia {
  return {
    instance_name: 'x', owner_name: null, enviadas_7d: 0, recebidas_7d: 0,
    razao_env_rec: null, conversas_7d: 0, iniciadas_por_nos: 0, frias_sem_resposta: 0,
    pct_fria_sem_resposta: null, novos_hoje: 0, novos_pico_7d: 0, gap_mediano_seg: null,
    gap_minimo_seg: null, abordagens_em_rajada: 0, primeiras_msgs: 0, textos_distintos: 0,
    pct_texto_repetido: null, ultima_msg: null, horas_sem_atividade: null, inativa: false,
    score: 0, classificacao: 'OK', motivos: [], calculado_em: '2026-09-15T00:00:00Z',
    ...p,
  };
}

describe('ordenarPorUrgencia', () => {
  it('põe a provavelmente banida antes da crítica, e a crítica antes da saudável', () => {
    const lista = ordenarPorUrgencia([
      inst({ instance_name: 'Raym', classificacao: 'OK', score: 18 }),
      inst({ instance_name: 'Mateus Atendimento', classificacao: 'PROVAVELMENTE BANIDA', score: 77 }),
      inst({ instance_name: 'Andressa SDR', classificacao: 'ATENÇÃO', score: 24 }),
      inst({ instance_name: 'Karolyne Atendimento', classificacao: 'CRÍTICO', score: 90 }),
    ]);
    expect(lista.map((i) => i.instance_name)).toEqual([
      'Mateus Atendimento', 'Karolyne Atendimento', 'Andressa SDR', 'Raym',
    ]);
  });

  it('dentro da mesma classificação, maior score primeiro', () => {
    const lista = ordenarPorUrgencia([
      inst({ instance_name: 'Israel', classificacao: 'CRÍTICO', score: 62 }),
      inst({ instance_name: 'Karolyne', classificacao: 'CRÍTICO', score: 90 }),
      inst({ instance_name: 'Luiz', classificacao: 'CRÍTICO', score: 47 }),
    ]);
    expect(lista.map((i) => i.score)).toEqual([90, 62, 47]);
  });

  it('não altera a lista recebida', () => {
    const original = [
      inst({ instance_name: 'a', classificacao: 'OK', score: 1 }),
      inst({ instance_name: 'b', classificacao: 'CRÍTICO', score: 90 }),
    ];
    ordenarPorUrgencia(original);
    expect(original.map((i) => i.instance_name)).toEqual(['a', 'b']);
  });

  it('classificação desconhecida vai para o fim em vez de quebrar a ordem', () => {
    const lista = ordenarPorUrgencia([
      inst({ instance_name: 'estranha', classificacao: 'ALGO NOVO' as never, score: 99 }),
      inst({ instance_name: 'ok', classificacao: 'OK', score: 0 }),
    ]);
    expect(lista[0].instance_name).toBe('ok');
  });
});

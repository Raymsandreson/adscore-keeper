// A regra de ausência só serve se ela souber a diferença entre "conferi e não
// há" e "não consegui conferir". O `getTimeOffConflicts` do web devolve `[]`
// nos dois casos, e é por isso que, quando a consulta cai, a pessoa fica com a
// impressão de que o prazo foi conferido. Estes testes prendem a distinção, que
// é o que o `ausencia_nao_verificada` da resposta carrega.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** O que a consulta vai devolver — cada teste ajusta antes de chamar. */
let resposta: { data?: unknown; error?: unknown } = { data: [], error: null };
let explode = false;
const chamadas: { metodo: string; args: unknown[] }[] = [];

vi.mock('../supabase', () => {
  const query: any = new Proxy({}, {
    get(_alvo, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') {
        return (resolve: any, reject: any) => {
          if (explode) return Promise.reject(new Error('rede caiu')).then(resolve, reject);
          return Promise.resolve(resposta).then(resolve, reject);
        };
      }
      return (...args: unknown[]) => { chamadas.push({ metodo: prop, args }); return query; };
    },
  });
  return { supabase: { from: (t: string) => { chamadas.push({ metodo: 'from', args: [t] }); return query; } } };
});

import { consultarAusencias, descreverAusencia, dataBr } from '../ausencias';

beforeEach(() => {
  resposta = { data: [], error: null };
  explode = false;
  chamadas.length = 0;
});

const FERIAS = {
  user_id: 'c1', user_name: 'Fulana', type: 'ferias',
  start_date: '2026-09-20', end_date: '2026-09-30',
};

describe('descreverAusencia', () => {
  it('escreve o período igual ao web, com o ano', () => {
    expect(descreverAusencia(FERIAS)).toBe('Férias de 20/09/2026 a 30/09/2026');
  });

  it('diz "em" quando começa e termina no mesmo dia', () => {
    expect(descreverAusencia({ ...FERIAS, type: 'folga', start_date: '2026-09-20', end_date: '2026-09-20' }))
      .toBe('Folga em 20/09/2026');
  });

  it('não inventa rótulo para tipo que não conhece', () => {
    expect(descreverAusencia({ ...FERIAS, type: 'licenca' })).toContain('licenca');
  });

  it('dataBr devolve a entrada quando ela não é uma data', () => {
    expect(dataBr('')).toBe('');
    expect(dataBr('amanhã')).toBe('amanhã');
  });
});

describe('consultarAusencias', () => {
  it('devolve o conflito com a frase pronta e os campos estruturados', async () => {
    resposta = { data: [FERIAS], error: null };
    const r = await consultarAusencias(['c1'], '2026-09-25');
    expect(r.verificado).toBe(true);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({
      user_id: 'c1', user_name: 'Fulana', type: 'ferias',
      start_date: '2026-09-20', end_date: '2026-09-30',
      descricao: 'Férias de 20/09/2026 a 30/09/2026',
    });
  });

  it('sem conflito é VERIFICADO — e é isso que separa do caso de falha', async () => {
    resposta = { data: [], error: null };
    const r = await consultarAusencias(['c1'], '2026-09-25');
    expect(r).toEqual({ conflitos: [], verificado: true });
  });

  it('erro do banco NÃO vira "não há ausência": vira não verificado', async () => {
    resposta = { data: null, error: { message: 'permission denied' } };
    const r = await consultarAusencias(['c1'], '2026-09-25');
    expect(r.conflitos).toEqual([]);
    expect(r.verificado).toBe(false);
  });

  it('exceção de rede também cai como não verificado, e não propaga', async () => {
    explode = true;
    const r = await consultarAusencias(['c1'], '2026-09-25');
    expect(r).toEqual({ conflitos: [], verificado: false });
  });

  it('sem prazo não consulta nada, e isso É uma resposta conferida', async () => {
    const r = await consultarAusencias(['c1'], null);
    expect(r).toEqual({ conflitos: [], verificado: true });
    expect(chamadas).toHaveLength(0);
  });

  it('sem responsável também não consulta', async () => {
    const r = await consultarAusencias([null, undefined], '2026-09-25');
    expect(r).toEqual({ conflitos: [], verificado: true });
    expect(chamadas).toHaveLength(0);
  });

  it('aceita datetime e usa só a parte da data, como o web', async () => {
    await consultarAusencias(['c1'], '2026-09-25T14:30:00Z');
    const lte = chamadas.find((c) => c.metodo === 'lte');
    expect(lte?.args).toEqual(['start_date', '2026-09-25']);
  });

  it('não repete id na consulta', async () => {
    await consultarAusencias(['c1', 'c1', 'c2'], '2026-09-25');
    const dentro = chamadas.find((c) => c.metodo === 'in');
    expect(dentro?.args[1]).toEqual(['c1', 'c2']);
  });

  it('pergunta na member_time_off, que é onde a aba de Férias grava', async () => {
    await consultarAusencias(['c1'], '2026-09-25');
    expect(chamadas[0]).toEqual({ metodo: 'from', args: ['member_time_off'] });
  });
});

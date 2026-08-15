/**
 * Conferência do processo — as três regras que o número da carteira depende:
 *
 *  1. VALOR = última decisão de cada cliente. A anterior aparece como
 *     descartada e NÃO entra na soma (somar as duas infla o processo).
 *  2. MARCO ATUAL = maior ordem entre os que são FASE. Acordo e suspensão são
 *     estado (atravessam fases) e não podem virar a fase atual; marco que não
 *     existe mais no POP também fica fora, porque a RPC usa inner join.
 *  3. CNJ cadastrado duas vezes = alerta alto — a carteira agrupa por cadastro,
 *     então o valor entra em dobro no total do POP.
 *
 * Os dados abaixo têm a forma real das tabelas do Externo (jm_decisoes,
 * jm_valores, jm_pagamentos, process_pop_marcos, pop_marcos, lead_processes).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const BOARD = 'board-1';
const PROC = 'proc-1';
const CNJ = '0000491-34.2020.5.05.0101';

const { dbMock } = vi.hoisted(() => {
  const dados: Record<string, unknown[]> = {
    jm_decisoes: [
      { dec_id: 'd-sentenca', processo_cnj: '0000491-34.2020.5.05.0101', data_decisao: '2023-03-10', tipo_evento: 'Sentença', instancia: '1º grau', abrangencia: null, rotulo_original: null, titulo: null, orgao: '1ª VT', relator: null, link: null, flag_revisar: null },
      { dec_id: 'd-acordao', processo_cnj: '0000491-34.2020.5.05.0101', data_decisao: '2024-08-01', tipo_evento: 'Acórdão', instancia: '2º grau', abrangencia: null, rotulo_original: null, titulo: null, orgao: 'TRT5', relator: null, link: null, flag_revisar: null },
    ],
    jm_valores: [
      { id: 1, dec_id: 'd-sentenca', processo_cnj: '0000491-34.2020.5.05.0101', cliente: 'MARIA', dano_moral: 50000, dano_estetico: 0, base_calculo: null, flag_correcao: null },
      { id: 2, dec_id: 'd-acordao', processo_cnj: '0000491-34.2020.5.05.0101', cliente: 'MARIA', dano_moral: 80000, dano_estetico: 20000, base_calculo: null, flag_correcao: null },
    ],
    jm_pagamentos: [
      { id: 9, cliente: 'MARIA', n_parcela: 1, data_prevista: '2025-01-10', data_recebida: null, status: 'previsto', forma: null, valor_pago: null, valor_previsto: 30000 },
    ],
    process_pop_marcos: [
      { board_id: 'board-1', marco_chave: 'ajuizamento', rotulo: 'Ajuizamento', ordem: 1, data_detectada: '2020-05-02', fonte: 'movimento', tem_prova_documental: true },
      { board_id: 'board-1', marco_chave: 'sentenca', rotulo: 'Sentença', ordem: 20, data_detectada: '2023-03-10', fonte: 'movimento', tem_prova_documental: true },
      // Estado: maior ordem de todas, mas não pode virar a fase atual.
      { board_id: 'board-1', marco_chave: 'suspensao', rotulo: 'Suspensão', ordem: 27, data_detectada: '2024-02-01', fonte: 'movimento', tem_prova_documental: false },
      // Marco de outro POP: a RPC filtra por board_id.
      { board_id: 'outro-board', marco_chave: 'alvara', rotulo: 'Alvará', ordem: 30, data_detectada: '2025-01-01', fonte: 'movimento', tem_prova_documental: false },
      // Marco que não existe mais neste POP: inner join derruba.
      { board_id: 'board-1', marco_chave: 'fase_extinta', rotulo: 'Fase extinta', ordem: 25, data_detectada: '2024-06-01', fonte: 'movimento', tem_prova_documental: false },
    ],
    pop_marcos: [
      { chave: 'ajuizamento', rotulo: 'Ajuizamento', ordem: 1, atravessa_fases: false, estagio_financeiro_sugerido: 'PROJETADO' },
      { chave: 'sentenca', rotulo: 'Sentença', ordem: 20, atravessa_fases: false, estagio_financeiro_sugerido: 'CONDENACAO' },
      { chave: 'suspensao', rotulo: 'Suspensão', ordem: 27, atravessa_fases: true, estagio_financeiro_sugerido: null },
    ],
    lead_processes: [
      { id: 'proc-1', title: 'Indenização', process_number: '0000491-34.2020.5.05.0101', workflow_id: 'board-1', created_at: '2024-01-01', deleted_at: null },
      { id: 'proc-2', title: 'ACIDENTE DE TRABALHO', process_number: '0000491-34.2020.5.05.0101', workflow_id: 'board-1', created_at: '2024-02-01', deleted_at: null },
      // Apagado: a RPC ignora, a conferência também.
      { id: 'proc-3', title: 'lixo', process_number: '0000491-34.2020.5.05.0101', workflow_id: 'board-1', created_at: '2024-03-01', deleted_at: '2024-04-01' },
    ],
  };

  const makeQuery = (table: string) => {
    const result = { data: dados[table] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(result);
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return q;
  };

  return { dbMock: { from: (t: string) => makeQuery(t) } };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock,
  authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
}));

import { useConferenciaProcesso } from '../useConferenciaProcesso';

const alvo = { processId: PROC, boardId: BOARD, cnj: CNJ, titulo: 'Indenização' };

describe('useConferenciaProcesso', () => {
  it('usa a última decisão do cliente e mostra a anterior como descartada', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.clientes).toHaveLength(1);
    const maria = result.current.clientes[0];
    // Acórdão de 2024 (80k + 20k) vence a sentença de 2023 (50k).
    expect(maria.valor).toBe(100000);
    expect(maria.decisaoUsada?.dec_id).toBe('d-acordao');
    expect(maria.descartadas).toHaveLength(1);
    expect(maria.descartadas[0].valor).toBe(50000);

    // O total da conferência é a última decisão, não a soma das duas.
    expect(result.current.totalConferido).toBe(100000);
    expect(result.current.somaIngenua).toBe(150000);
  });

  it('escolhe o marco de fase mais adiantado, ignorando estado e marco fora do POP', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Suspensão (27) e "fase extinta" (25) têm ordem maior que Sentença (20).
    expect(result.current.marcoAtual?.chave).toBe('sentenca');
    expect(result.current.suspenso).toBe(true);
    expect(result.current.temAcordo).toBe(false);

    // Marco de outro POP não entra na trilha.
    expect(result.current.marcos.some(m => m.chave === 'alvara')).toBe(false);
    expect(result.current.marcos.find(m => m.chave === 'fase_extinta')?.semCadastroNoPop).toBe(true);
  });

  it('acusa o CNJ cadastrado duas vezes como alerta alto', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Duas linhas vivas; a apagada fica de fora.
    expect(result.current.duplicatas).toHaveLength(2);
    const dup = result.current.alertas.find(a => a.titulo.includes('cadastrado'));
    expect(dup?.nivel).toBe('alto');
  });

  it('não conta parcela prevista como caixa e mantém o estágio da carteira', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Só data_recebida é caixa — a parcela prevista de 30k não entra.
    expect(result.current.totalPago).toBe(0);
    // Sem pago e sem acordo, vale o estágio sugerido pelo marco atual.
    expect(result.current.clientes[0].estagio).toBe('CONDENACAO');
  });
});

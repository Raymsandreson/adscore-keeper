/**
 * Alertas de DETECÇÃO da conferência — nascidos do caso 81.1 ALADIA
 * (0024387-89.2021.5.24.0086, 27/08/2026):
 *
 *  1. DATAS FORA DE ORDEM: a régua tinha "Remetido ao TST" (ordem menor)
 *     detectado em 21/05 e "Acórdão do TST" (ordem maior) em 19/05. A régua
 *     está certa; a detecção trocou os marcos — e a tela precisa acusar.
 *  2. TRÂNSITO SEM PROVA DOCUMENTAL: a certidão de trânsito veio só do texto
 *     do Escavador e era parcial — no mesmo dia a classe virou Recurso
 *     Ordinário e os autos foram conclusos para julgamento. Trânsito por texto
 *     sem peça anexada é fase suspeita, não fase certa.
 *
 * Estado (suspensão) NÃO entra na conta de inversão: atravessa fases e pode
 * ter qualquer data.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const BOARD = 'board-alr';
const PROC = 'proc-alr';
const CNJ = '0024387-89.2021.5.24.0086';

const { dbMock } = vi.hoisted(() => {
  const dados: Record<string, unknown[]> = {
    jm_decisoes: [],
    jm_valores: [],
    jm_pagamentos: [],
    process_pop_marcos: [
      { board_id: 'board-alr', marco_chave: 'sentenca', rotulo: 'Sentença', ordem: 7, data_detectada: '2025-06-09', fonte: 'documento', tem_prova_documental: true },
      { board_id: 'board-alr', marco_chave: 'remessa_superior', rotulo: 'Remetido ao TST', ordem: 14, data_detectada: '2026-05-21', fonte: 'escavador_grau', tem_prova_documental: false },
      { board_id: 'board-alr', marco_chave: 'decisao_superior', rotulo: 'Acórdão do TST', ordem: 15, data_detectada: '2026-05-19', fonte: 'movimento', tem_prova_documental: false },
      { board_id: 'board-alr', marco_chave: 'transito_julgado', rotulo: 'Trânsito em julgado', ordem: 20, data_detectada: '2026-06-17', fonte: 'escavador_texto', tem_prova_documental: false },
      // Estado com data antiga: atravessa fases, não pode virar inversão.
      { board_id: 'board-alr', marco_chave: 'suspensao', rotulo: 'Suspensão', ordem: 29, data_detectada: '2022-11-17', fonte: 'movimento', tem_prova_documental: false },
    ],
    pop_marcos: [
      { chave: 'sentenca', rotulo: 'Sentença', ordem: 7, atravessa_fases: false, estagio_financeiro_sugerido: 'CONDENACAO' },
      { chave: 'remessa_superior', rotulo: 'Remetido ao TST', ordem: 14, atravessa_fases: false, estagio_financeiro_sugerido: null },
      { chave: 'decisao_superior', rotulo: 'Acórdão do TST', ordem: 15, atravessa_fases: false, estagio_financeiro_sugerido: 'CONDENACAO' },
      { chave: 'transito_julgado', rotulo: 'Trânsito em julgado', ordem: 20, atravessa_fases: false, estagio_financeiro_sugerido: 'CONDENACAO' },
      { chave: 'suspensao', rotulo: 'Suspensão', ordem: 29, atravessa_fases: true, estagio_financeiro_sugerido: null },
    ],
    lead_processes: [
      { id: 'proc-alr', title: 'INDENIZAÇÃO', process_number: '0024387-89.2021.5.24.0086', workflow_id: 'board-alr', created_at: '2024-01-01', deleted_at: null, lead_id: 'lead-alr' },
    ],
    leads: [{ id: 'lead-alr', lead_name: 'ALADIA' }],
    jm_indices: [],
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

const alvo = { processId: PROC, boardId: BOARD, cnj: CNJ, titulo: 'INDENIZAÇÃO' };

describe('useConferenciaProcesso — alertas de detecção', () => {
  it('acusa datas que contradizem a ordem da régua', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const alerta = result.current.alertas.find(a => a.titulo.includes('contradizem a ordem'));
    expect(alerta?.nivel).toBe('atencao');
    // A inversão nomeada é a do TST: remessa (menor) detectada DEPOIS da decisão.
    expect(alerta?.detalhe).toContain('Remetido ao TST');
    expect(alerta?.detalhe).toContain('Acórdão do TST');
  });

  it('desconfia de trânsito em julgado sem prova documental', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // O trânsito segue sendo o marco atual (maior ordem entre as fases)…
    expect(result.current.marcoAtual?.chave).toBe('transito_julgado');
    // …mas a tela avisa que a certidão pode ser parcial.
    const alerta = result.current.alertas.find(a => a.titulo.includes('sem prova documental'));
    expect(alerta?.nivel).toBe('atencao');
  });

  it('não trata estado (suspensão) com data antiga como inversão', async () => {
    const { result } = renderHook(() => useConferenciaProcesso(alvo));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const alerta = result.current.alertas.find(a => a.titulo.includes('contradizem a ordem'));
    // Suspensão (ordem 29, data 2022) está "fora de ordem" contra todo mundo —
    // mas é estado, então não pode aparecer no alerta.
    expect(alerta?.detalhe ?? '').not.toContain('Suspensão');
  });
});

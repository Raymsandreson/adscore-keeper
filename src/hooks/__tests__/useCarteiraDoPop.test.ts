/**
 * Carteira do POP depois da dedup por CNJ (15/08/2026).
 *
 * O que estas provas seguram:
 *  1. O valor é POR PARTE. O processo mostra a soma, e `partes` guarda a
 *     abertura — é o que a tela abre quando se clica no valor.
 *  2. A RPC já devolve uma ficha canônica por CNJ; o hook expõe
 *     `cadastros_do_cnj` para a tela avisar que a ficha está repetida, sem
 *     recontar o dinheiro.
 *  3. O CUSTO percorre `leads_do_cnj`, não `lead_id`. Ficha irmã pode ser de
 *     outro lead (medido: 6 dos 17 grupos duplicados) — perder esse lead
 *     subestimaria o CAC e faria a rentabilidade mentir para cima.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { dbMock, authMock } = vi.hoisted(() => {
  // Um CNJ com 2 partes e 2 fichas (leads diferentes), outro com 1 parte.
  const linhas = [
    {
      process_id: 'p1', lead_id: 'lead-A', process_number: '0000491-34.2020.5.05.0101',
      cnj_num: '00004913420205050101', titulo: 'Indenização', cliente: 'ANTONIA',
      valor_condenacao: 75202.69, valor_pago: 0,
      marco_chave: 'arquivamento', marco_rotulo: 'Arquivamento definitivo', marco_ordem: 25,
      marco_em: '2023-01-01', dias_no_marco: 1160, ajuizamento_em: '2020-05-02', idade_dias: 1900,
      tem_acordo: false, suspenso: false, estagio_financeiro: 'CONDENACAO',
      decidido: true, sucesso: true, tem_leitura: true, custo_lead: 100,
      cadastros_do_cnj: 2, leads_do_cnj: ['lead-A', 'lead-B'],
      lead_nome: 'ANTONIA COQUEIRO', leads_nomes: ['ANTONIA COQUEIRO', 'VALDEZIR RODRIGUES'],
    },
    {
      process_id: 'p1', lead_id: 'lead-A', process_number: '0000491-34.2020.5.05.0101',
      cnj_num: '00004913420205050101', titulo: 'Indenização', cliente: 'VALDEZIR',
      valor_condenacao: 75202.69, valor_pago: 0,
      marco_chave: 'arquivamento', marco_rotulo: 'Arquivamento definitivo', marco_ordem: 25,
      marco_em: '2023-01-01', dias_no_marco: 1160, ajuizamento_em: '2020-05-02', idade_dias: 1900,
      tem_acordo: false, suspenso: false, estagio_financeiro: 'CONDENACAO',
      decidido: true, sucesso: true, tem_leitura: true, custo_lead: 100,
      cadastros_do_cnj: 2, leads_do_cnj: ['lead-A', 'lead-B'],
      lead_nome: 'ANTONIA COQUEIRO', leads_nomes: ['ANTONIA COQUEIRO', 'VALDEZIR RODRIGUES'],
    },
    {
      process_id: 'p2', lead_id: 'lead-C', process_number: '0001240-82.2020.5.06.0211',
      cnj_num: '00012408220205060211', titulo: 'INDENIZAÇÃO', cliente: 'JOSE',
      valor_condenacao: 30000, valor_pago: 0,
      marco_chave: 'arquivamento', marco_rotulo: 'Arquivamento definitivo', marco_ordem: 25,
      marco_em: '2024-01-01', dias_no_marco: 688, ajuizamento_em: '2020-06-01', idade_dias: 1800,
      tem_acordo: false, suspenso: false, estagio_financeiro: 'CONDENACAO',
      decidido: true, sucesso: true, tem_leitura: true, custo_lead: 50,
      cadastros_do_cnj: 1, leads_do_cnj: ['lead-C'],
      lead_nome: 'JOSE DA SILVA', leads_nomes: ['JOSE DA SILVA'],
    },
  ];

  // CAC vivo no Cloud: os três leads têm custo, inclusive o lead irmão.
  const leads = [
    { id: 'lead-A', cac: 100, ad_spend_at_conversion: null },
    { id: 'lead-B', cac: 250, ad_spend_at_conversion: null },
    { id: 'lead-C', cac: 50, ad_spend_at_conversion: null },
  ];

  return {
    dbMock: { rpc: () => Promise.resolve({ data: linhas, error: null }) },
    authMock: {
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = (_c: string, ids: string[]) =>
          Promise.resolve({ data: leads.filter(l => ids.includes(l.id)), error: null });
        return q;
      },
    },
  };
});

vi.mock('@/integrations/supabase', () => ({
  db: dbMock,
  authClient: authMock,
  ensureExternalSession: () => Promise.resolve(),
}));

import { useCarteiraDoPop } from '../useCarteiraDoPop';

describe('useCarteiraDoPop', () => {
  it('soma o valor das partes e guarda a abertura de cada uma', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const grupo = result.current.grupos[0];
    const proc = grupo.processos.find(p => p.processId === 'p1')!;

    // O processo vale a soma das duas partes, não o valor de uma delas.
    expect(proc.valor).toBeCloseTo(150405.38, 2);
    expect(proc.clientes).toBe(2);
    expect(proc.partes).toHaveLength(2);
    expect(proc.partes.map(x => x.cliente).sort()).toEqual(['ANTONIA', 'VALDEZIR']);
    expect(proc.partes[0].valor).toBeCloseTo(75202.69, 2);

    // 3 partes no POP inteiro, em 2 processos.
    expect(result.current.totais.processos).toBe(2);
    expect(result.current.totais.partes).toBe(3);
    expect(result.current.totais.valor).toBeCloseTo(180405.38, 2);
  });

  it('marca o CNJ com ficha repetida sem recontar o dinheiro', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const proc = result.current.grupos[0].processos.find(p => p.processId === 'p1')!;
    expect(proc.cadastros).toBe(2);
    // De quem é o processo, e o aviso de que a ficha irmã é de OUTRO caso.
    expect(proc.leadNome).toBe('ANTONIA COQUEIRO');
    expect(proc.leadsNomes).toHaveLength(2);
    expect(result.current.totais.cnjsComFichaRepetida).toBe(1);
    // A ficha repetida não aparece como processo separado — a RPC já deduplicou.
    expect(result.current.grupos[0].processos).toHaveLength(2);
  });

  it('conta o CAC do lead irmão, que a ficha canônica não carrega', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // lead-B só existe em leads_do_cnj; ignorá-lo daria 150 e inflaria o retorno.
    expect(result.current.totais.leadsTotal).toBe(3);
    expect(result.current.totais.leadsComCusto).toBe(3);
    expect(result.current.totais.custo).toBe(400);
  });
});

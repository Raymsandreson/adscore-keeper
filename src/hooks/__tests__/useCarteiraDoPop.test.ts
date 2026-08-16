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
      jcm_indice: 'SELIC_SIMPLES_JT', jcm_termo_inicial: '2020-01-15',
      jcm_termo_estimado: false, jcm_coeficiente: 1.6161, jcm_referencia: '2026-08-01',
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
      jcm_indice: 'SELIC_SIMPLES_JT', jcm_termo_inicial: '2020-01-15',
      jcm_termo_estimado: false, jcm_coeficiente: 1.6161, jcm_referencia: '2026-08-01',
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
      // TCM ainda é manual: safra atrasada em relação à SELIC do Bacen.
      jcm_indice: 'TCM_ESTADUAL', jcm_termo_inicial: '2021-03-01',
      jcm_termo_estimado: false, jcm_coeficiente: 1.1, jcm_referencia: '2026-07-01',
    },
  ];

  // CAC vivo no Cloud: os três leads têm custo, inclusive o lead irmão.
  const leads = [
    { id: 'lead-A', cac: 100, ad_spend_at_conversion: null },
    { id: 'lead-B', cac: 250, ad_spend_at_conversion: null },
    { id: 'lead-C', cac: 50, ad_spend_at_conversion: null },
  ];

  // Onde cada processo corre: p1 tem cidade/UF cadastradas, p2 não tem nada —
  // é a proporção real da base (85 de 475 processos com UF em 16/08/2026).
  const processos = [
    {
      id: 'p1', estado_origem: 'BAHIA', estado_origem_sigla: 'BA',
      unidade_origem_cidade: 'Ererê', tribunal: 'TRT5', tribunal_sigla: 'TRT5',
      orgao_julgador: '1ª Vara do Trabalho',
    },
    {
      id: 'p2', estado_origem: null, estado_origem_sigla: null,
      unidade_origem_cidade: null, tribunal: null, tribunal_sigla: null,
      orgao_julgador: null,
    },
  ];

  return {
    dbMock: {
      rpc: () => Promise.resolve({ data: linhas, error: null }),
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = (_c: string, ids: string[]) =>
          Promise.resolve({ data: processos.filter(p => ids.includes(p.id)), error: null });
        return q;
      },
    },
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

  it('corrige cada parte pelo coeficiente do ramo e mantém o nominal ao lado', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const proc = result.current.grupos[0].processos.find(p => p.processId === 'p1')!;
    // 75.202,69 x 1,6161 por parte, duas partes.
    expect(proc.valor).toBeCloseTo(150405.38, 2);
    expect(proc.valorAtualizado).toBeCloseTo(150405.38 * 1.6161, 2);
    expect(proc.partes[0].coeficiente).toBe(1.6161);
    expect(proc.partes[0].corrigido).toBe(true);

    // O nominal NÃO muda: o corrigido anda ao lado.
    expect(result.current.totais.valor).toBeCloseTo(180405.38, 2);
    expect(result.current.totais.valorAtualizado)
      .toBeCloseTo(150405.38 * 1.6161 + 30000 * 1.1, 2);
    expect(result.current.totais.partesSemCorrecao).toBe(0);
  });

  it('reporta a MENOR data de correção quando os índices estão em safras diferentes', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // SELIC já em ago (vem do Bacen todo dia), TCM parada em jul (ainda manual).
    // Dizer "até ago" prometeria atualização que as partes estaduais não tiveram.
    expect(result.current.totais.corrigidoAte).toBe('2026-07-01');
    expect(result.current.totais.referenciasPorIndice).toEqual({
      SELIC_SIMPLES_JT: '2026-08-01',
      TCM_ESTADUAL: '2026-07-01',
    });
  });

  it('monta o texto de busca com caso, CNJ, partes, título e cidade/UF', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const p1 = result.current.grupos[0].processos.find(p => p.processId === 'p1')!;
    expect(p1.local).toEqual({
      uf: 'BA', cidade: 'Ererê', tribunal: 'TRT5', orgao: '1ª Vara do Trabalho',
    });
    // Nome do lead, parte, título e cidade — tudo sem acento e em minúscula.
    for (const termo of ['antonia coqueiro', 'valdezir', 'indenizacao', 'erere', 'ba', 'trt5']) {
      expect(p1.busca).toContain(termo);
    }
    // CNJ com e sem pontuação: a pessoa digita dos dois jeitos.
    expect(p1.busca).toContain('0000491-34.2020.5.05.0101');
    expect(p1.busca).toContain('00004913420205050101');

    // Processo sem localidade cadastrada não quebra nem inventa lugar.
    const p2 = result.current.grupos[0].processos.find(p => p.processId === 'p2')!;
    expect(p2.local).toEqual({ uf: null, cidade: null, tribunal: null, orgao: null });
    expect(p2.busca).toContain('jose da silva');
  });

  it('recorta a carteira pela busca — totais, marcos e linhas do mesmo recorte', async () => {
    // "erere" só existe em p1 (cidade de lead_processes). O dinheiro do topo
    // tem que virar o de p1, senão a tela mostra total que não é o da lista.
    const { result } = renderHook(() => useCarteiraDoPop('board-1', { busca: 'erere' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.totais.processos).toBe(1));

    expect(result.current.totais.valor).toBeCloseTo(150405.38, 2);
    expect(result.current.totais.partes).toBe(2);
    expect(result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p1']);
    expect(result.current.grupos[0].valor).toBeCloseTo(150405.38, 2);
    // A carteira inteira continua disponível ao lado, para a tela dizer "1 de 2".
    expect(result.current.totaisCarteira.processos).toBe(2);
    expect(result.current.totaisCarteira.valor).toBeCloseTo(180405.38, 2);
  });

  it('busca sem resultado zera os totais em vez de mostrar a carteira inteira', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1', { busca: 'nao existe esse termo' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.grupos).toHaveLength(0);
    expect(result.current.totais.processos).toBe(0);
    expect(result.current.totais.valor).toBe(0);
    expect(result.current.totaisCarteira.processos).toBe(2);
  });

  it('filtra por janela de protocolo e combina com a busca', async () => {
    // p1 protocolado em 02/05/2020, p2 em 01/06/2020.
    const so_p1 = renderHook(() =>
      useCarteiraDoPop('board-1', { protocoloDe: '2020-01-01', protocoloAte: '2020-05-31' }));
    await waitFor(() => expect(so_p1.result.current.loading).toBe(false));
    await waitFor(() => expect(so_p1.result.current.totais.processos).toBe(1));
    expect(so_p1.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p1']);
    expect(so_p1.result.current.totais.valor).toBeCloseTo(150405.38, 2);

    // Janela que pega os dois, mas a busca ainda recorta para p2.
    const combinado = renderHook(() =>
      useCarteiraDoPop('board-1', { busca: 'jose', protocoloDe: '2020-01-01' }));
    await waitFor(() => expect(combinado.result.current.loading).toBe(false));
    await waitFor(() => expect(combinado.result.current.totais.processos).toBe(1));
    expect(combinado.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p2']);

    // Os anos ofertados no "por ano" saem dos processos, não de lista fixa.
    expect(so_p1.result.current.anosDeProtocolo).toEqual([2020]);
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

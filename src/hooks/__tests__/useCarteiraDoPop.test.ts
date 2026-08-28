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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { dbMock, authMock, linhaBase } = vi.hoisted(() => {
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

  // Datas por marco (process_pop_marcos): p1 transitou e foi arquivado, p2 só
  // tem sentença. É o que permite filtrar por "data de trânsito em julgado".
  const marcos = [
    { process_id: 'p1', marco_chave: 'ajuizamento', rotulo: 'Ajuizamento', ordem: 2, data_detectada: '2020-05-02' },
    { process_id: 'p1', marco_chave: 'sentenca', rotulo: 'Sentença', ordem: 7, data_detectada: '2022-08-10' },
    { process_id: 'p1', marco_chave: 'transito_julgado', rotulo: 'Trânsito em julgado', ordem: 18, data_detectada: '2023-02-15' },
    { process_id: 'p1', marco_chave: 'arquivamento_definitivo', rotulo: 'Arquivamento definitivo', ordem: 25, data_detectada: '2023-06-01' },
    { process_id: 'p2', marco_chave: 'ajuizamento', rotulo: 'Ajuizamento', ordem: 2, data_detectada: '2020-06-01' },
    { process_id: 'p2', marco_chave: 'sentenca', rotulo: 'Sentença', ordem: 7, data_detectada: '2024-01-20' },
  ];

  // Honorário lançado na planilha (`jm_lancamentos`, categoria Honorários).
  // Os quatro destinos possíveis estão aqui de propósito: dois lançamentos no
  // CNJ de p1 (que tem DUAS partes — o dinheiro não pode contar duas vezes),
  // um em p2, um em CNJ que não está nesta carteira e um sem CNJ nenhum.
  const lancamentos = [
    { processo_cnj: '0000491-34.2020.5.05.0101', valor_caixa: 10000, data: '2025-03-10' },
    { processo_cnj: '0000491-34.2020.5.05.0101', valor_caixa: 5000, data: '2026-06-30' },
    { processo_cnj: '0001240-82.2020.5.06.0211', valor_caixa: 2000, data: '2024-11-05' },
    { processo_cnj: '0009999-99.2019.5.10.0001', valor_caixa: 7000, data: '2026-07-01' },
    { processo_cnj: null, valor_caixa: 3000, data: '2023-02-02' },
  ];

  return {
    /** Molde de linha da RPC — o teste de paginação clona isto 2.500 vezes. */
    linhaBase: linhas[0],
    dbMock: {
      // A RPC tambem passa pelo teto de 1.000 do PostgREST, entao o hook a
      // pagina. O mock devolve tudo na primeira pagina: com menos de 1.000
      // linhas o laco para na primeira volta.
      // `_rest` existe para o mock QUEBRAR do mesmo jeito que o supabase-js
      // quebra quando alguém faz `const rpc = db.rpc` e perde o `this`:
      // "Cannot read properties of undefined (reading 'rest')". Sem isto o
      // teste passa com o hook derrubando a carteira em produção — foi o que
      // aconteceu em 27/08/2026.
      _rest: true,
      rpc(this: { _rest: boolean } | undefined) {
        if (!this?._rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
        return {
          range: (de: number, ate: number) =>
            Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }),
        };
      },
      /** Devolve a rpc ao padrão — o teste de paginação a substitui. */
      _rpcPadrao(this: { _rest: boolean } | undefined) {
        if (!this?._rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
        return {
          range: (de: number, ate: number) =>
            Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }),
        };
      },
      from: (tabela: string) => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.not = () => q;
        q.or = () => q;
        q.lte = () => q;
        // Uma página só: o hook para quando o lote vem com menos de 1000.
        q.range = () => Promise.resolve({
          data: tabela === 'jm_lancamentos' ? lancamentos : marcos, error: null,
        });
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
  // O teste de paginação troca a rpc do mock; devolver o padrão evita que a
  // ordem dos testes vire dependência escondida.
  afterEach(() => { dbMock.rpc = dbMock._rpcPadrao; });

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
      useCarteiraDoPop('board-1', { de: '2020-01-01', ate: '2020-05-31' }));
    await waitFor(() => expect(so_p1.result.current.loading).toBe(false));
    await waitFor(() => expect(so_p1.result.current.totais.processos).toBe(1));
    expect(so_p1.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p1']);
    expect(so_p1.result.current.totais.valor).toBeCloseTo(150405.38, 2);

    // Janela que pega os dois, mas a busca ainda recorta para p2.
    const combinado = renderHook(() =>
      useCarteiraDoPop('board-1', { busca: 'jose', de: '2020-01-01' }));
    await waitFor(() => expect(combinado.result.current.loading).toBe(false));
    await waitFor(() => expect(combinado.result.current.totais.processos).toBe(1));
    expect(combinado.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p2']);

    // Os anos ofertados no "por ano" saem dos processos, não de lista fixa.
    expect(so_p1.result.current.anosDisponiveis).toEqual([2020]);
  });

  it('filtra por QUALQUER data do processo, não só pelo protocolo', async () => {
    // p1 transitou em 15/02/2023; p2 nem transitou. Filtrar por trânsito em
    // julgado em 2023 tem que deixar só p1 — e o dinheiro segue junto.
    const porTransito = renderHook(() => useCarteiraDoPop('board-1', {
      campoData: 'transito_julgado', de: '2023-01-01', ate: '2023-12-31',
    }));
    await waitFor(() => expect(porTransito.result.current.loading).toBe(false));
    await waitFor(() => expect(porTransito.result.current.totais.processos).toBe(1));
    expect(porTransito.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p1']);
    // p2 não tem a data escolhida: some do recorte, mas a tela sabe dizer quantos.
    expect(porTransito.result.current.semADataEscolhida).toBe(1);

    // Mesma janela, outro campo: sentença em 2024 é só p2.
    const porSentenca = renderHook(() => useCarteiraDoPop('board-1', {
      campoData: 'sentenca', de: '2024-01-01', ate: '2024-12-31',
    }));
    await waitFor(() => expect(porSentenca.result.current.loading).toBe(false));
    await waitFor(() => expect(porSentenca.result.current.totais.processos).toBe(1));
    expect(porSentenca.result.current.grupos[0].processos.map(p => p.processId)).toEqual(['p2']);

    // O catálogo de datas sai dos marcos do POP, na ordem da régua.
    expect(porTransito.result.current.camposDeData.map(c => c.chave)).toEqual([
      'ajuizamento', 'sentenca', 'transito_julgado', 'arquivamento_definitivo',
    ]);
    expect(porTransito.result.current.camposDeData.find(c => c.chave === 'sentenca')?.processos).toBe(2);
  });

  it('conta o CAC do lead irmão, que a ficha canônica não carrega', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // lead-B só existe em leads_do_cnj; ignorá-lo daria 150 e inflaria o retorno.
    expect(result.current.totais.leadsTotal).toBe(3);
    expect(result.current.totais.leadsComCusto).toBe(3);
    expect(result.current.totais.custo).toBe(400);
  });

  it('soma o honorário da planilha UMA VEZ por CNJ, não por parte', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.totais.honorarioRecebido).toBeGreaterThan(0));

    // p1 (10.000 + 5.000) + p2 (2.000). p1 tem DUAS partes: contar por linha
    // daria 32.000 e inventaria R$ 15 mil de honorário que não existe.
    expect(result.current.totais.honorarioRecebido).toBe(17000);
    expect(result.current.totais.honorarioLancamentos).toBe(3);
    expect(result.current.totais.honorarioCnjs).toBe(2);
    expect(result.current.totais.honorarioUltimo).toBe('2026-06-30');

    // O que a planilha tem e a carteira NÃO enxerga fica visível, não sumido:
    // é exatamente o buraco que fazia o painel parecer errado.
    expect(result.current.honorarios.total).toBe(27000);
    expect(result.current.honorarios.foraDaCarteira).toBe(7000);
    expect(result.current.honorarios.cnjsForaDaCarteira).toBe(1);
    expect(result.current.honorarios.semCnj).toBe(3000);
    expect(result.current.honorarios.ultimo).toBe('2026-07-01');
  });

  it('o honorário segue o recorte da busca, como o resto do dinheiro', async () => {
    const { result } = renderHook(() => useCarteiraDoPop('board-1', { busca: 'JOSE' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.totais.processos).toBe(1));

    // Só p2 na mesa: o honorário do topo é o de p2, não o da carteira inteira.
    expect(result.current.totais.honorarioRecebido).toBe(2000);
    expect(result.current.totais.honorarioCnjs).toBe(1);
    // A carteira inteira continua ao lado, para a tela dizer "N de 2".
    expect(result.current.totaisCarteira.honorarioRecebido).toBe(17000);
  });

  // ── REGRESSAO: a RPC tem que ser PAGINADA (27/08/2026)
  //
  //    A chamada nascera sem `.range()`. O PostgREST corta em 1.000 linhas e
  //    `pop_carteira_marcos` devolve 1.660 no POP Trabalhistas judicial: a
  //    carteira mostrava R$ 76.407.190,83 em vez de R$ 92.141.736,81, 433
  //    processos em vez de 1.050, e o estagio PROJETADO inteiro (23 partes,
  //    R$ 5.549.368,42) simplesmente nao existia na tela. Nenhum erro, nenhum
  //    aviso — so um numero menor.
  it('pagina a RPC ate a ultima linha, em vez de parar na milesima', async () => {
    // 2.500 linhas de R$ 1.000: uma carteira de R$ 2,5 mi que o teto cortaria
    // em R$ 1 mi. Cada uma e um processo/parte propria, para nada deduplicar.
    const muitas = Array.from({ length: 2500 }, (_, i) => ({
      ...linhaBase,
      process_id: `big-${i}`,
      process_number: `000${String(i).padStart(4, '0')}-00.2020.5.05.0101`,
      cnj_num: `0000000000020205050${String(i).padStart(3, '0')}`.slice(0, 20),
      cliente: `CLIENTE ${i}`,
      valor_condenacao: 1000,
      cadastros_do_cnj: 1,
      leads_do_cnj: [`lead-${i}`],
      custo_lead: null,
    }));
    const paginas: Array<[number, number]> = [];
    dbMock.rpc = function (this: { _rest: boolean } | undefined) {
      if (!this?._rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      return {
        range: (de: number, ate: number) => {
          paginas.push([de, ate]);
          return Promise.resolve({ data: muitas.slice(de, ate + 1), error: null });
        },
      };
    };

    const { result } = renderHook(() => useCarteiraDoPop('board-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.totais.valor).toBe(2_500_000);
    expect(result.current.totais.processos).toBe(2500);
    // Tres voltas: 0-999, 1000-1999, 2000-2999 (esta volta menor encerra o laco).
    expect(paginas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});

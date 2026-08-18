// =============================================================================
// Carteira do POP — a régua de marcos com o dinheiro, o tempo e o custo em cima.
//
// Fonte: RPC `pop_carteira_marcos(board_id)` no Externo, uma linha por
// (CNJ × parte) — granularidade do vocabulário FIDC. Este hook agrega:
//   - por MARCO: processos, valor por estágio financeiro, tempo médio no marco;
//   - TOTAIS: valor por estágio e da carteira, média de dias no marco, idade
//     média, índice de sucesso, custo (CAC dos leads) e rentabilidade.
//
// DEDUP POR CNJ (15/08/2026): a RPC passou a devolver UMA ficha canônica por
// CNJ. Antes ela percorria cadastros, e CNJ cadastrado duas vezes tinha o valor
// somado duas vezes — R$ 876.013,45 inflados no POP trabalhista. Junto vieram
// `cadastros_do_cnj` (quantas fichas existem, para a tela avisar) e
// `leads_do_cnj` (TODOS os leads do CNJ).
//
// CUSTO: o snapshot de leads do Externo está com cac zerado (14/08/2026), então
// o hook busca o valor vivo no CLOUD (authClient, casa nativa dos leads) e usa
// o do Externo como fallback. Falha no Cloud não derruba a carteira.
// O custo percorre `leads_do_cnj`, não `lead_id`: em 6 dos 17 grupos duplicados
// as fichas irmãs pertencem a leads DIFERENTES (litisconsorte que entrou como
// lead próprio). Usar só o lead da ficha canônica perderia o CAC desses 6 e
// faria a rentabilidade mentir para cima.
//
// BUSCA (16/08/2026): passar `busca` recorta a carteira inteira — grupos,
// linhas e TOTAIS saem do mesmo recorte, então o dinheiro do topo é sempre o
// dinheiro do que está listado. `totaisCarteira` fica ao lado com a carteira
// inteira, para a tela dizer "N de 475 processos" sem refazer a conta.
//
// AVISO QUE A TELA REPETE: valor é "quanto o processo vale" (última decisão por
// cliente), não caixa do escritório — cota do cliente e honorário ainda não são
// separados. Rentabilidade aqui compara custo de aquisição com esse valor e com
// o PAGO realizado; leia com essa régua.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import { estagioDoLancamento } from '@/lib/lancamentoCategorias';

export interface CarteiraPopLinha {
  process_id: string;
  lead_id: string | null;
  process_number: string | null;
  cnj_num: string;
  titulo: string | null;
  cliente: string | null;
  valor_condenacao: number | null;
  valor_pago: number | null;
  marco_chave: string | null;
  marco_rotulo: string | null;
  marco_ordem: number | null;
  marco_em: string | null;
  dias_no_marco: number | null;
  ajuizamento_em: string | null;
  idade_dias: number | null;
  tem_acordo: boolean;
  suspenso: boolean;
  estagio_financeiro: string;
  decidido: boolean;
  sucesso: boolean;
  /** Existe leitura de decisão na jurimetria (jm_decisoes) para este CNJ. */
  tem_leitura: boolean;
  custo_lead: number | null;
  /** Quantas fichas de `lead_processes` existem para este CNJ neste POP. */
  cadastros_do_cnj: number | null;
  /** Todos os leads do CNJ — o custo soma por aqui, não por `lead_id`. */
  leads_do_cnj: string[] | null;
  /** Nome do lead da ficha canônica — de quem é o processo. */
  lead_nome: string | null;
  /** Nomes de TODOS os leads do CNJ (ficha irmã pode ser de outro caso). */
  leads_nomes: string[] | null;
  /** Índice de correção do ramo: SELIC_SIMPLES_JT (trabalhista) ou TCM_ESTADUAL. */
  jcm_indice: string | null;
  /** Data de início de juros e correção da decisão que vale. */
  jcm_termo_inicial: string | null;
  /** Sem `termo_inicial_jcm` na decisão: caiu na data da decisão. */
  jcm_termo_estimado: boolean | null;
  /** Multiplicador da competência do termo até `jcm_referencia`. */
  jcm_coeficiente: number | null;
  /** Até quando a tabela de índices corrige — a tela mostra essa data. */
  jcm_referencia: string | null;
}

/** Honorário do escritório que ENTROU no caixa, por CNJ. Vem da planilha
 *  importada (`jm_lancamentos`), não da carteira — é a fatia do escritório,
 *  enquanto o valor da carteira é o processo inteiro. Nunca some os dois. */
export interface HonorarioDoCnj {
  valor: number;
  lancamentos: number;
  /** Data do lançamento mais recente deste CNJ. */
  ultimo: string | null;
}

/**
 * Honorário que a planilha diz que AINDA VAI entrar, por CNJ. Três réguas que
 * não se somam (skill whatsjud-fluxo-vocabulario):
 *   aVencer     valor e data certos, no prazo — é o descontável
 *   vencido     a data passou e não foi baixado: risco de crédito OU baixa não
 *               feita na planilha; a tela não finge saber qual dos dois
 *   condenacao  juiz fixou, sem data de pagamento. Nunca na coluna do a vencer:
 *               junto, o "a receber" do POP trabalhista inflava ~10x
 */
export interface HonorarioAReceberDoCnj {
  aVencer: number;
  vencido: number;
  condenacao: number;
  linhasAVencer: number;
  linhasVencidas: number;
  /** Data da parcela vencida mais antiga — a régua de quão velho é o buraco. */
  vencidoMaisAntigo: string | null;
}

/** O caixa de honorário que a planilha registra e quanto dele esta carteira
 *  consegue enxergar — o resto é buraco de cadastro, e a tela diz qual. */
export interface HonorariosDaPlanilha {
  /** Tudo que a planilha tem em `Honorários` até hoje. */
  total: number;
  lancamentos: number;
  /** Lançamento sem CNJ nenhum: não tem processo onde cair. */
  semCnj: number;
  /** Honorário em CNJ que existe na planilha mas não nesta carteira. */
  foraDaCarteira: number;
  cnjsForaDaCarteira: number;
  /** Lançamento mais recente da planilha — a régua de quão velho está o import. */
  ultimo: string | null;
}

/** Onde o processo corre. Vem de `lead_processes`, não da RPC — e vem vazio na
 *  maioria: medido em 16/08/2026 no POP trabalhista, 85 de 475 processos têm UF
 *  e 73 têm cidade. Por isso a busca da tela varre também o nome do lead, que na
 *  prática carrega a cidade ("Caso 88 - Mauro- Ererê/CE"). */
export interface LocalDoProcesso {
  uf: string | null;
  cidade: string | null;
  tribunal: string | null;
  orgao: string | null;
}

/** Sem acento e em minúscula: buscar "ererê" tem que achar "Ererê" e "EREREE". */
export const normalizarBusca = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Uma parte do processo com o valor dela — litisconsórcio tem um valor por pessoa. */
export interface ParteDoProcesso {
  cliente: string;
  /** Valor NOMINAL, como saiu da decisão. É o que a carteira soma. */
  valor: number;
  /** valor × coeficiente. Igual ao nominal quando não há índice para o ramo. */
  valorAtualizado: number;
  /** false = ramo sem índice carregado; o "atualizado" é só o nominal repetido. */
  corrigido: boolean;
  indice: string | null;
  termoInicial: string | null;
  /** Termo veio da data da decisão, não de `termo_inicial_jcm`. */
  termoEstimado: boolean;
  coeficiente: number | null;
  pago: number;
  estagio: string;
}

export interface ProcessoDoMarco {
  processId: string;
  cnj: string;
  titulo: string | null;
  clientes: number;
  valor: number;
  pago: number;
  diasNoMarco: number | null;
  estagio: string;
  temAcordo: boolean;
  suspenso: boolean;
  /** O valor do processo é a SOMA das partes — aqui está a abertura. */
  partes: ParteDoProcesso[];
  /** > 1 = o CNJ tem ficha repetida neste POP (a dedup já protegeu o total). */
  cadastros: number;
  /** De quem é o processo: o lead (caso) da ficha canônica. */
  leadNome: string | null;
  /** Todos os leads do CNJ — com ficha repetida, pode ser mais de um caso. */
  leadsNomes: string[];
  /** Soma das partes com juros e correção. Anda AO LADO do nominal, não no lugar. */
  valorAtualizado: number;
  /** Alguma parte ficou sem índice — o "atualizado" está subestimado. */
  temParteSemCorrecao: boolean;
  /** Data do protocolo (ajuizamento/distribuição), ISO. Nem todo processo tem. */
  ajuizamentoEm: string | null;
  /** Quando entrou no marco em que está hoje, ISO. */
  marcoEm: string | null;
  /** Data de cada marco já batido: { transito_julgado: '2025-03-02', … }. */
  datas: Record<string, string>;
  /** Cidade/UF/tribunal do processo. Quase sempre vazio (ver LocalDoProcesso). */
  local: LocalDoProcesso;
  /** Tudo que a busca da tela varre, já normalizado — montado uma vez aqui para
   *  o filtro não reprocessar 475 processos a cada tecla digitada. */
  busca: string;
}

export interface GrupoMarco {
  ordem: number;
  chave: string;
  rotulo: string;
  processos: ProcessoDoMarco[];
  valor: number;
  /** Soma nominal com juros e correção — ao lado do nominal, não no lugar. */
  valorAtualizado: number;
  pago: number;
  diasMedio: number | null;
  porEstagio: Record<string, number>;
}

/** Ordem da régua financeira (decrescente de certeza do caixa, do vocabulário). */
export const ESTAGIO_ORDEM = [
  'PROJETADO', 'CONDENACAO', 'A_RECEBER', 'VENCIDO', 'EM_EXECUCAO', 'DEPOSITADO_EM_JUIZO', 'PAGO', 'INDEFERIDO',
];

/** Uma data que dá para filtrar: cada marco do POP tem a sua. */
export interface CampoDeData {
  /** Chave do marco, ou MARCO_ATUAL. */
  chave: string;
  rotulo: string;
  ordem: number;
  /** Quantos processos do POP têm essa data — a tela mostra, para ninguém
   *  escolher um campo que só existe em 3 processos sem perceber. */
  processos: number;
}

/** Não é marco: é a data em que o processo entrou no marco em que está hoje. */
export const MARCO_ATUAL = 'marco_atual';

export interface FiltroCarteira {
  /** Caso/lead, parte, título, CNJ (com ou sem pontuação), cidade/UF/tribunal.
   *  Cada termo separado por espaço tem que bater. */
  busca?: string;
  /** Qual data a janela recorta: chave de marco (`transito_julgado`,
   *  `acordo_homologado`, `sentenca`…) ou `MARCO_ATUAL`. */
  campoData?: string;
  /** A partir desta data, ISO. */
  de?: string | null;
  /** Até esta data, ISO (inclusive). */
  ate?: string | null;
}

/** Filtra a carteira. Filtro vazio = carteira inteira. */
export function useCarteiraDoPop(boardId: string | null, filtro: FiltroCarteira = {}) {
  // Desestruturado para as deps dos memos serem PRIMITIVAS: o objeto de filtro
  // é recriado a cada render da tela e invalidaria tudo a cada tecla.
  const { busca = '', campoData = 'ajuizamento', de = null, ate = null } = filtro;
  const [linhas, setLinhas] = useState<CarteiraPopLinha[]>([]);
  const [custoCloud, setCustoCloud] = useState<Record<string, number>>({});
  /** cnj_num -> honorário recebido, da planilha. Fora da RPC de propósito. */
  const [honorariosPorCnj, setHonorariosPorCnj] = useState<Record<string, HonorarioDoCnj>>({});
  const [aReceberPorCnj, setAReceberPorCnj] = useState<Record<string, HonorarioAReceberDoCnj>>({});
  const [honorarios, setHonorarios] = useState<HonorariosDaPlanilha>({
    total: 0, lancamentos: 0, semCnj: 0, foraDaCarteira: 0, cnjsForaDaCarteira: 0, ultimo: null,
  });
  const [locais, setLocais] = useState<Record<string, LocalDoProcesso>>({});
  /** process_id -> { marco_chave -> data }. Uma data por marco, de process_pop_marcos. */
  const [datasPorProcesso, setDatasPorProcesso] = useState<Record<string, Record<string, string>>>({});
  const [camposDeData, setCamposDeData] = useState<CampoDeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!boardId) { setLinhas([]); return; }
    setLoading(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const { data, error } = await (db.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => PromiseLike<{ data?: CarteiraPopLinha[] | null; error?: { message?: string } | null }>)(
        'pop_carteira_marcos', { p_board_id: boardId },
      );
      if (error) throw new Error(error.message || 'pop_carteira_marcos falhou');
      const rows = data || [];
      setLinhas(rows);

      // CAC vivo no Cloud, em lotes — o snapshot do Externo é o fallback.
      // Todos os leads do CNJ, não só o da ficha canônica (ver cabeçalho).
      const leadIds = [...new Set(
        rows.flatMap(r => (r.leads_do_cnj?.length ? r.leads_do_cnj : [r.lead_id])).filter(Boolean),
      )] as string[];
      const mapa: Record<string, number> = {};
      for (let i = 0; i < leadIds.length; i += 200) {
        const chunk = leadIds.slice(i, i + 200);
        try {
          const { data: leads } = await authClient
            .from('leads')
            .select('id, cac, ad_spend_at_conversion')
            .in('id', chunk);
          for (const l of (leads || []) as { id: string; cac: number | null; ad_spend_at_conversion: number | null }[]) {
            const v = Number(l.cac ?? l.ad_spend_at_conversion ?? 0);
            if (v > 0) mapa[l.id] = v;
          }
        } catch {
          break; // sem Cloud, fica o fallback do Externo
        }
      }
      setCustoCloud(mapa);

      // Onde o processo corre — a RPC não devolve, então vem de `lead_processes`
      // em lote. É só para a BUSCA da tela: falhar aqui não pode derrubar a
      // carteira, por isso o try/catch próprio e o estado separado.
      const processIds = [...new Set(rows.map(r => r.process_id).filter(Boolean))];
      const ondeCorre: Record<string, LocalDoProcesso> = {};
      for (let i = 0; i < processIds.length; i += 200) {
        const chunk = processIds.slice(i, i + 200);
        try {
          const { data: procs } = await db
            .from('lead_processes')
            .select('id, estado_origem, estado_origem_sigla, unidade_origem_cidade, tribunal, tribunal_sigla, orgao_julgador')
            .in('id', chunk);
          for (const p of (procs || []) as Record<string, string | null>[]) {
            if (!p.id) continue;
            ondeCorre[p.id] = {
              uf: p.estado_origem_sigla ?? p.estado_origem ?? null,
              cidade: p.unidade_origem_cidade ?? null,
              tribunal: p.tribunal_sigla ?? p.tribunal ?? null,
              orgao: p.orgao_julgador ?? null,
            };
          }
        } catch {
          break; // sem localidade a busca ainda acha por caso, CNJ, parte e título
        }
      }
      setLocais(ondeCorre);

      // As datas de CADA marco (process_pop_marcos): é o que permite filtrar por
      // trânsito em julgado, acordo homologado, sentença, execução… e não só
      // pelo protocolo. Paginado de mil em mil: são 1.522 linhas no POP
      // trabalhista (16/08/2026) e o PostgREST corta em 1.000 sem avisar.
      // `db as any` porque `process_pop_marcos` não está no `types.ts` gerado —
      // a tabela existe no Externo (conferida em 17/08/2026: 10 colunas), mas o
      // arquivo de tipos fica para trás de tudo que nasce fora do Lovable
      // (`callback_at` de lead_activities e a própria RPC `pop_carteira_marcos`
      // também não estão lá). Sem o cast, o TS resolve `.from()` contra a lista
      // de tabelas conhecidas e derruba a build de tipos com três erros —
      // TS2769 no nome da tabela, TS2352 no cast do lote e TS2589 ("type
      // instantiation is excessively deep") por instanciar a união de 190
      // tabelas. Mesmo caminho já usado no `carteiraMarcos.ts` ao lado.
      const porProcesso: Record<string, Record<string, string>> = {};
      const catalogo = new Map<string, CampoDeData>();
      try {
        for (let inicio = 0; ; inicio += 1000) {
          const { data: marcos } = await (db as any)
            .from('process_pop_marcos')
            .select('process_id, marco_chave, rotulo, ordem, data_detectada')
            .eq('board_id', boardId)
            .not('data_detectada', 'is', null)
            .range(inicio, inicio + 999);
          const lote = (marcos || []) as {
            process_id: string; marco_chave: string; rotulo: string | null;
            ordem: number | null; data_detectada: string;
          }[];
          for (const m of lote) {
            (porProcesso[m.process_id] ||= {})[m.marco_chave] = m.data_detectada;
            const campo = catalogo.get(m.marco_chave) || {
              chave: m.marco_chave,
              rotulo: m.rotulo || m.marco_chave,
              ordem: m.ordem ?? 99,
              processos: 0,
            };
            campo.processos += 1;
            catalogo.set(m.marco_chave, campo);
          }
          if (lote.length < 1000) break;
        }
      } catch {
        // Sem as datas por marco a tela ainda filtra pelo protocolo e pelo
        // marco atual, que vêm da própria RPC.
      }
      setDatasPorProcesso(porProcesso);
      setCamposDeData([...catalogo.values()].sort((a, b) => a.ordem - b.ordem));

      // HONORÁRIO DO CAIXA (17/08/2026) — a carteira mede quanto o processo
      // VALE; o que o escritório RECEBEU mora na planilha importada
      // (`jm_lancamentos`) e nunca chegou nesta tela. O estágio PAGO da RPC só
      // enxerga `jm_pagamentos`, que cobre 39 CNJs no banco inteiro e apenas 3
      // dos 475 deste POP — por isso o painel dizia "Pago R$ 620.129,86"
      // (que nem é dinheiro: é a condenação das partes marcadas PAGO) com
      // R$ 3,3 milhões de honorário lançado nos mesmos processos. As duas
      // contas ficam LADO A LADO na tela, nunca somadas.
      //
      // RECORTE, medido no banco em 17/08/2026: categoria `Honorários` EXATA.
      // `Honorários a receber` tem lançamento datado até 2037 (é previsão, não
      // caixa), `Honorários Adiantados Oriz` é antecipação de fundo e
      // `Honorários adv parceiro` é repasse a terceiro — nenhum é honorário
      // que entrou por este processo. `tipo` vem 'ENTRADA', nulo ou 'OUTRO';
      // 'OUTRO' fica fora porque o `tipo_raw` dele é 'Indenização'/'Repasse'.
      //
      // Falhar aqui não pode derrubar a carteira: try/catch próprio e estado
      // separado, como o custo e a localidade acima. `db as any` porque
      // `jm_lancamentos` não está no `types.ts` gerado (mesmo caminho do
      // `process_pop_marcos`).
      try {
        const cnjsDaCarteira = new Set(rows.map(r => r.cnj_num).filter(Boolean));
        const hoje = new Date().toISOString().slice(0, 10);
        const porCnj: Record<string, HonorarioDoCnj> = {};
        const resumo: HonorariosDaPlanilha = {
          total: 0, lancamentos: 0, semCnj: 0, foraDaCarteira: 0, cnjsForaDaCarteira: 0, ultimo: null,
        };
        const cnjsFora = new Set<string>();
        for (let inicio = 0; ; inicio += 1000) {
          const { data: lanc } = await (db as any)
            .from('jm_lancamentos')
            .select('processo_cnj, valor_caixa, data')
            .eq('categoria', 'Honorários')
            .or('tipo.is.null,tipo.eq.ENTRADA')
            .lte('data', hoje)
            .range(inicio, inicio + 999);
          const lote = (lanc || []) as {
            processo_cnj: string | null; valor_caixa: number | null; data: string | null;
          }[];
          for (const l of lote) {
            const valor = Number(l.valor_caixa || 0);
            resumo.total += valor;
            resumo.lancamentos += 1;
            if (l.data && (!resumo.ultimo || l.data > resumo.ultimo)) resumo.ultimo = l.data;
            const cnj = String(l.processo_cnj || '').replace(/\D/g, '');
            // CNJ tem 20 dígitos; menos de 15 é lixo de digitação, não processo.
            if (cnj.length < 15) { resumo.semCnj += valor; continue; }
            if (!cnjsDaCarteira.has(cnj)) {
              resumo.foraDaCarteira += valor;
              cnjsFora.add(cnj);
              continue;
            }
            const h = porCnj[cnj] || { valor: 0, lancamentos: 0, ultimo: null };
            h.valor += valor;
            h.lancamentos += 1;
            if (l.data && (!h.ultimo || l.data > h.ultimo)) h.ultimo = l.data;
            porCnj[cnj] = h;
          }
          if (lote.length < 1000) break;
        }
        resumo.cnjsForaDaCarteira = cnjsFora.size;
        setHonorariosPorCnj(porCnj);
        setHonorarios(resumo);

        // HONORÁRIO QUE AINDA VAI ENTRAR (18/08/2026) — pedido do Raym: "basta
        // ter a vencer e vencido na própria carteira". Sem filtro de data aqui:
        // é o corte por data que separa a vencer de vencido, e ele é feito
        // linha a linha logo abaixo, pela mesma régua do resto do app.
        const aReceber: Record<string, HonorarioAReceberDoCnj> = {};
        const vazio = (): HonorarioAReceberDoCnj => ({
          aVencer: 0, vencido: 0, condenacao: 0,
          linhasAVencer: 0, linhasVencidas: 0, vencidoMaisAntigo: null,
        });
        for (let inicio = 0; ; inicio += 1000) {
          const { data: prev } = await (db as any)
            .from('jm_lancamentos')
            .select('processo_cnj, valor_caixa, valor_competencia, data, categoria, pessoa')
            .in('categoria', [
              'Honorários a receber', 'Honorários condenação',
            ])
            .range(inicio, inicio + 999);
          const lote = (prev || []) as {
            processo_cnj: string | null; valor_caixa: number | null;
            valor_competencia: number | null; data: string | null;
            categoria: string | null; pessoa: string | null;
          }[];
          for (const l of lote) {
            const cnj = String(l.processo_cnj || '').replace(/\D/g, '');
            if (cnj.length < 15 || !cnjsDaCarteira.has(cnj)) continue;
            // Sem valor de caixa cai no de competência; sem os dois, a linha não
            // soma (37 linhas hoje) — nunca vira R$ 0,00 silencioso.
            const v = l.valor_caixa ?? l.valor_competencia;
            if (v == null) continue;
            const valor = Number(v);
            const estagio = estagioDoLancamento({
              categoria: l.categoria, pessoa: l.pessoa, data: l.data, hoje,
            });
            const a = aReceber[cnj] || vazio();
            if (estagio === 'CONDENACAO') a.condenacao += valor;
            else if (estagio === 'VENCIDO') {
              a.vencido += valor;
              a.linhasVencidas += 1;
              if (l.data && (!a.vencidoMaisAntigo || l.data < a.vencidoMaisAntigo)) {
                a.vencidoMaisAntigo = l.data;
              }
            } else {
              a.aVencer += valor;
              a.linhasAVencer += 1;
            }
            aReceber[cnj] = a;
          }
          if (lote.length < 1000) break;
        }
        setAReceberPorCnj(aReceber);
      } catch {
        // Sem a planilha a carteira continua inteira: só a linha de caixa some.
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const gruposTodos = useMemo<GrupoMarco[]>(() => {
    // Primeiro consolida POR PROCESSO (linhas são CNJ × parte).
    const porProcesso = new Map<string, ProcessoDoMarco & { _ordem: number; _chave: string; _rotulo: string }>();
    for (const l of linhas) {
      const p = porProcesso.get(l.process_id) || {
        processId: l.process_id,
        cnj: l.process_number || l.cnj_num,
        titulo: l.titulo,
        clientes: 0,
        valor: 0,
        pago: 0,
        diasNoMarco: l.dias_no_marco,
        estagio: l.estagio_financeiro,
        temAcordo: l.tem_acordo,
        suspenso: l.suspenso,
        partes: [],
        cadastros: Number(l.cadastros_do_cnj || 1),
        leadNome: l.lead_nome ?? null,
        leadsNomes: l.leads_nomes ?? [],
        valorAtualizado: 0,
        temParteSemCorrecao: false,
        ajuizamentoEm: l.ajuizamento_em ?? null,
        marcoEm: l.marco_em ?? null,
        datas: datasPorProcesso[l.process_id] || {},
        local: locais[l.process_id] || { uf: null, cidade: null, tribunal: null, orgao: null },
        busca: '',
        _ordem: l.marco_ordem ?? -1,
        _chave: l.marco_chave || 'sem_marco',
        _rotulo: l.marco_rotulo || 'Sem marco detectado',
      };
      const valorDaParte = Number(l.valor_condenacao || 0);
      const pagoDaParte = Number(l.valor_pago || 0);
      // Correção monetária: valor × coeficiente do índice do ramo, do termo
      // inicial da decisão que vale até `jcm_referencia`. Sem coeficiente, o
      // atualizado é o próprio nominal — nunca inventar índice. Parte PAGA
      // também não corrige: SELIC atualiza o que está POR receber, não o que
      // já caiu na conta.
      const jaPago = l.estagio_financeiro === 'PAGO';
      const coef = l.jcm_coeficiente == null ? null : Number(l.jcm_coeficiente);
      const corrigido = !jaPago && coef != null && Number.isFinite(coef);
      const atualizadoDaParte = valorDaParte * (corrigido ? coef : 1);
      if (l.cliente) {
        p.clientes += 1;
        // Guarda a abertura: clicar no valor mostra quanto é de cada parte.
        p.partes.push({
          cliente: l.cliente,
          valor: valorDaParte,
          valorAtualizado: atualizadoDaParte,
          corrigido,
          indice: l.jcm_indice ?? null,
          termoInicial: l.jcm_termo_inicial ?? null,
          termoEstimado: Boolean(l.jcm_termo_estimado),
          coeficiente: corrigido ? coef : null,
          pago: pagoDaParte,
          estagio: l.estagio_financeiro,
        });
        // PAGO não corrige por decisão, não por falta de índice — não é buraco.
        if (!corrigido && !jaPago && valorDaParte > 0) p.temParteSemCorrecao = true;
      }
      p.valor += valorDaParte;
      p.valorAtualizado += atualizadoDaParte;
      p.pago += pagoDaParte;
      porProcesso.set(l.process_id, p);
    }
    for (const p of porProcesso.values()) {
      p.partes.sort((a, b) => b.valor - a.valor);
      // O CNJ entra duas vezes de propósito: com pontuação (como está na tela) e
      // só dígitos, para "0011351" e "00113516320225150031" acharem o mesmo
      // processo. O nome do lead carrega o número do caso e, quase sempre, a
      // cidade — é o que salva a busca por lugar nos 82% sem UF cadastrada.
      p.busca = normalizarBusca([
        p.leadNome || '',
        ...p.leadsNomes,
        p.cnj,
        p.cnj.replace(/\D/g, ''),
        p.titulo || '',
        ...p.partes.map(parte => parte.cliente),
        p.local.cidade || '',
        p.local.uf || '',
        p.local.tribunal || '',
        p.local.orgao || '',
      ].join(' '));
    }

    const mapa = new Map<string, GrupoMarco & { _dias: number[] }>();
    for (const p of porProcesso.values()) {
      const g = mapa.get(p._chave) || {
        ordem: p._ordem, chave: p._chave, rotulo: p._rotulo,
        processos: [], valor: 0, valorAtualizado: 0, pago: 0, diasMedio: null,
        porEstagio: {}, _dias: [],
      };
      g.processos.push(p);
      g.valor += p.valor;
      g.valorAtualizado += p.valorAtualizado;
      g.pago += p.pago;
      g.porEstagio[p.estagio] = (g.porEstagio[p.estagio] || 0) + p.valor;
      if (p.diasNoMarco != null) g._dias.push(p.diasNoMarco);
      mapa.set(p._chave, g);
    }

    return [...mapa.values()]
      .map(({ _dias, ...g }) => ({
        ...g,
        processos: g.processos.sort((a, b) => (b.diasNoMarco ?? -1) - (a.diasNoMarco ?? -1)),
        diasMedio: _dias.length ? Math.round(_dias.reduce((s, d) => s + d, 0) / _dias.length) : null,
      }))
      .sort((a, b) => b.ordem - a.ordem);
  }, [linhas, locais, datasPorProcesso]);

  // ---- Busca -----------------------------------------------------------
  // Filtrar é recortar a carteira: o dinheiro do topo, os marcos e as linhas
  // passam todos pelo MESMO recorte, senão a tela mostra um total que não
  // corresponde ao que está listado embaixo dele.
  const termos = useMemo(
    () => normalizarBusca(busca.trim()).split(/\s+/).filter(Boolean),
    [busca],
  );

  /** A data do processo no campo escolhido. `ajuizamento` cai na data da RPC
   *  quando o marco não foi detectado — são 475 processos com ajuizamento na
   *  ficha contra 354 com o marco lido, e perder 121 seria filtro mentiroso. */
  const dataDoCampo = useCallback((p: ProcessoDoMarco) => {
    if (campoData === MARCO_ATUAL) return p.marcoEm;
    if (campoData === 'ajuizamento') return p.datas.ajuizamento ?? p.ajuizamentoEm;
    return p.datas[campoData] ?? null;
  }, [campoData]);

  /** Dentro da janela. Sem a data escolhida, o processo fica de fora quando há
   *  janela — a tela avisa quantos são, para o número não sumir calado. */
  const noPeriodo = useCallback((p: ProcessoDoMarco) => {
    if (!de && !ate) return true;
    const d = dataDoCampo(p);
    if (!d) return false;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  }, [de, ate, dataDoCampo]);

  const filtrando = termos.length > 0 || !!de || !!ate;

  const grupos = useMemo<GrupoMarco[]>(() => {
    if (!filtrando) return gruposTodos;
    return gruposTodos
      .map(g => {
        const processos = g.processos.filter(
          p => termos.every(t => p.busca.includes(t)) && noPeriodo(p),
        );
        const porEstagio: Record<string, number> = {};
        for (const p of processos) porEstagio[p.estagio] = (porEstagio[p.estagio] || 0) + p.valor;
        const dias = processos.map(p => p.diasNoMarco).filter((d): d is number => d != null);
        return {
          ...g,
          processos,
          porEstagio,
          valor: processos.reduce((s, p) => s + p.valor, 0),
          valorAtualizado: processos.reduce((s, p) => s + p.valorAtualizado, 0),
          pago: processos.reduce((s, p) => s + p.pago, 0),
          diasMedio: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : null,
        };
      })
      .filter(g => g.processos.length > 0);
  }, [gruposTodos, termos, noPeriodo, filtrando]);

  /** As linhas (CNJ × parte) dos processos que sobraram — é delas que sai o
   *  dinheiro do topo, para o total bater com a lista. */
  const linhasVisiveis = useMemo(() => {
    if (!filtrando) return linhas;
    const ids = new Set(grupos.flatMap(g => g.processos.map(p => p.processId)));
    return linhas.filter(l => ids.has(l.process_id));
  }, [linhas, grupos, filtrando]);

  const totais = useMemo(
    () => calcularTotais(linhasVisiveis, custoCloud, honorariosPorCnj, aReceberPorCnj),
    [linhasVisiveis, custoCloud, honorariosPorCnj, aReceberPorCnj],
  );

  /** A carteira INTEIRA, sem o filtro — a tela usa para dizer "N de 475". */
  const totaisCarteira = useMemo(
    () => calcularTotais(linhas, custoCloud, honorariosPorCnj, aReceberPorCnj),
    [linhas, custoCloud, honorariosPorCnj, aReceberPorCnj],
  );

  /** Anos que existem NO CAMPO ESCOLHIDO, do mais novo para o mais velho — é o
   *  que a tela oferece no "por ano". Lista fixa envelheceria e ofereceria ano
   *  sem processo nenhum; e trocar o campo tem que trocar os anos junto. */
  const anosDisponiveis = useMemo(() => {
    const anos = new Set<number>();
    for (const g of gruposTodos) {
      for (const p of g.processos) {
        const d = dataDoCampo(p);
        if (d) anos.add(Number(d.slice(0, 4)));
      }
    }
    return [...anos].filter(a => a > 1900).sort((a, b) => b - a);
  }, [gruposTodos, dataDoCampo]);

  /** Quantos processos da carteira inteira não têm a data escolhida. */
  const semADataEscolhida = useMemo(
    () => gruposTodos.reduce(
      (s, g) => s + g.processos.filter(p => !dataDoCampo(p)).length, 0,
    ),
    [gruposTodos, dataDoCampo],
  );

  return {
    linhas, grupos, totais, totaisCarteira, camposDeData, anosDisponiveis,
    semADataEscolhida, honorarios, filtrando, loading, erro, recarregar: carregar,
  };
}

/** Os agregados da carteira a partir das linhas (CNJ × parte) que estiverem na
 *  mesa. Função pura de propósito: a mesma conta serve para a carteira inteira
 *  e para o recorte de uma busca — duas contas diferentes divergiriam. */
function calcularTotais(
  linhas: CarteiraPopLinha[],
  custoCloud: Record<string, number>,
  honorariosPorCnj: Record<string, HonorarioDoCnj> = {},
  aReceberPorCnj: Record<string, HonorarioAReceberDoCnj> = {},
) {
  {
    const processos = new Map<string, CarteiraPopLinha>();
    const porEstagio: Record<string, number> = {};
    let valor = 0, pago = 0, valorAtualizado = 0, partesSemCorrecao = 0;
    let corrigidoAte: string | null = null;
    const referenciasPorIndice: Record<string, string> = {};
    for (const l of linhas) {
      if (!processos.has(l.process_id)) processos.set(l.process_id, l);
      const v = Number(l.valor_condenacao || 0);
      // Mesma regra da abertura por processo: parte PAGA fica no nominal.
      const jaPago = l.estagio_financeiro === 'PAGO';
      const coef = l.jcm_coeficiente == null ? null : Number(l.jcm_coeficiente);
      const corrigido = !jaPago && coef != null && Number.isFinite(coef);
      valor += v;
      valorAtualizado += v * (corrigido ? coef : 1);
      if (!corrigido && !jaPago && v > 0) partesSemCorrecao += 1;
      // Cada índice tem a SUA safra e cadências diferentes: a SELIC vem do
      // Bacen todo dia, a TCM ainda é carregada à mão. Guardar a MAIOR data
      // faria a tela prometer uma atualização que metade da carteira não teve,
      // então `corrigidoAte` é a MENOR — e as duas ficam visíveis ao lado.
      if (corrigido && l.jcm_referencia) {
        if (!corrigidoAte || l.jcm_referencia < corrigidoAte) corrigidoAte = l.jcm_referencia;
        if (l.jcm_indice) {
          const atual = referenciasPorIndice[l.jcm_indice];
          if (!atual || l.jcm_referencia > atual) referenciasPorIndice[l.jcm_indice] = l.jcm_referencia;
        }
      }
      pago += Number(l.valor_pago || 0);
      porEstagio[l.estagio_financeiro] = (porEstagio[l.estagio_financeiro] || 0) + v;
    }

    const procs = [...processos.values()];
    const dias = procs.map(p => p.dias_no_marco).filter((d): d is number => d != null);
    const idades = procs.map(p => p.idade_dias).filter((d): d is number => d != null);
    const decididos = procs.filter(p => p.decidido);
    // Índice de sucesso HONESTO: só entra no denominador o decidido AVALIÁVEL —
    // com leitura de decisão na jurimetria ou com acordo homologado. "Decidido
    // sem valor" sem leitura é buraco de captura, não derrota (medido em 14/08:
    // 239 decididos, 62 com leitura, 56 sucessos = 90%; dividir pelos 239 daria
    // 30% e mentiria para baixo).
    const avaliaveis = decididos.filter(p => p.tem_leitura || p.tem_acordo);
    const sucessos = avaliaveis.filter(p => p.sucesso);

    // Custo por LEAD distinto (um lead com 2 processos custa uma vez só).
    // Percorre TODOS os leads do CNJ: ficha irmã pode ser de outro lead, e o
    // CAC dele continua sendo custo real da carteira.
    const custoPorLead = new Map<string, number>();
    const todosOsLeads = new Set<string>();
    for (const p of procs) {
      const ids = p.leads_do_cnj?.length ? p.leads_do_cnj : (p.lead_id ? [p.lead_id] : []);
      for (const id of ids) {
        todosOsLeads.add(id);
        // O snapshot do Externo só traz o cac da ficha canônica; para os irmãos
        // o Cloud é a única fonte.
        const v = custoCloud[id] ?? (id === p.lead_id ? Number(p.custo_lead || 0) : 0);
        if (v > 0) custoPorLead.set(id, v);
      }
    }
    const custo = [...custoPorLead.values()].reduce((s, v) => s + v, 0);
    const leadsComCusto = custoPorLead.size;
    const leadsTotal = todosOsLeads.size;

    // Honorário recebido dos processos que estão NA MESA — segue o recorte da
    // busca junto com o resto. Uma vez por CNJ: o lançamento é do processo, e
    // as linhas aqui são CNJ × parte (17 partes para 3 CNJs no PAGO de hoje).
    let honorarioRecebido = 0, honorarioLancamentos = 0, honorarioCnjs = 0;
    let honorarioUltimo: string | null = null;
    // O que ainda vai entrar, na mesma régua do resto: a vencer, vencido e
    // condenação nunca se somam entre si.
    let honorarioAVencer = 0, honorarioVencido = 0, honorarioCondenacao = 0;
    let honorarioLinhasVencidas = 0, honorarioCnjsVencidos = 0;
    let honorarioVencidoMaisAntigo: string | null = null;
    for (const cnj of new Set(procs.map(p => p.cnj_num))) {
      const ar = aReceberPorCnj[cnj];
      if (ar) {
        honorarioAVencer += ar.aVencer;
        honorarioVencido += ar.vencido;
        honorarioCondenacao += ar.condenacao;
        honorarioLinhasVencidas += ar.linhasVencidas;
        if (ar.vencido > 0) honorarioCnjsVencidos += 1;
        if (ar.vencidoMaisAntigo
          && (!honorarioVencidoMaisAntigo || ar.vencidoMaisAntigo < honorarioVencidoMaisAntigo)) {
          honorarioVencidoMaisAntigo = ar.vencidoMaisAntigo;
        }
      }
      const h = honorariosPorCnj[cnj];
      if (!h) continue;
      honorarioRecebido += h.valor;
      honorarioLancamentos += h.lancamentos;
      honorarioCnjs += 1;
      if (h.ultimo && (!honorarioUltimo || h.ultimo > honorarioUltimo)) honorarioUltimo = h.ultimo;
    }

    return {
      processos: procs.length,
      semMarco: procs.filter(p => !p.marco_chave).length,
      /** CNJs com mais de uma ficha — a dedup já protegeu o total, mas o cadastro
       *  duplicado continua lá e vale limpar. */
      cnjsComFichaRepetida: procs.filter(p => Number(p.cadastros_do_cnj || 1) > 1).length,
      /** Partes (processo × pessoa) — o valor é por parte, não por processo. */
      partes: linhas.filter(l => l.cliente).length,
      valor,
      /** Carteira com juros e correção, até `corrigidoAte`. NÃO substitui `valor`. */
      valorAtualizado,
      /** Data limite da correção — a MENOR entre os índices, para não prometer
       *  atualização que parte da carteira não teve. */
      corrigidoAte,
      /** Safra vigente de cada índice: a tela detalha quando elas divergem. */
      referenciasPorIndice,
      /** Partes com valor que ficaram sem índice: o atualizado está subestimado. */
      partesSemCorrecao,
      pago,
      /** Honorário do escritório que ENTROU (planilha), nos CNJs deste recorte.
       *  Outra régua que `valor`/`pago`: é a fatia do escritório, não o
       *  processo inteiro. A tela mostra separado e não soma. */
      honorarioRecebido,
      honorarioLancamentos,
      honorarioCnjs,
      honorarioUltimo,
      honorarioAVencer,
      honorarioVencido,
      honorarioCondenacao,
      honorarioLinhasVencidas,
      honorarioCnjsVencidos,
      honorarioVencidoMaisAntigo,
      porEstagio,
      mediaDiasNoMarco: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : null,
      mediaIdadeDias: idades.length ? Math.round(idades.reduce((s, d) => s + d, 0) / idades.length) : null,
      decididos: decididos.length,
      avaliaveis: avaliaveis.length,
      semLeitura: decididos.length - avaliaveis.length,
      sucessos: sucessos.length,
      indiceSucesso: avaliaveis.length ? Math.round((sucessos.length / avaliaveis.length) * 100) : null,
      custo,
      leadsComCusto,
      leadsTotal,
      /** Realizado − custo: o que já voltou de fato contra o que foi gasto. */
      resultadoRealizado: pago - custo,
      /** Valor da carteira ÷ custo — potencial, no vocabulário do aviso da tela. */
      multiploPotencial: custo > 0 ? valor / custo : null,
    };
  }
}

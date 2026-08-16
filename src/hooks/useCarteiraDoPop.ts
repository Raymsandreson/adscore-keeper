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

/**
 * @param busca Filtra a carteira por caso/lead, parte, título, CNJ (com ou sem
 *   pontuação) e cidade/UF/tribunal/órgão. Cada termo separado por espaço tem
 *   que bater. Vazio = carteira inteira.
 */
export function useCarteiraDoPop(boardId: string | null, busca = '') {
  const [linhas, setLinhas] = useState<CarteiraPopLinha[]>([]);
  const [custoCloud, setCustoCloud] = useState<Record<string, number>>({});
  const [locais, setLocais] = useState<Record<string, LocalDoProcesso>>({});
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
      // atualizado é o próprio nominal — nunca inventar índice.
      const coef = l.jcm_coeficiente == null ? null : Number(l.jcm_coeficiente);
      const corrigido = coef != null && Number.isFinite(coef);
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
        if (!corrigido && valorDaParte > 0) p.temParteSemCorrecao = true;
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
  }, [linhas, locais]);

  // ---- Busca -----------------------------------------------------------
  // Filtrar é recortar a carteira: o dinheiro do topo, os marcos e as linhas
  // passam todos pelo MESMO recorte, senão a tela mostra um total que não
  // corresponde ao que está listado embaixo dele.
  const termos = useMemo(
    () => normalizarBusca(busca.trim()).split(/\s+/).filter(Boolean),
    [busca],
  );

  const grupos = useMemo<GrupoMarco[]>(() => {
    if (!termos.length) return gruposTodos;
    return gruposTodos
      .map(g => {
        const processos = g.processos.filter(p => termos.every(t => p.busca.includes(t)));
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
  }, [gruposTodos, termos]);

  /** As linhas (CNJ × parte) dos processos que sobraram — é delas que sai o
   *  dinheiro do topo, para o total bater com a lista. */
  const linhasVisiveis = useMemo(() => {
    if (!termos.length) return linhas;
    const ids = new Set(grupos.flatMap(g => g.processos.map(p => p.processId)));
    return linhas.filter(l => ids.has(l.process_id));
  }, [linhas, grupos, termos]);

  const totais = useMemo(
    () => calcularTotais(linhasVisiveis, custoCloud),
    [linhasVisiveis, custoCloud],
  );

  /** A carteira INTEIRA, sem o filtro — a tela usa para dizer "N de 475". */
  const totaisCarteira = useMemo(
    () => calcularTotais(linhas, custoCloud),
    [linhas, custoCloud],
  );

  return { linhas, grupos, totais, totaisCarteira, loading, erro, recarregar: carregar };
}

/** Os agregados da carteira a partir das linhas (CNJ × parte) que estiverem na
 *  mesa. Função pura de propósito: a mesma conta serve para a carteira inteira
 *  e para o recorte de uma busca — duas contas diferentes divergiriam. */
function calcularTotais(linhas: CarteiraPopLinha[], custoCloud: Record<string, number>) {
  {
    const processos = new Map<string, CarteiraPopLinha>();
    const porEstagio: Record<string, number> = {};
    let valor = 0, pago = 0, valorAtualizado = 0, partesSemCorrecao = 0;
    let corrigidoAte: string | null = null;
    const referenciasPorIndice: Record<string, string> = {};
    for (const l of linhas) {
      if (!processos.has(l.process_id)) processos.set(l.process_id, l);
      const v = Number(l.valor_condenacao || 0);
      const coef = l.jcm_coeficiente == null ? null : Number(l.jcm_coeficiente);
      const corrigido = coef != null && Number.isFinite(coef);
      valor += v;
      valorAtualizado += v * (corrigido ? coef : 1);
      if (!corrigido && v > 0) partesSemCorrecao += 1;
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

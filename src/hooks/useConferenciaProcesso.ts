// =============================================================================
// Conferência de UM processo da carteira — "esse valor e esse marco estão certos
// mesmo?".
//
// Pedido do usuário (15/08/2026): na Carteira do POP, poder abrir o processo e
// CONFERIR de onde saiu cada número, em vez de confiar no agregado.
//
// Este hook NÃO recalcula a carteira: ele refaz, no front e à vista, exatamente
// as mesmas regras que a RPC `pop_carteira_marcos` aplica, e mostra a matéria
// prima ao lado do resultado. Se divergir, é bug — e a tela diz qual.
//
// Regras replicadas (fonte: 20260814210000_pop_carteira_marcos_rpc.sql e a skill
// whatsjud-fluxo-vocabulario):
//   - VALOR VIGENTE = ÚLTIMA decisão de cada (processo × cliente). Somar
//     jm_valores direto infla ~2,6x (a mesma pessoa aparece na sentença e nos
//     embargos). Aqui a decisão usada aparece marcada e as anteriores ficam
//     visíveis como descartadas.
//   - MARCO ATUAL = maior `ordem` entre os marcos que NÃO atravessam fases
//     (acordo homologado e suspensão são ESTADO, não fase — viram coluna).
//   - ESTÁGIO FINANCEIRO = escada PAGO > A_RECEBER (acordo) > sugerido do marco
//     atual > CONDENACAO (tem valor) > PROJETADO.
//
// Tudo aqui é SELECT. As tabelas lidas (`jm_*`, `process_pop_marcos`,
// `pop_marcos`, `lead_processes`) já têm policy de SELECT para `authenticated`
// no Externo; a sessão anônima é garantida antes de consultar, senão a RLS
// devolve zero linha em silêncio.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { onlyDigits, cnjVariantes, parseCnj } from '@/lib/cnj';

/** O client é tipado com o schema do Cloud; as tabelas do Externo não estão lá. */
interface FiltroExterno {
  eq: (coluna: string, valor: unknown) => FiltroExterno;
  in: (coluna: string, valores: unknown[]) => FiltroExterno;
}
const externo = db as unknown as {
  from: (t: string) => { select: (c: string) => FiltroExterno };
};
type Consulta = { data: Record<string, unknown>[] | null; error: { message?: string } | null };

export interface DecisaoJm {
  dec_id: string;
  processo_cnj: string;
  data_decisao: string | null;
  /** Início de juros e correção — a data que a correção monetária usa. */
  termo_inicial_jcm: string | null;
  tipo_evento: string | null;
  instancia: string | null;
  abrangencia: string | null;
  rotulo_original: string | null;
  titulo: string | null;
  orgao: string | null;
  relator: string | null;
  link: string | null;
  flag_revisar: string | null;
}

export interface ValorJm {
  id: number;
  dec_id: string | null;
  cliente: string | null;
  dano_moral: number | null;
  dano_estetico: number | null;
  base_calculo: number | null;
  flag_correcao: string | null;
}

export interface PagamentoJm {
  id: number;
  cliente: string | null;
  n_parcela: number | null;
  data_prevista: string | null;
  data_recebida: string | null;
  status: string | null;
  forma: string | null;
  valor_pago: number | null;
  valor_previsto: number | null;
}

export interface MarcoConferido {
  chave: string;
  rotulo: string;
  ordem: number | null;
  dataDetectada: string | null;
  fonte: string | null;
  temProvaDocumental: boolean;
  /** Estado (acordo, suspensão): não disputa a fase atual. */
  atravessaFases: boolean;
  /** Marco gravado no processo que não existe mais no POP — a carteira ignora. */
  semCadastroNoPop: boolean;
  estagioSugerido: string | null;
  /** É o marco que a carteira mostra para este processo. */
  atual: boolean;
}

export interface ClienteConferido {
  cliente: string;
  /** dano_moral + dano_estetico da decisão usada — o que entra na carteira. */
  valor: number;
  danoMoral: number;
  danoEstetico: number;
  decisaoUsada: DecisaoJm | null;
  /** Decisões anteriores do mesmo cliente: existem, mas NÃO são somadas. */
  descartadas: { decisao: DecisaoJm | null; valor: number }[];
  pago: number;
  estagio: string;
  /** valor × coeficiente. Igual ao nominal quando o ramo não tem índice. */
  valorAtualizado: number;
  /** false = sem índice/competência OU parte já PAGA: o "atualizado" é o nominal repetido. */
  corrigido: boolean;
  /** Última data_recebida quando o estágio é PAGO — a razão de não corrigir. */
  pagoEm: string | null;
  /** Data de início de juros e correção usada — da decisão que vale. */
  termoInicial: string | null;
  /** Veio da data da decisão porque a decisão não tinha `termo_inicial_jcm`. */
  termoEstimado: boolean;
  coeficiente: number | null;
}

export interface DuplicataProcesso {
  id: string;
  title: string | null;
  processNumber: string | null;
  workflowId: string | null;
  createdAt: string | null;
  /** De qual caso é esta ficha — fichas irmãs podem ser de leads diferentes. */
  leadId: string | null;
  leadNome: string | null;
  /** É a linha que está aberta na conferência. */
  esta: boolean;
}

export type NivelAlerta = 'alto' | 'atencao' | 'info';
export interface AlertaConferencia {
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
}

export interface AlvoConferencia {
  processId: string;
  boardId: string;
  cnj: string;
  titulo?: string | null;
  /** Nome do caso que a carteira já tem em mão — evita cabeçalho vazio no load. */
  leadNome?: string | null;
  /** Valor que a carteira está exibindo — a conferência compara com o recalculado. */
  valorNaCarteira?: number;
  /** Abriu clicando no valor: a tela já rola para a abertura por parte. */
  foco?: 'valores';
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** `order by data_decisao desc nulls last`, com dec_id como desempate estável. */
function maisRecentePrimeiro(a: DecisaoJm | null, b: DecisaoJm | null): number {
  const da = a?.data_decisao || '';
  const dbt = b?.data_decisao || '';
  if (da !== dbt) {
    if (!da) return 1;
    if (!dbt) return -1;
    return dbt.localeCompare(da);
  }
  return (b?.dec_id || '').localeCompare(a?.dec_id || '');
}

export function useConferenciaProcesso(alvo: AlvoConferencia | null) {
  const [decisoes, setDecisoes] = useState<DecisaoJm[]>([]);
  const [valores, setValores] = useState<ValorJm[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoJm[]>([]);
  const [marcos, setMarcos] = useState<MarcoConferido[]>([]);
  const [duplicatas, setDuplicatas] = useState<DuplicataProcesso[]>([]);
  /** Ordem do marco "sentença" NESTE POP — a régua de "o mérito já saiu". */
  const [ordemSentenca, setOrdemSentenca] = useState<number | null>(null);
  /** Correção monetária: coeficiente por competência (AAAA-MM-01) do índice do ramo. */
  const [jcm, setJcm] = useState<{
    indice: string | null;
    referencia: string | null;
    coeficientes: Record<string, number>;
  }>({ indice: null, referencia: null, coeficientes: {} });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!alvo) {
      setDecisoes([]); setValores([]); setPagamentos([]); setMarcos([]); setDuplicatas([]);
      setJcm({ indice: null, referencia: null, coeficientes: {} });
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const variantes = cnjVariantes(alvo.cnj);

      const [dec, val, pag, ppm, pm, dup] = await Promise.all([
        externo.from('jm_decisoes')
          .select('dec_id, processo_cnj, data_decisao, termo_inicial_jcm, tipo_evento, instancia, abrangencia, rotulo_original, titulo, orgao, relator, link, flag_revisar')
          .in('processo_cnj', variantes) as unknown as Promise<Consulta>,
        externo.from('jm_valores')
          .select('id, dec_id, cliente, dano_moral, dano_estetico, base_calculo, flag_correcao')
          .in('processo_cnj', variantes) as unknown as Promise<Consulta>,
        externo.from('jm_pagamentos')
          .select('id, cliente, n_parcela, data_prevista, data_recebida, status, forma, valor_pago, valor_previsto')
          .in('processo_cnj', variantes) as unknown as Promise<Consulta>,
        externo.from('process_pop_marcos')
          .select('board_id, marco_chave, rotulo, ordem, data_detectada, fonte, tem_prova_documental')
          .eq('process_id', alvo.processId) as unknown as Promise<Consulta>,
        externo.from('pop_marcos')
          .select('chave, rotulo, ordem, atravessa_fases, estagio_financeiro_sugerido')
          .eq('board_id', alvo.boardId) as unknown as Promise<Consulta>,
        externo.from('lead_processes')
          .select('id, title, process_number, workflow_id, created_at, deleted_at, lead_id')
          .in('process_number', variantes) as unknown as Promise<Consulta>,
      ]);

      const primeiroErro = [dec, val, pag, ppm, pm, dup].find(r => r.error);
      if (primeiroErro?.error) throw new Error(primeiroErro.error.message || 'Falha ao conferir');

      setDecisoes((dec.data || []) as unknown as DecisaoJm[]);
      setValores((val.data || []) as unknown as ValorJm[]);
      setPagamentos((pag.data || []) as unknown as PagamentoJm[]);

      // Marcos do POP, indexados por chave — é o que a RPC usa no join.
      const doPop = new Map<string, { atravessa: boolean; estagio: string | null; rotulo: string }>();
      let ordemDaSentenca: number | null = null;
      for (const m of (pm.data || []) as Record<string, unknown>[]) {
        doPop.set(String(m.chave), {
          atravessa: Boolean(m.atravessa_fases),
          estagio: (m.estagio_financeiro_sugerido as string) ?? null,
          rotulo: String(m.rotulo ?? m.chave),
        });
        if (m.chave === 'sentenca' && m.ordem != null) ordemDaSentenca = Number(m.ordem);
      }
      setOrdemSentenca(ordemDaSentenca);

      const lista: MarcoConferido[] = ((ppm.data || []) as Record<string, unknown>[])
        // A RPC filtra por board_id; process_pop_marcos pode ter marco de outro POP.
        .filter(m => String(m.board_id) === alvo.boardId)
        .map(m => {
          const cfg = doPop.get(String(m.marco_chave));
          return {
            chave: String(m.marco_chave),
            rotulo: (m.rotulo as string) || cfg?.rotulo || String(m.marco_chave),
            ordem: m.ordem == null ? null : Number(m.ordem),
            dataDetectada: (m.data_detectada as string) ?? null,
            fonte: (m.fonte as string) ?? null,
            temProvaDocumental: Boolean(m.tem_prova_documental),
            atravessaFases: cfg?.atravessa ?? false,
            semCadastroNoPop: !cfg,
            estagioSugerido: cfg?.estagio ?? null,
            atual: false,
          };
        });

      // Marco atual: mesma regra da RPC — ordem desc, data desc, só quem é FASE
      // e está cadastrado no POP (a RPC usa inner join com pop_marcos).
      const candidatos = lista
        .filter(m => !m.atravessaFases && !m.semCadastroNoPop)
        .sort((a, b) => (b.ordem ?? -1) - (a.ordem ?? -1)
          || (b.dataDetectada || '').localeCompare(a.dataDetectada || ''));
      if (candidatos[0]) candidatos[0].atual = true;

      setMarcos(lista.sort((a, b) => (b.ordem ?? -1) - (a.ordem ?? -1)));

      const digitosAlvo = onlyDigits(alvo.cnj);
      const fichas = ((dup.data || []) as Record<string, unknown>[])
        // Mesma cláusula da RPC: cadastro apagado não conta.
        .filter(r => r.deleted_at == null && onlyDigits(r.process_number as string) === digitosAlvo);

      // De quem é cada ficha. Mesma fonte da carteira (snapshot vivo do Externo,
      // 19.973 de 19.974 leads com nome em 15/08/2026) — nada de ir ao Cloud só
      // por isso. Falhar aqui não derruba a conferência: fica sem o nome.
      const leadIds = [...new Set(fichas.map(r => r.lead_id).filter(Boolean))] as string[];
      const nomePorLead = new Map<string, string>();
      if (leadIds.length) {
        const { data: leads } = await (externo.from('leads')
          .select('id, lead_name')
          .in('id', leadIds) as unknown as Promise<Consulta>);
        for (const l of (leads || [])) {
          const nome = String(l.lead_name ?? '').trim();
          if (nome) nomePorLead.set(String(l.id), nome);
        }
      }

      // Correção monetária: índice pelo ramo do CNJ (mesma regra da RPC — dígito
      // 14 é o segmento do Judiciário), coeficiente pela competência do termo
      // inicial de cada decisão. Ramo sem índice carregado fica sem correção, e
      // a tela diz isso em vez de aplicar um índice de outro ramo.
      const segmento = parseCnj(alvo.cnj)?.segment ?? null;
      const indiceDoRamo = segmento === 5 ? 'SELIC_SIMPLES_JT'
        : segmento === 8 ? 'TCM_ESTADUAL'
        : null;
      const competencias = [...new Set(
        ((dec.data || []) as unknown as DecisaoJm[])
          .map(d => (d.termo_inicial_jcm || d.data_decisao || '').slice(0, 7))
          .filter(Boolean)
          .map(ym => `${ym}-01`),
      )];
      if (indiceDoRamo && competencias.length) {
        const { data: idx } = await (externo.from('jm_indices')
          .select('indice, competencia, coeficiente, referencia')
          .eq('indice', indiceDoRamo)
          .in('competencia', competencias) as unknown as Promise<Consulta>);
        const coeficientes: Record<string, number> = {};
        let referencia: string | null = null;
        for (const r of (idx || [])) {
          // Guarda extra: mock/servidor que ignore o filtro não pode misturar índice.
          if (r.indice != null && r.indice !== indiceDoRamo) continue;
          const c = Number(r.coeficiente);
          if (Number.isFinite(c)) coeficientes[String(r.competencia)] = c;
          if (r.referencia) referencia = String(r.referencia);
        }
        setJcm({ indice: indiceDoRamo, referencia, coeficientes });
      } else {
        setJcm({ indice: null, referencia: null, coeficientes: {} });
      }

      setDuplicatas(fichas
        .map(r => ({
          id: String(r.id),
          title: (r.title as string) ?? null,
          processNumber: (r.process_number as string) ?? null,
          workflowId: r.workflow_id ? String(r.workflow_id) : null,
          createdAt: (r.created_at as string) ?? null,
          leadId: r.lead_id ? String(r.lead_id) : null,
          leadNome: r.lead_id ? nomePorLead.get(String(r.lead_id)) ?? null : null,
          esta: String(r.id) === alvo.processId,
        }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [alvo]);

  useEffect(() => { void carregar(); }, [carregar]);

  /** De quem é ESTE processo — o lead (caso) da ficha aberta. */
  const leadDoProcesso = useMemo(
    () => duplicatas.find(d => d.esta)?.leadNome ?? null,
    [duplicatas],
  );

  const marcoAtual = useMemo(() => marcos.find(m => m.atual) || null, [marcos]);
  const temAcordo = useMemo(() => marcos.some(m => m.chave === 'acordo_homologado'), [marcos]);
  const suspenso = useMemo(() => marcos.some(m => m.chave === 'suspensao'), [marcos]);

  const clientes = useMemo<ClienteConferido[]>(() => {
    const porDecId = new Map(decisoes.map(d => [d.dec_id, d]));
    const porCliente = new Map<string, ValorJm[]>();
    for (const v of valores) {
      const c = v.cliente || '(sem cliente identificado)';
      porCliente.set(c, [...(porCliente.get(c) || []), v]);
    }

    // Pago por cliente: só o que tem data_recebida — previsto não é caixa.
    // A planilha importou 344 parcelas recebidas SEM valor_pago (caso 10 é uma
    // delas), então "recebeu" e "quanto recebeu" são perguntas separadas:
    //  - pagoPorCliente   soma o que tem valor (para exibir);
    //  - quitadoPorCliente diz se TODAS as parcelas do cliente foram recebidas
    //    (para o estágio) — data_recebida basta, valor nulo não desclassifica.
    const pagoPorCliente = new Map<string, number>();
    const parcelasPorCliente = new Map<string, { recebidas: number; pendentes: number; ultimaRecebida: string | null }>();
    for (const p of pagamentos) {
      const c = p.cliente || '(sem cliente identificado)';
      const info = parcelasPorCliente.get(c) || { recebidas: 0, pendentes: 0, ultimaRecebida: null };
      if (p.data_recebida) {
        info.recebidas += 1;
        if (!info.ultimaRecebida || p.data_recebida > info.ultimaRecebida) info.ultimaRecebida = p.data_recebida;
        pagoPorCliente.set(c, (pagoPorCliente.get(c) || 0) + num(p.valor_pago));
      } else {
        info.pendentes += 1;
      }
      parcelasPorCliente.set(c, info);
    }

    return [...porCliente.entries()].map(([cliente, linhas]) => {
      const ordenadas = [...linhas].sort((a, b) =>
        maisRecentePrimeiro(porDecId.get(a.dec_id || '') || null, porDecId.get(b.dec_id || '') || null));
      const usada = ordenadas[0];
      const danoMoral = num(usada?.dano_moral);
      const danoEstetico = num(usada?.dano_estetico);
      const valor = danoMoral + danoEstetico;
      const pago = pagoPorCliente.get(cliente) || 0;

      // Correção monetária da PARTE: o termo é o da decisão que vale para ela.
      const decUsada = porDecId.get(usada?.dec_id || '') || null;
      const termoInicial = decUsada?.termo_inicial_jcm || decUsada?.data_decisao || null;
      const termoEstimado = !decUsada?.termo_inicial_jcm && !!decUsada?.data_decisao;
      const competencia = termoInicial ? `${termoInicial.slice(0, 7)}-01` : null;
      const coef = competencia ? jcm.coeficientes[competencia] ?? null : null;
      const parcelas = parcelasPorCliente.get(cliente) || { recebidas: 0, pendentes: 0, ultimaRecebida: null };
      const quitado = parcelas.recebidas > 0 && parcelas.pendentes === 0;
      const estagio = (pago > 0 || quitado) ? 'PAGO'
        : temAcordo ? 'A_RECEBER'
        : marcoAtual?.estagioSugerido ? marcoAtual.estagioSugerido
        : valor > 0 ? 'CONDENACAO'
        : 'PROJETADO';
      // Dinheiro que já caiu na conta não corrige: SELIC/TCM atualizam o que
      // está POR receber. Parte PAGA fica no nominal, e a tela diz o porquê.
      const corrigido = estagio !== 'PAGO' && coef != null && Number.isFinite(coef);
      return {
        cliente,
        valor,
        danoMoral,
        danoEstetico,
        valorAtualizado: valor * (corrigido ? (coef as number) : 1),
        corrigido,
        pagoEm: estagio === 'PAGO' ? parcelas.ultimaRecebida : null,
        termoInicial,
        termoEstimado,
        coeficiente: corrigido ? coef : null,
        decisaoUsada: decUsada,
        descartadas: ordenadas.slice(1).map(v => ({
          decisao: porDecId.get(v.dec_id || '') || null,
          valor: num(v.dano_moral) + num(v.dano_estetico),
        })),
        pago,
        estagio,
      };
    }).sort((a, b) => b.valor - a.valor);
  }, [valores, decisoes, pagamentos, marcoAtual, temAcordo, jcm]);

  const totalConferido = useMemo(() => clientes.reduce((s, c) => s + c.valor, 0), [clientes]);
  /** Carteira deste processo com juros e correção — ao lado do nominal. */
  const totalAtualizado = useMemo(
    () => clientes.reduce((s, c) => s + c.valorAtualizado, 0), [clientes]);
  const totalPago = useMemo(() => clientes.reduce((s, c) => s + c.pago, 0), [clientes]);
  const somaIngenua = useMemo(
    () => valores.reduce((s, v) => s + num(v.dano_moral) + num(v.dano_estetico), 0),
    [valores],
  );

  const alertas = useMemo<AlertaConferencia[]>(() => {
    if (!alvo || loading) return [];
    const out: AlertaConferencia[] = [];

    const copias = duplicatas.length;
    if (copias > 1) {
      const casos = [...new Set(duplicatas.map(d => d.leadNome).filter(Boolean))] as string[];
      out.push({
        nivel: 'atencao',
        titulo: `Este CNJ está cadastrado ${copias} vezes`,
        detalhe: 'A carteira já conta este CNJ uma vez só (dedup de 15/08/2026), então o total do POP '
          + 'está certo. O cadastro duplicado continua e vale limpar'
          + (casos.length > 1
            ? ` — atenção: as fichas estão em casos diferentes (${casos.join(', ')}), então apagar a errada perde histórico.`
            : '.'),
      });
    }

    if (!marcoAtual) {
      out.push({
        nivel: 'atencao',
        titulo: 'Nenhum marco de fase detectado',
        detalhe: marcos.length
          ? 'Só há marcos de estado (acordo/suspensão) ou marcos que não existem mais no POP — a carteira mostra este processo sem marco.'
          : 'A captura (DataJud/Escavador/documento) ainda não detectou nenhum marco neste processo.',
      });
    } else if (!marcoAtual.dataDetectada) {
      out.push({
        nivel: 'atencao',
        titulo: 'Marco atual sem data',
        detalhe: `"${marcoAtual.rotulo}" foi detectado sem data — por isso o tempo no marco aparece vazio.`,
      });
    }

    const semCadastro = marcos.filter(m => m.semCadastroNoPop);
    if (semCadastro.length) {
      out.push({
        nivel: 'atencao',
        titulo: `${semCadastro.length} marco(s) fora do POP atual`,
        detalhe: `Gravados no processo mas sem cadastro neste POP (${semCadastro.map(m => m.chave).join(', ')}) — `
          + 'a carteira ignora esses marcos ao decidir a fase atual.',
      });
    }

    // Já passou da sentença DESTE POP e não tem leitura? Aí o buraco dói.
    const jaDecidiu = temAcordo
      || (ordemSentenca != null && marcoAtual?.ordem != null && marcoAtual.ordem >= ordemSentenca);
    if (!decisoes.length) {
      out.push({
        nivel: jaDecidiu ? 'alto' : 'info',
        titulo: 'Sem leitura de decisão',
        detalhe: 'Não há decisão lida na jurimetria para este CNJ. Sem leitura, o valor fica projetado e o '
          + 'processo sai da conta do índice de sucesso — é buraco de captura, não derrota.',
      });
    }

    const semDecisao = valores.filter(v => !v.dec_id || !decisoes.some(d => d.dec_id === v.dec_id));
    if (semDecisao.length) {
      out.push({
        nivel: 'atencao',
        titulo: `${semDecisao.length} valor(es) sem decisão vinculada`,
        detalhe: 'Valor lançado sem `dec_id` válido não tem data — ele perde a disputa de "última decisão" '
          + 'e pode estar sendo descartado indevidamente.',
      });
    }

    // Empate de data no mesmo cliente: o "última decisão" vira sorteio.
    for (const c of clientes) {
      const dataUsada = c.decisaoUsada?.data_decisao;
      const empate = c.descartadas.filter(d => d.decisao?.data_decisao && d.decisao.data_decisao === dataUsada && d.valor !== c.valor);
      if (empate.length) {
        out.push({
          nivel: 'alto',
          titulo: `Empate de data em ${c.cliente}`,
          detalhe: `Duas decisões da mesma data (${dataUsada}) com valores diferentes — qual vale é indefinido. `
            + 'Conferir a decisão certa antes de usar este número.',
        });
      }
    }

    const estagios = [...new Set(clientes.map(c => c.estagio))];
    if (estagios.length > 1) {
      out.push({
        nivel: 'atencao',
        titulo: 'Clientes em estágios financeiros diferentes',
        detalhe: `${estagios.join(', ')} no mesmo processo. A carteira joga o valor inteiro num estágio só — `
          + 'o total por estágio do POP fica torto neste caso.',
      });
    }

    if (alvo.valorNaCarteira != null && Math.abs(alvo.valorNaCarteira - totalConferido) > 0.01) {
      out.push({
        nivel: 'alto',
        titulo: 'Valor da carteira diverge do recalculado',
        detalhe: `A carteira mostra ${alvo.valorNaCarteira.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} `
          + `e a conferência chega em ${totalConferido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      });
    }

    const revisar = decisoes.filter(d => d.flag_revisar);
    if (revisar.length) {
      out.push({
        nivel: 'atencao',
        titulo: `${revisar.length} decisão(ões) marcada(s) para revisão`,
        detalhe: 'A leitura sinalizou dúvida nessas decisões — o valor pode mudar quando forem revisadas.',
      });
    }

    return out;
  }, [alvo, loading, duplicatas, marcos, marcoAtual, decisoes, valores, clientes, totalConferido, temAcordo, ordemSentenca]);

  return {
    marcos, marcoAtual, temAcordo, suspenso, ordemSentenca, leadDoProcesso,
    clientes, decisoes, valores, pagamentos, duplicatas,
    totalConferido, totalAtualizado, somaIngenua, totalPago,
    jcmIndice: jcm.indice, jcmReferencia: jcm.referencia,
    alertas, loading, erro, recarregar: carregar,
  };
}

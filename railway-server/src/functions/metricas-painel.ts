// Painel de métricas: uma chamada devolve tudo que a aba mostra.
//
// Fica no Railway (e não no navegador) por três motivos:
//  1. o token da Meta nunca pode chegar ao front;
//  2. `meta_capi_events` tem RLS sem policy — só service role lê;
//  3. agregar 3.400 leads no cliente seria baixar 3.400 leads no cliente.
//
// O que sai daqui é AGREGADO. Nenhum nome, telefone ou e-mail de cliente
// atravessa esta resposta.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { CAPI_TOKEN, GRAPH_VERSION, CAPI_DATASET_ID } from '../lib/metaCapi';
import { hojeISO, diasAtras, corteDeDias, diaDoInstante, diaDaColuna } from '../lib/diasSaoPaulo';
import { rotinasParaOPainel } from '../lib/estadoDosCrons';

// PostgREST corta em 1000. Não é teoria: o dedup da planilha leu 1000 de 7.255
// e teria recriado lead por 10 minutos até alguém notar. Toda leitura de volume
// aqui pagina.
const PAGINA = 1000;
const TETO_PAGINAS = 20;

// Dia civil brasileiro vem de `lib/diasSaoPaulo` — modulo puro, com teste.
// Ver o comentario de la: o dia UTC fazia "hoje" comecar as 21h de ontem.

async function leTudo<T>(
  monta: (de: number, ate: number) => any,
): Promise<T[]> {
  const acc: T[] = [];
  for (let p = 0; p < TETO_PAGINAS; p++) {
    const { data, error } = await monta(p * PAGINA, (p + 1) * PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data || []) as T[];
    acc.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return acc;
}

function contaPor<T>(linhas: T[], chave: (l: T) => string | null): Array<{ nome: string; qtd: number }> {
  const m: Record<string, number> = {};
  for (const l of linhas) {
    const k = chave(l);
    if (!k) continue;
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m)
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd);
}

/**
 * Investimento vindo da Marketing API, ao vivo.
 *
 * `time_increment=1` traz o gasto DIA A DIA numa chamada só — dá a série do
 * gráfico e os totais de hoje/7d/30d sem três requisições por conta.
 *
 * Conta sem permissão ou sem gasto não pode derrubar o painel inteiro: o erro
 * fica na própria conta e o resto da aba continua de pé.
 */
async function investimento() {
  const g = async (path: string) => {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
        `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    return (await r.json()) as any;
  };

  const contas = await g('me/adaccounts?fields=id,name,account_status,currency&limit=50');
  if (contas?.error) {
    return { disponivel: false, erro: contas.error.message, contas: [], serie: [], total_hoje: 0, total_7d: 0, total_30d: 0 };
  }

  const hoje = hojeISO();
  const corte7 = corteDeDias(7);
  const porDia: Record<string, number> = {};
  const detalhe: Array<Record<string, unknown>> = [];
  let t30 = 0, t7 = 0, tHoje = 0;

  for (const c of contas?.data ?? []) {
    // `date_preset=last_30d` da Meta EXCLUI o dia corrente — com ele o card
    // "investido hoje" fica zerado para sempre, que e justamente o numero que
    // se quer ver ao vivo. `time_range` explicito com `until` = hoje inclui.
    const janela = encodeURIComponent(JSON.stringify({ since: diasAtras(29), until: hojeISO() }));
    const ins = await g(
      `${c.id}/insights?fields=spend,impressions,clicks&time_range=${janela}&time_increment=1&limit=100`,
    );
    if (ins?.error) {
      detalhe.push({ conta: c.name, id: c.id, erro: ins.error.message });
      continue;
    }
    let c30 = 0, c7 = 0, cHoje = 0;
    for (const d of ins?.data ?? []) {
      const dia = String(d.date_start || '').slice(0, 10);
      const v = Number(d.spend || 0);
      if (!dia || !Number.isFinite(v)) continue;
      porDia[dia] = (porDia[dia] || 0) + v;
      c30 += v;
      if (dia >= corte7) c7 += v;
      if (dia === hoje) cHoje += v;
    }
    t30 += c30; t7 += c7; tHoje += cHoje;
    detalhe.push({
      conta: c.name,
      id: c.id,
      moeda: c.currency || 'BRL',
      ativa: c.account_status === 1,
      hoje: Number(cHoje.toFixed(2)),
      ultimos_7d: Number(c7.toFixed(2)),
      ultimos_30d: Number(c30.toFixed(2)),
    });
  }

  const serie = Object.entries(porDia)
    .map(([dia, valor]) => ({ dia, valor: Number(valor.toFixed(2)) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  return {
    disponivel: true,
    contas: detalhe,
    serie,
    total_hoje: Number(tHoje.toFixed(2)),
    total_7d: Number(t7.toFixed(2)),
    total_30d: Number(t30.toFixed(2)),
  };
}


/**
 * Checklist da integracao com a Meta, medido na fonte.
 *
 * Existe porque eu vinha conferindo isso na mao a cada conversa: se os conjuntos
 * ja otimizam por conversao, se algum anuncio usa o dataset, se os formularios
 * estao marcados. Sao os tres sinais que dizem se o trabalho no Gerenciador de
 * Anuncios foi concluido — e quem opera precisa ver sozinho.
 *
 * CACHE de 5 minutos: o painel se atualiza a cada minuto e a Meta limita
 * chamada por segundo (ja devolveu "1 call per 30 seconds" no endpoint de
 * conjunto). Sem cache, a tela aberta esgota a cota do resto.
 */
let cacheIntegracao: { em: number; dados: Record<string, unknown> } | null = null;
const TTL_INTEGRACAO_MS = 5 * 60 * 1000;

async function saudeDaIntegracao(): Promise<Record<string, unknown>> {
  if (cacheIntegracao && Date.now() - cacheIntegracao.em < TTL_INTEGRACAO_MS) return cacheIntegracao.dados;
  const g = async (path: string) => {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
        `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    return (await r.json()) as any;
  };
  try {
    const contas = await g('me/adaccounts?fields=id,name&limit=50');
    if (contas?.error) throw new Error(contas.error.message);
    const conjuntos: Array<{
      nome: string; conta: string; campanha: string | null; otimizacao: string;
      usa_dataset: boolean; gasto_7d: number | null; leads_meta_7d: number | null;
    }> = [];
    const janela7 = encodeURIComponent(JSON.stringify({ since: corteDeDias(7), until: hojeISO() }));
    for (const c of contas?.data ?? []) {
      const ads = await g(
        `${c.id}/adsets?fields=name,effective_status,optimization_goal,promoted_object,campaign{name}&limit=200`,
      );
      // `level=adset` traz TODOS os conjuntos da conta numa chamada. Pedir
      // conjunto a conjunto estouraria a cota (a Meta ja devolveu "1 call per
      // 30 seconds" neste endpoint) e deixaria a aba sem numero nenhum.
      const ins = await g(
        `${c.id}/insights?level=adset&fields=adset_id,adset_name,spend,actions` +
          `&time_range=${janela7}&limit=500`,
      );
      const porConjunto: Record<string, { gasto: number; leads: number }> = {};
      for (const linha of ins?.data ?? []) {
        const nome = String(linha?.adset_name || '');
        if (!nome) continue;
        // A Meta reporta lead em mais de um `action_type` conforme o destino do
        // formulario. Somar so `lead` perde o do formulario nativo em algumas
        // contas; somar todos os parecidos contaria o mesmo lead duas vezes.
        // `lead` e o agregado oficial — e o que o Gerenciador mostra na coluna.
        const leads = (linha?.actions ?? [])
          .filter((a: any) => a?.action_type === 'lead')
          .reduce((t: number, a: any) => t + Number(a.value || 0), 0);
        const atual = porConjunto[nome] || { gasto: 0, leads: 0 };
        atual.gasto += Number(linha?.spend || 0);
        atual.leads += leads;
        porConjunto[nome] = atual;
      }
      for (const a of ads?.data ?? []) {
        if (a?.effective_status !== 'ACTIVE') continue;
        const medido = porConjunto[String(a.name)] || null;
        conjuntos.push({
          nome: a.name,
          conta: c.name,
          campanha: a?.campaign?.name || null,
          otimizacao: a.optimization_goal,
          usa_dataset: String(a?.promoted_object?.pixel_id || '') === String(CAPI_DATASET_ID),
          gasto_7d: medido ? Number(medido.gasto.toFixed(2)) : null,
          leads_meta_7d: medido ? medido.leads : null,
        });
      }
    }
    const dados = {
      disponivel: true,
      dataset_id: CAPI_DATASET_ID,
      conjuntos_ativos: conjuntos.length,
      conjuntos_otimizando_conversao: conjuntos.filter((x) => x.otimizacao === 'QUALITY_LEAD').length,
      conjuntos_usando_dataset: conjuntos.filter((x) => x.usa_dataset).length,
      detalhe: conjuntos,
    };
    cacheIntegracao = { em: Date.now(), dados };
    return dados;
  } catch (err) {
    return { disponivel: false, erro: err instanceof Error ? err.message : String(err) };
  }
}

export const handler: RequestHandler = async (_req, res) => {
  try {
    const hoje = hojeISO();
    const corte7 = corteDeDias(7);
    const corte30 = corteDeDias(30);

    const [boards, leads, fechados, gasto, eventos, statusFunil, filaCapi, integracao] = await Promise.all([
      supabase.from('kanban_boards').select('id, name'),
      leTudo<any>((de, ate) =>
        supabase
          .from('leads')
          .select('created_at, source, board_id, facebook_lead_id, adset_name, lead_status')
          .is('deleted_at', null)
          // -03:00 e nao Z: `corte30` ja e dia de Sao Paulo. Com `Z` a busca
          // comecava 3h antes e `leads.length` (o card "em 30") contava a mais.
          .gte('created_at', `${corte30}T00:00:00-03:00`)
          .order('created_at', { ascending: false })
          .range(de, ate),
      ),
      leTudo<any>((de, ate) =>
        supabase
          .from('leads')
          .select('became_client_date, source, board_id, facebook_lead_id, adset_name')
          .is('deleted_at', null)
          .eq('lead_status', 'closed')
          .gte('became_client_date', corte30)
          .order('became_client_date', { ascending: false })
          .range(de, ate),
      ),
      investimento(),
      leTudo<any>((de, ate) =>
        supabase.from('meta_capi_events').select('status, user_data_hash, motivo_skip').range(de, ate),
      ),
      leTudo<any>((de, ate) =>
        supabase.from('leads').select('lead_status').is('deleted_at', null).range(de, ate),
      ),
      Promise.all(
        ['pending', 'sent', 'failed', 'skipped'].map(async (s) => {
          const { count } = await supabase
            .from('meta_capi_events')
            .select('id', { count: 'exact', head: true })
            .eq('status', s);
          return [s, count ?? 0] as const;
        }),
      ),
      saudeDaIntegracao(),
    ]);

    // ENTROU NO CRM vs PREENCHEU O FORMULARIO. `created_at` guarda a data do
    // formulario (e o que alinha o lead com o gasto do dia no grafico), entao
    // ele nao responde "quanta coisa caiu no funil hoje". Em 09/09/2026 a
    // equipe viu ~3.100 leads chegarem e o painel dizia 169 — os dois numeros
    // certos, perguntas diferentes.
    //
    // Contagem propria, e nao derivada do fetch de 30 dias: lead que entrou hoje
    // com formulario de 45 dias atras esta fora daquela janela e sumiria.
    const contaEntradas = async (desde: string) => {
      const { count } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .gte('entrou_no_crm_em', `${desde}T00:00:00-03:00`);
      return count ?? 0;
    };
    const [entraramHoje, entraram7d] = await Promise.all([contaEntradas(hoje), contaEntradas(corte7)]);

    const nomeBoard: Record<string, string> = {};
    for (const b of (boards.data || []) as any[]) nomeBoard[b.id] = b.name;

    const leadsPorDia: Record<string, number> = {};
    for (const l of leads) {
      const d = diaDoInstante(l.created_at);
      if (d) leadsPorDia[d] = (leadsPorDia[d] || 0) + 1;
    }
    const fechPorDia: Record<string, number> = {};
    for (const f of fechados) {
      const d = diaDaColuna(f.became_client_date);
      if (d) fechPorDia[d] = (fechPorDia[d] || 0) + 1;
    }

    const leads7 = leads.filter((l) => diaDoInstante(l.created_at) >= corte7).length;
    const leadsHoje = leads.filter((l) => diaDoInstante(l.created_at) === hoje).length;
    const fech7 = fechados.filter((f) => diaDaColuna(f.became_client_date) >= corte7).length;
    const fechHoje = fechados.filter((f) => diaDaColuna(f.became_client_date) === hoje).length;

    // Lead pago = veio de formulário de anúncio. Duas provas independentes:
    // o `source` que a planilha de Lead Ads carimba, ou o id do lead na Meta.
    const ehPago = (l: any) =>
      Boolean(l.facebook_lead_id) || String(l.source || '').toLowerCase().includes('planilha meta ads');
    const leadsPagos = leads.filter(ehPago);
    const fechamentosPagos = fechados.filter(ehPago).length;
    const pagos7 = leadsPagos.filter((l) => diaDoInstante(l.created_at) >= corte7).length;
    const diasPagos = leadsPagos.map((l) => diaDoInstante(l.created_at)).filter(Boolean).sort();
    const primeiroDiaPago = diasPagos[0] || null;
    // "Completo" = existe lead pago desde o inicio da janela. Sem isso o CPL de
    // 30 dias divide gasto de 30 por lead de 7 e mente para baixo.
    const cobertura_completa_30d = Boolean(primeiroDiaPago && primeiroDiaPago <= corte30);

    // DESEMPENHO POR CONJUNTO — onde o dinheiro entra e de onde o contrato sai.
    //
    // Os conjuntos sao nomeados por acolhedor (ISRAEL, MATEUS, KAROL, EDILAN),
    // entao esta e tambem a leitura por pessoa. Cruzar os dois lados importa:
    // a Meta sabe o gasto e quantos formularios preencheu; so o CRM sabe quantos
    // viraram contrato. Nenhum dos dois responde "quanto custa um cliente".
    //
    // A juncao e pelo NOME do conjunto (`leads.adset_name`), unico campo comum.
    // Conjunto pausado nao some da tabela: ele gastou e trouxe lead na janela, e
    // esconde-lo faria a soma da tela nao bater com a soma da conta.
    const conjuntosMeta = ((integracao as any)?.detalhe || []) as Array<{
      nome: string; conta: string; campanha: string | null; otimizacao: string;
      usa_dataset: boolean; gasto_7d: number | null; leads_meta_7d: number | null;
    }>;
    const crmPorConjunto: Record<string, { leads_7d: number; leads_30d: number; fechados_30d: number }> = {};
    const zeraConjunto = (n: string) => {
      if (!crmPorConjunto[n]) crmPorConjunto[n] = { leads_7d: 0, leads_30d: 0, fechados_30d: 0 };
      return crmPorConjunto[n];
    };
    for (const l of leadsPagos) {
      const n = String(l.adset_name || '').trim();
      if (!n) continue;
      const e = zeraConjunto(n);
      e.leads_30d += 1;
      if (diaDoInstante(l.created_at) >= corte7) e.leads_7d += 1;
    }
    for (const f of fechados.filter(ehPago)) {
      const n = String(f.adset_name || '').trim();
      if (!n) continue;
      zeraConjunto(n).fechados_30d += 1;
    }
    // Erro da Graph API gravado onde deveria estar o nome do conjunto. Aparece
    // marcado, nao escondido: sao leads reais, com gasto real por tras, e
    // apaga-los da tela apagaria tambem o pedido de conserto.
    const nomeInvalido = (n: string) =>
      n.length > 80 || /permission|http|error/i.test(n);
    const nomesUnidos = new Set([...conjuntosMeta.map((c) => c.nome), ...Object.keys(crmPorConjunto)]);
    const desempenho_por_conjunto = [...nomesUnidos]
      .map((nome) => {
        const meta = conjuntosMeta.find((c) => c.nome === nome) || null;
        const crm = crmPorConjunto[nome] || { leads_7d: 0, leads_30d: 0, fechados_30d: 0 };
        const gasto = meta?.gasto_7d ?? null;
        return {
          nome,
          nome_invalido: nomeInvalido(nome),
          conta: meta?.conta ?? null,
          campanha: meta?.campanha ?? null,
          ativo: Boolean(meta),
          otimizacao: meta?.otimizacao ?? null,
          // O piloto de Leads com Conversao: o unico conjunto que a Meta compra
          // por quem fecha, e nao por volume de formulario.
          piloto_conversao: meta?.otimizacao === 'QUALITY_LEAD',
          usa_dataset: meta?.usa_dataset ?? null,
          gasto_7d: gasto,
          leads_meta_7d: meta?.leads_meta_7d ?? null,
          leads_crm_7d: crm.leads_7d,
          leads_crm_30d: crm.leads_30d,
          fechados_30d: crm.fechados_30d,
          // Janelas iguais dos dois lados: gasto de 7 dias sobre lead de 7 dias.
          custo_por_lead_7d:
            gasto && gasto > 0 && crm.leads_7d > 0 ? Number((gasto / crm.leads_7d).toFixed(2)) : null,
          // Deliberadamente vazio quando nao ha fechamento: "R$ 0,00 por
          // contrato" e mentira, e "infinito" nao ajuda ninguem a decidir.
          taxa_fechamento_30d:
            crm.leads_30d > 0 ? Number(((crm.fechados_30d / crm.leads_30d) * 100).toFixed(2)) : null,
        };
      })
      .sort((a, b) => (b.gasto_7d ?? -1) - (a.gasto_7d ?? -1) || b.leads_crm_30d - a.leads_crm_30d);

    // FUNIL DO LEAD DE ANUNCIO. `lead_status` e a coluna que a equipe move (e
    // que a planilha escreve de volta); `status` guarda a etapa do kanban e,
    // medido em 10/09/2026, 100% dos 3.290 leads pagos estavam em "Recepcao" —
    // a etapa nao e usada para lead de anuncio, entao contar por ela mostraria
    // uma barra so e nenhuma informacao.
    const contaStatus = (v: string) => leadsPagos.filter((l) => (l.lead_status || '') === v).length;
    const funil_pago = {
      total: leadsPagos.length,
      sem_resposta: contaStatus('no_response'),
      em_atendimento: contaStatus('in_progress'),
      fechados: contaStatus('closed'),
      inviaveis: contaStatus('inviavel'),
      recusados: contaStatus('refused') + contaStatus('cancelled'),
      taxa_contato:
        leadsPagos.length > 0
          ? Number((((leadsPagos.length - contaStatus('no_response')) / leadsPagos.length) * 100).toFixed(2))
          : null,
      taxa_fechamento:
        leadsPagos.length > 0 ? Number(((contaStatus('closed') / leadsPagos.length) * 100).toFixed(2)) : null,
    };

    const serieDias = Array.from({ length: 30 }, (_, i) => diasAtras(29 - i));

    return res.status(200).json({
      gerado_em: new Date().toISOString(),
      janela: { de: corte30, ate: hoje },
      investimento: gasto,
      // PAGO vs TOTAL, sempre os dois. Em 09/09/2026 o card "Leads hoje" dizia
      // 171 e o gestor de trafego via 80: 99 dos 171 eram `google_alerts`
      // (noticia raspada, que nao custou anuncio nenhum). Numero de lead total
      // ao lado do investimento do dia convida a essa leitura errada, e o card
      // de custo por lead ja usava so os pagos — o painel se contradizia.
      leads: {
        hoje: leadsHoje,
        pagos_hoje: leadsPagos.filter((l) => diaDoInstante(l.created_at) === hoje).length,
        ultimos_7d: leads7,
        pagos_7d: pagos7,
        ultimos_30d: leads.length,
        pagos_30d: leadsPagos.length,
        entraram_no_funil_hoje: entraramHoje,
        entraram_no_funil_7d: entraram7d,
        por_fonte: contaPor(leads, (l) => l.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(leads, (l) => nomeBoard[l.board_id] || null).slice(0, 15),
      },
      fechamentos: {
        hoje: fechHoje,
        ultimos_7d: fech7,
        ultimos_30d: fechados.length,
        por_fonte: contaPor(fechados, (f) => f.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(fechados, (f) => nomeBoard[f.board_id] || null).slice(0, 15),
      },
      serie: serieDias.map((d) => ({
        dia: d,
        leads: leadsPorDia[d] || 0,
        fechamentos: fechPorDia[d] || 0,
        investido: gasto.serie?.find((s: any) => s.dia === d)?.valor ?? 0,
      })),
      capi: {
        ...Object.fromEntries(filaCapi),
        // Evento COM lead_id e o que a Meta consegue casar com o formulario do
        // anuncio. Sem ele sobra pareamento por telefone/e-mail, que aqui falha
        // na maioria dos fechamentos (lead sem contato nenhum).
        com_lead_id: eventos.filter((e: any) => e?.user_data_hash?.lead_id).length,
        aceitos_com_lead_id: eventos.filter(
          (e: any) => e?.status === 'sent' && e?.user_data_hash?.lead_id,
        ).length,
        motivos_ignorado: eventos
          .filter((e: any) => e?.status === 'skipped' && e?.motivo_skip)
          .reduce((acc: Record<string, number>, e: any) => {
            acc[e.motivo_skip] = (acc[e.motivo_skip] || 0) + 1;
            return acc;
          }, {}),
      },
      // Como o funil esta distribuido hoje — inclui o que veio da coluna que a
      // equipe preenche na planilha.
      funil_por_status: statusFunil.reduce((acc: Record<string, number>, l: any) => {
        const k = l?.lead_status || '(sem status)';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      integracao,
      desempenho_por_conjunto,
      funil_pago,
      // Rotinas: contador zera a cada deploy, entao quem responde e `ultima_em`.
      rotinas: rotinasParaOPainel(),
      // Custo só existe se houve gasto: dividir por zero e mostrar "R$ 0,00 por
      // lead" mentiria tanto quanto esconder o número.
      //
      // E o divisor é LEAD PAGO, não lead qualquer: 3.019 dos 3.496 dos últimos
      // 30 dias são `google_alerts` (notícia raspada, que não custou anúncio
      // nenhum). Dividir por todos dava R$ 8,14 de CPL — número errado com cara
      // de métrica, que é pior que número nenhum.
      // JANELAS IGUAIS. Dividir 30 dias de investimento por 7 dias de lead
      // importado dava R$ 211,55 de CPL — formula certa, denominador incompleto.
      // O CPL de 7 dias e o unico confiavel hoje; o de 30 so passa a valer
      // quando o backlog das planilhas entrar (ver planilhas-lead-ads.md).
      custo: {
        leads_pagos_7d: pagos7,
        leads_pagos_30d: leadsPagos.length,
        fechamentos_pagos_30d: fechamentosPagos,
        por_lead_pago_7d: gasto.total_7d > 0 && pagos7 ? Number((gasto.total_7d / pagos7).toFixed(2)) : null,
        por_lead_pago_30d:
          cobertura_completa_30d && gasto.total_30d > 0 && leadsPagos.length
            ? Number((gasto.total_30d / leadsPagos.length).toFixed(2))
            : null,
        por_fechamento_pago_30d:
          cobertura_completa_30d && gasto.total_30d > 0 && fechamentosPagos
            ? Number((gasto.total_30d / fechamentosPagos).toFixed(2))
            : null,
        // A tela precisa poder dizer POR QUE o numero de 30 dias esta vazio.
        cobertura_pagos_desde: primeiroDiaPago,
        cobertura_completa_30d,
        aviso_30d: cobertura_completa_30d
          ? null
          : `lead pago so existe no CRM desde ${primeiroDiaPago || 'nunca'}; o investimento de 30 dias nao tem com o que ser dividido. Importar o backlog das planilhas resolve.`,
      },
    });
  } catch (err) {
    console.error('[metricas-painel]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

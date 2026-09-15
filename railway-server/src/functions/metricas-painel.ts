// Painel de métricas: uma chamada devolve tudo que a aba mostra, no recorte pedido.
//
// Fica no Railway (e não no navegador) por três motivos:
//  1. o token da Meta nunca pode chegar ao front;
//  2. `meta_capi_events` tem RLS sem policy — só service role lê;
//  3. agregar 3.400 leads no cliente seria baixar 3.400 leads no cliente.
//
// O que sai daqui é AGREGADO. Nenhum nome, telefone ou e-mail de cliente
// atravessa esta resposta.
//
// RECORTES (10/09/2026): a aba filtra por período, por funil e por acolhedor. Os
// três alcançam os DOIS lados — gasto da Meta e lead do CRM. Um filtro que
// mudasse só metade produziria um custo por lead com numerador de um recorte e
// denominador de outro, que é pior que não filtrar.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { CAPI_TOKEN, GRAPH_VERSION, CAPI_DATASET_ID } from '../lib/metaCapi';
import { hojeISO, diasAtras, corteDeDias, diaDoInstante, diaDaColuna } from '../lib/diasSaoPaulo';
import { rotinasParaOPainel } from '../lib/estadoDosCrons';
import { ACOLHEDORES, FUNIS, acolhedorDoConjunto, funilDoNome, ehBoardDeCaptacao } from '../lib/recortesDoPainel';
import { authorizeFunctionRequest } from '../lib/functionAuth';

// PostgREST corta em 1000. Não é teoria: o dedup da planilha leu 1000 de 7.255
// e teria recriado lead por 10 minutos até alguém notar. Toda leitura de volume
// aqui pagina.
const PAGINA = 1000;
const TETO_PAGINAS = 20;

// Teto da janela. 180 dias de leads paginados ainda é uma leitura sadia; acima
// disso a aba viraria um relatório, e relatório não se recarrega a cada minuto.
const MAX_DIAS_JANELA = 180;

// Dia civil brasileiro vem de `lib/diasSaoPaulo` — modulo puro, com teste.
// Ver o comentario de la: o dia UTC fazia "hoje" comecar as 21h de ontem.

async function leTudo<T>(monta: (de: number, ate: number) => any): Promise<T[]> {
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

const graph = async (path: string) => {
  const r = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
      `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
  );
  return (await r.json()) as any;
};

/** Uma linha de gasto: um dia, um conjunto. É a menor unidade que os três filtros conseguem recortar. */
interface LinhaDeGasto {
  dia: string;
  conjunto: string;
  campanha: string | null;
  conta: string;
  gasto: number;
  leads_meta: number;
  acolhedor: string | null;
  funil: string | null;
}

/**
 * Gasto da Meta por DIA e por CONJUNTO.
 *
 * Antes isto vinha agregado por conta, e por isso nenhum filtro alcançava o
 * dinheiro: dava para separar os leads da Karolyne, mas não o que se gastou com
 * eles. `level=adset` + `time_increment=1` traz a menor granularidade que
 * responde aos três recortes de uma vez, numa chamada por conta.
 *
 * CACHE de 5 minutos por janela: a aba se atualiza a cada minuto e a Meta limita
 * chamada por segundo (já devolveu "1 call per 30 seconds" no endpoint de
 * conjunto). Sem cache, uma tela aberta esgota a cota do resto do sistema.
 */
const cacheGasto = new Map<string, { em: number; linhas: LinhaDeGasto[]; erro: string | null }>();
const TTL_MS = 5 * 60 * 1000;

async function gastoPorDiaEConjunto(de: string, ate: string): Promise<{ linhas: LinhaDeGasto[]; erro: string | null }> {
  const chave = `${de}|${ate}`;
  const guardado = cacheGasto.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return { linhas: guardado.linhas, erro: guardado.erro };

  const linhas: LinhaDeGasto[] = [];
  let erro: string | null = null;
  try {
    const contas = await graph('me/adaccounts?fields=id,name&limit=50');
    if (contas?.error) throw new Error(contas.error.message);
    const janela = encodeURIComponent(JSON.stringify({ since: de, until: ate }));
    for (const c of contas?.data ?? []) {
      // `date_preset` da Meta EXCLUI o dia corrente — com ele o "investido hoje"
      // fica zerado para sempre, que é justamente o número que se quer ao vivo.
      let url =
        `${c.id}/insights?level=adset&fields=adset_name,campaign_name,spend,actions` +
        `&time_range=${janela}&time_increment=1&limit=500`;
      // Paginação: 30 dias × ~25 conjuntos passa de 500 linhas com folga, e sem
      // seguir o `next` a conta perderia os dias mais antigos SEM ERRO NENHUM —
      // o gráfico simplesmente começaria mais tarde do que o pedido.
      for (let pagina = 0; pagina < 20 && url; pagina++) {
        const ins: any = url.startsWith('http') ? await (await fetch(url)).json() : await graph(url);
        if (ins?.error) {
          erro = ins.error.message;
          break;
        }
        for (const d of ins?.data ?? []) {
          const conjunto = String(d?.adset_name || '');
          const dia = String(d?.date_start || '').slice(0, 10);
          if (!conjunto || !dia) continue;
          // A Meta reporta lead em mais de um `action_type` conforme o destino
          // do formulário. `lead` é o agregado oficial — o mesmo que o
          // Gerenciador mostra na coluna de resultados.
          const leads = (d?.actions ?? [])
            .filter((a: any) => a?.action_type === 'lead')
            .reduce((t: number, a: any) => t + Number(a.value || 0), 0);
          linhas.push({
            dia,
            conjunto,
            campanha: d?.campaign_name || null,
            conta: c.name,
            gasto: Number(d?.spend || 0),
            leads_meta: leads,
            acolhedor: acolhedorDoConjunto(conjunto),
            funil: funilDoNome(d?.campaign_name || ''),
          });
        }
        url = ins?.paging?.next || '';
      }
    }
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
  }
  cacheGasto.set(chave, { em: Date.now(), linhas, erro });
  return { linhas, erro };
}

/**
 * Checklist da integração com a Meta: os três sinais que dizem se o trabalho no
 * Gerenciador de Anúncios foi concluído. Não segue o filtro de período — é
 * configuração, não medição.
 */
let cacheIntegracao: { em: number; dados: Record<string, unknown> } | null = null;

async function saudeDaIntegracao(): Promise<Record<string, unknown>> {
  if (cacheIntegracao && Date.now() - cacheIntegracao.em < TTL_MS) return cacheIntegracao.dados;
  try {
    const contas = await graph('me/adaccounts?fields=id,name&limit=50');
    if (contas?.error) throw new Error(contas.error.message);
    const conjuntos: Array<{
      nome: string; conta: string; campanha: string | null; ativo: boolean;
      otimizacao: string; usa_dataset: boolean; acolhedor: string | null; funil: string | null;
    }> = [];
    for (const c of contas?.data ?? []) {
      const ads = await graph(
        `${c.id}/adsets?fields=name,effective_status,optimization_goal,promoted_object,campaign{name}&limit=500`,
      );
      for (const a of ads?.data ?? []) {
        conjuntos.push({
          nome: a.name,
          conta: c.name,
          campanha: a?.campaign?.name || null,
          ativo: a?.effective_status === 'ACTIVE',
          otimizacao: a.optimization_goal,
          usa_dataset: String(a?.promoted_object?.pixel_id || '') === String(CAPI_DATASET_ID),
          acolhedor: acolhedorDoConjunto(a.name),
          funil: funilDoNome(a?.campaign?.name || ''),
        });
      }
    }
    const ativos = conjuntos.filter((x) => x.ativo);
    const dados = {
      disponivel: true,
      dataset_id: CAPI_DATASET_ID,
      conjuntos_ativos: ativos.length,
      conjuntos_otimizando_conversao: ativos.filter((x) => x.otimizacao === 'QUALITY_LEAD').length,
      conjuntos_usando_dataset: ativos.filter((x) => x.usa_dataset).length,
      detalhe: conjuntos,
    };
    cacheIntegracao = { em: Date.now(), dados };
    return dados;
  } catch (err) {
    return { disponivel: false, erro: err instanceof Error ? err.message : String(err) };
  }
}

/** Data no formato AAAA-MM-DD. Recusa o resto em vez de deixar a Meta interpretar. */
const ehData = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const handler: RequestHandler = async (req, res) => {
  try {
    // PORTA FECHADA, INDEPENDENTE DO ENFORCE GLOBAL.
    //
    // `RAILWAY_AUTH_ENFORCE` esta desligado em producao e nao da para liga-lo so
    // para esta funcao: e uma variavel do servico inteiro, e ligar hoje derruba
    // junto quem ainda chama sem credencial (13 chamadas de
    // `meta-call-queue-processor` no placar do /health). Entao o gate vive aqui.
    //
    // Medido em 15/09/2026: um `curl` anonimo de fora devolvia 200 com o
    // investimento do mes, o custo por contrato e o desempenho de cada
    // acolhedor — bastava saber a URL. O placar do /health registrou a chamada
    // como `missing_por_funcao: {metricas-painel: 1}`, o que confirma que nao
    // havia porta nenhuma, so a contagem.
    //
    // Fechar aqui e seguro porque esta funcao tem UM chamador: a aba, pelo
    // `functionRouter`, que injeta o JWT da sessao do Cloud em `Authorization`
    // sozinho (`invokeFunction` -> `getSession()`). Nenhum cron, nenhuma edge,
    // nenhum webhook chama `metricas-painel` — conferido no repo inteiro.
    const credencial = await authorizeFunctionRequest(req);
    if (!credencial.ok) {
      // O motivo junto: sem ele, "sessao expirada" e "verificador quebrado"
      // devolvem a mesma frase e alguem passa a tarde no lugar errado. Nenhum
      // valor aqui revela credencial.
      return res.status(401).json({
        error: 'o painel de métricas exige usuário logado',
        porque: credencial.reason || 'sem credencial reconhecida',
      });
    }

    const corpo = (req.body || {}) as Record<string, unknown>;
    const hoje = hojeISO();

    // Janela pedida, com o padrão sendo o que a aba mostrava antes dos filtros.
    let de = ehData(corpo.de) ? corpo.de : corteDeDias(30);
    let ate = ehData(corpo.ate) ? corpo.ate : hoje;
    if (de > ate) [de, ate] = [ate, de];
    if (ate > hoje) ate = hoje; // futuro não tem gasto nem lead; aceitar geraria coluna vazia
    const diasPedidos = Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
    if (diasPedidos > MAX_DIAS_JANELA) de = diasAtras(MAX_DIAS_JANELA - 1);

    const funilPedido = typeof corpo.funil === 'string' && FUNIS.some((f) => f.chave === corpo.funil)
      ? (corpo.funil as string)
      : null;
    const acolhedorPedido =
      typeof corpo.acolhedor === 'string' && ACOLHEDORES.some((a) => a.chave === corpo.acolhedor)
        ? (corpo.acolhedor as string)
        : null;
    const janelaInclutHoje = de <= hoje && ate >= hoje;
    // Nome e telefone so entram na LEITURA quando o detalhe foi pedido. Trazer
    // PII do banco "por via das duvidas" e como deixar a carteira em cima da
    // mesa: o agregado nunca precisou disso.
    const querDetalhe = Boolean((corpo as any).detalhar);
    const colunasDoDetalhe = querDetalhe ? ', lead_name, lead_phone' : '';

    // ESCOPO: SO PREVIDENCIARIO.
    //
    // Trabalhista tem estrutura de lead diferente, acolhedores diferentes e nao
    // vem de formulario de anuncio — o board de Acidente de Trabalho tem 7.990
    // leads vivos e ZERO pagos. Somar os dois num painel so produzia um "total
    // de leads" que nao servia para nenhuma das duas equipes: em 14/09/2026 a
    // janela de 30 dias trazia 3.100 leads de Trabalhista dentro de um painel
    // que existe para medir anuncio de PREV.
    //
    // O board entra pelo NOME, nao por lista de ids: board novo de BPC ou de
    // Auxilio Acidente passa a contar sozinho, e board de outro negocio nao
    // entra por engano.
    const boards = await supabase.from('kanban_boards').select('id, name');
    const funilPorBoard: Record<string, string | null> = {};
    const nomePorBoard: Record<string, string> = {};
    for (const b of (boards.data || []) as any[]) {
      nomePorBoard[b.id] = b.name;
      funilPorBoard[b.id] = funilDoNome(b.name);
    }
    // Casar o nome do funil nao basta: board desativado e board de POP tambem
    // casam, e nenhum dos dois capta lead. Ver `ehBoardDeCaptacao` — e pura, tem
    // teste, e explica por que o "POP - BPC" saiu daqui em 15/09/2026.
    const idsPrev = Object.keys(funilPorBoard).filter(
      (id) => funilPorBoard[id] !== null && ehBoardDeCaptacao(nomePorBoard[id]),
    );
    if (!idsPrev.length) throw new Error('nenhum board de PREV encontrado — o painel ficaria vazio sem dizer por que');

    const [leadsBrutos, fechadosBrutos, gasto, eventos, filaCapi, integracao] = await Promise.all([
      leTudo<any>((d, a) =>
        supabase
          .from('leads')
          .select(`created_at, source, board_id, facebook_lead_id, adset_name, lead_status${colunasDoDetalhe}`)
          .is('deleted_at', null)
          .in('board_id', idsPrev)
          // -03:00 e nao Z: `de` ja e dia de Sao Paulo. Com `Z` a busca comecava
          // 3h antes e o total da janela contava a mais.
          .gte('created_at', `${de}T00:00:00-03:00`)
          .lte('created_at', `${ate}T23:59:59-03:00`)
          .order('created_at', { ascending: false })
          .range(d, a),
      ),
      leTudo<any>((d, a) =>
        supabase
          .from('leads')
          .select(`became_client_date, source, board_id, facebook_lead_id, adset_name${colunasDoDetalhe}`)
          .is('deleted_at', null)
          .in('board_id', idsPrev)
          .eq('lead_status', 'closed')
          .gte('became_client_date', de)
          .lte('became_client_date', ate)
          .order('became_client_date', { ascending: false })
          .range(d, a),
      ),
      gastoPorDiaEConjunto(de, ate),
      leTudo<any>((d, a) =>
        supabase.from('meta_capi_events').select('status, user_data_hash, motivo_skip').range(d, a),
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

    // Os mapas ja foram montados antes das leituras — sao eles que definem o
    // escopo, entao nao podem ser recalculados aqui com outra regra.
    const nomeBoard = nomePorBoard;
    const funilDoBoard = funilPorBoard;

    // OS FILTROS. Aplicados aos dois lados com a MESMA regra: o funil sai do
    // nome (board no CRM, campanha na Meta) e o acolhedor sai do nome do
    // conjunto. Ver `lib/recortesDoPainel.ts` — é pura e tem teste, porque nome
    // de conjunto é escrito à mão e um `includes` solto falharia calado.
    const passaNoRecorte = (l: any) => {
      if (funilPedido && funilDoBoard[l.board_id] !== funilPedido) return false;
      if (acolhedorPedido && acolhedorDoConjunto(l.adset_name) !== acolhedorPedido) return false;
      return true;
    };
    const leads = leadsBrutos.filter(passaNoRecorte);
    const fechados = fechadosBrutos.filter(passaNoRecorte);
    const linhasDoRecorte = gasto.linhas.filter((g) => {
      if (funilPedido && g.funil !== funilPedido) return false;
      if (acolhedorPedido && g.acolhedor !== acolhedorPedido) return false;
      return true;
    });

    // O ESCOPO DO DINHEIRO E O MESMO ESCOPO DO LEAD.
    //
    // Desde 14/09/2026 o lado do CRM le so PREV, mas o lado do gasto continuava
    // somando as contas inteiras. A tela dizia "esta aba cobre so PREV" no
    // cabecalho e, tres centimetros abaixo, exibia um investimento que incluia
    // Trabalhista e venda de curso. Medido em 15/09/2026, janela de 30 dias:
    //
    //   contas inteiras .................. R$ 25.604,91
    //   campanha de PREV ................. R$ 21.539,97
    //   outro negocio .................... R$  4.064,94  (15,9%)
    //   custo por lead publicado ......... R$ 9,13
    //   custo por lead do mesmo escopo ... R$ 7,68
    //
    // Numerador de um universo dividido por denominador de outro nao e um numero
    // conservador: e um numero que nao existe. Entao o gasto de fora sai da
    // conta — e NAO some da tela: vai inteiro para `fora_do_escopo`, agrupado
    // por campanha, porque continua sendo dinheiro saindo da mesma carteira
    // (CLAUDE.md, principios de processo, item 8).
    const linhasDeGasto = linhasDoRecorte.filter((g) => g.funil !== null);
    const linhasForaDoEscopo = linhasDoRecorte.filter((g) => g.funil === null);

    const somaGasto = (linhas: LinhaDeGasto[]) => Number(linhas.reduce((t, g) => t + g.gasto, 0).toFixed(2));
    const investidoJanela = somaGasto(linhasDeGasto);
    const investidoForaDoEscopo = somaGasto(linhasForaDoEscopo);
    const investidoNasContas = Number((investidoJanela + investidoForaDoEscopo).toFixed(2));
    const investidoHoje = janelaInclutHoje ? somaGasto(linhasDeGasto.filter((g) => g.dia === hoje)) : null;

    /** Linhas de gasto agrupadas por campanha — conjunto a conjunto seriam dezenas de linhas e nenhuma decisao. */
    const porCampanha = (linhas: LinhaDeGasto[]) =>
      Object.values(
        linhas.reduce((acc: Record<string, any>, g) => {
          const k = g.campanha || '(sem campanha)';
          acc[k] = acc[k] || { campanha: k, gasto: 0, leads_meta: 0, conjuntos: new Set<string>() };
          acc[k].gasto += g.gasto;
          acc[k].leads_meta += g.leads_meta;
          acc[k].conjuntos.add(g.conjunto);
          return acc;
        }, {}),
      )
        .map((c: any) => ({
          campanha: c.campanha,
          gasto: Number(c.gasto.toFixed(2)),
          leads_meta: c.leads_meta,
          conjuntos: c.conjuntos.size,
        }))
        .sort((x, y) => y.gasto - x.gasto);
    const campanhas_fora_do_escopo = porCampanha(linhasForaDoEscopo);

    // Lead pago = veio de formulário de anúncio. Duas provas independentes: o
    // `source` que a planilha de Lead Ads carimba, ou o id do lead na Meta.
    const ehPago = (l: any) =>
      Boolean(l.facebook_lead_id) || String(l.source || '').toLowerCase().includes('planilha meta ads');
    const leadsPagos = leads.filter(ehPago);
    const fechadosPagos = fechados.filter(ehPago);

    const leadsPorDia: Record<string, number> = {};
    for (const l of leads) {
      const d = diaDoInstante(l.created_at);
      if (d) leadsPorDia[d] = (leadsPorDia[d] || 0) + 1;
    }
    const pagosPorDia: Record<string, number> = {};
    for (const l of leadsPagos) {
      const d = diaDoInstante(l.created_at);
      if (d) pagosPorDia[d] = (pagosPorDia[d] || 0) + 1;
    }
    const fechPorDia: Record<string, number> = {};
    for (const f of fechados) {
      const d = diaDaColuna(f.became_client_date);
      if (d) fechPorDia[d] = (fechPorDia[d] || 0) + 1;
    }
    const gastoPorDia: Record<string, number> = {};
    for (const g of linhasDeGasto) gastoPorDia[g.dia] = (gastoPorDia[g.dia] || 0) + g.gasto;

    const serieDias: string[] = [];
    for (let d = de; d <= ate; ) {
      serieDias.push(d);
      const prox = new Date(`${d}T12:00:00Z`);
      prox.setUTCDate(prox.getUTCDate() + 1);
      d = prox.toISOString().slice(0, 10);
    }

    // ENTROU NO CRM vs PREENCHEU O FORMULARIO. `created_at` guarda a data do
    // formulario (e o que alinha o lead com o gasto do dia), entao ele nao
    // responde "quanta coisa caiu no funil hoje". Em 09/09/2026 a equipe viu
    // ~3.100 leads chegarem e o painel dizia 169 — os dois numeros certos,
    // perguntas diferentes. Contagem propria: lead que entrou hoje com
    // formulario de 45 dias atras esta fora da janela e sumiria.
    const contaEntradas = async (desde: string, ateDia: string) => {
      // O ESCOPO VALE AQUI TAMBEM. Ate 15/09/2026 esta contagem varria o banco
      // inteiro: publicava "7.305 entraram no funil" ao lado de "3.018 leads",
      // porque os 7.305 incluiam Trabalhista e todo board que nao e desta aba.
      // Dois numeros do mesmo card medindo universos diferentes fazem a pessoa
      // duvidar dos dois.
      let q = supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .in('board_id', idsPrev)
        .gte('entrou_no_crm_em', `${desde}T00:00:00-03:00`)
        .lte('entrou_no_crm_em', `${ateDia}T23:59:59-03:00`);
      // O acolhedor não é filtrável aqui (é derivado de texto, não coluna), então
      // esta contagem só honra o funil. A tela diz isso na legenda em vez de
      // deixar o número parecer filtrado.
      if (funilPedido) {
        // Interseccao com o escopo, nao substituicao: `idsPrev` ja tirou POP e
        // desativado, e um `in` novo por cima devolveria esses de volta.
        const ids = idsPrev.filter((id) => funilDoBoard[id] === funilPedido);
        if (ids.length) q = q.in('board_id', ids);
      }
      const { count } = await q;
      return count ?? 0;
    };
    const entraramNaJanela = await contaEntradas(de, ate);
    const entraramHoje = janelaInclutHoje ? await contaEntradas(hoje, hoje) : null;

    // DESEMPENHO POR CONJUNTO — onde o dinheiro entra e de onde o contrato sai.
    // A junção é pelo NOME do conjunto (`leads.adset_name`), único campo comum:
    // a Meta sabe o gasto e quantos formulários preencheu; só o CRM sabe quantos
    // viraram contrato. Nenhum dos dois responde "quanto custa um cliente".
    const metaPorConjunto: Record<string, { gasto: number; leads_meta: number; campanha: string | null; conta: string }> = {};
    for (const g of linhasDeGasto) {
      const e = metaPorConjunto[g.conjunto] || { gasto: 0, leads_meta: 0, campanha: g.campanha, conta: g.conta };
      e.gasto += g.gasto;
      e.leads_meta += g.leads_meta;
      metaPorConjunto[g.conjunto] = e;
    }
    const crmPorConjunto: Record<string, { leads: number; fechados: number }> = {};
    const zera = (n: string) => (crmPorConjunto[n] = crmPorConjunto[n] || { leads: 0, fechados: 0 });
    for (const l of leadsPagos) {
      const n = String(l.adset_name || '').trim();
      if (n) zera(n).leads += 1;
    }
    for (const f of fechadosPagos) {
      const n = String(f.adset_name || '').trim();
      if (n) zera(n).fechados += 1;
    }
    const conjuntosConhecidos = ((integracao as any)?.detalhe || []) as Array<{
      nome: string; ativo: boolean; otimizacao: string; usa_dataset: boolean;
    }>;
    // Erro da Graph API gravado onde deveria estar o nome do conjunto. Aparece
    // marcado, não escondido: são leads reais, com gasto real por trás, e
    // apagá-los da tela apagaria também o pedido de conserto.
    const nomeInvalido = (n: string) => n.length > 80 || /permission|http|error/i.test(n);
    const desempenho_por_conjunto = [...new Set([...Object.keys(metaPorConjunto), ...Object.keys(crmPorConjunto)])]
      .map((nome) => {
        const m = metaPorConjunto[nome] || null;
        const crm = crmPorConjunto[nome] || { leads: 0, fechados: 0 };
        const cfg = conjuntosConhecidos.find((c) => c.nome === nome) || null;
        const g = m ? Number(m.gasto.toFixed(2)) : null;
        return {
          nome,
          nome_invalido: nomeInvalido(nome),
          acolhedor: acolhedorDoConjunto(nome),
          conta: m?.conta ?? null,
          campanha: m?.campanha ?? null,
          ativo: cfg?.ativo ?? false,
          otimizacao: cfg?.otimizacao ?? null,
          // O piloto de Leads com Conversão: o único conjunto que a Meta compra
          // por quem fecha, e não por volume de formulário.
          piloto_conversao: cfg?.otimizacao === 'QUALITY_LEAD',
          gasto: g,
          leads_meta: m?.leads_meta ?? null,
          leads_crm: crm.leads,
          fechados: crm.fechados,
          custo_por_lead: g && g > 0 && crm.leads > 0 ? Number((g / crm.leads).toFixed(2)) : null,
          // Deliberadamente vazio sem fechamento: "R$ 0,00 por contrato" mente
          // tanto quanto esconder o número.
          custo_por_fechamento: g && g > 0 && crm.fechados > 0 ? Number((g / crm.fechados).toFixed(2)) : null,
          taxa_fechamento: crm.leads > 0 ? Number(((crm.fechados / crm.leads) * 100).toFixed(2)) : null,
        };
      })
      .sort((a, b) => (b.gasto ?? -1) - (a.gasto ?? -1) || b.leads_crm - a.leads_crm);

    // POR ACOLHEDOR — a mesma tabela somada por pessoa. Os conjuntos são
    // nomeados por acolhedor, então esta é a leitura que a operação faz.
    const por_acolhedor = ACOLHEDORES.map((a) => {
      const doAcolhedor = desempenho_por_conjunto.filter((c) => c.acolhedor === a.chave);
      const g = Number(doAcolhedor.reduce((t, c) => t + (c.gasto ?? 0), 0).toFixed(2));
      const ld = doAcolhedor.reduce((t, c) => t + c.leads_crm, 0);
      const fe = doAcolhedor.reduce((t, c) => t + c.fechados, 0);
      return {
        chave: a.chave,
        rotulo: a.rotulo,
        conjuntos: doAcolhedor.length,
        gasto: g,
        leads: ld,
        fechados: fe,
        custo_por_lead: g > 0 && ld > 0 ? Number((g / ld).toFixed(2)) : null,
        custo_por_fechamento: g > 0 && fe > 0 ? Number((g / fe).toFixed(2)) : null,
        taxa_fechamento: ld > 0 ? Number(((fe / ld) * 100).toFixed(2)) : null,
      };
    }).filter((a) => a.conjuntos > 0);

    // O QUE NAO CAIU EM NINGUEM.
    //
    // `ACOLHEDORES` e uma lista fixa de propósito: comparar token inteiro contra
    // uma lista conhecida impede que "KAROLINA" entre calada no numero da
    // Karolyne. O preco e que conjunto com nome novo nao casa ninguem — e, ate
    // 15/09/2026, simplesmente sumia da tabela.
    //
    // Medido nesse dia: `CONJUNTO 7 - TAFFAREL` nasceu em 11/09 e ja trazia 61
    // leads e R$ 383,23 que nao apareciam em linha nenhuma. A soma da coluna
    // "leads" dava 2.745 contra 2.806 pagos, e nada na tela dizia onde estavam
    // os 61 que faltavam.
    //
    // A linha residual resolve a classe inteira do problema: conjunto novo passa
    // a aparecer no dia em que gasta o primeiro real, nomeado, pedindo cadastro
    // — em vez de sumir e voltar como diferenca inexplicada na soma.
    const orfaos = desempenho_por_conjunto.filter(
      (c) => !c.acolhedor && ((c.gasto ?? 0) > 0 || c.leads_crm > 0),
    );
    const gastoOrfao = Number(orfaos.reduce((t, c) => t + (c.gasto ?? 0), 0).toFixed(2));
    const leadsOrfaos = orfaos.reduce((t, c) => t + c.leads_crm, 0);
    const fechadosOrfaos = orfaos.reduce((t, c) => t + c.fechados, 0);
    const sem_acolhedor = orfaos.length
      ? {
          conjuntos: orfaos.length,
          gasto: gastoOrfao,
          leads: leadsOrfaos,
          fechados: fechadosOrfaos,
          custo_por_lead: gastoOrfao > 0 && leadsOrfaos > 0 ? Number((gastoOrfao / leadsOrfaos).toFixed(2)) : null,
          // Os nomes vao junto: sem eles a linha diria "tem dinheiro em algum
          // lugar" e ninguem saberia onde procurar.
          nomes: orfaos
            .map((c) => ({ nome: c.nome, gasto: c.gasto, leads: c.leads_crm, fechados: c.fechados }))
            .sort((x, y) => (y.gasto ?? 0) - (x.gasto ?? 0) || y.leads - x.leads)
            .slice(0, 12),
        }
      : null;

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
    };

    // GASTO DE CAMPANHA DESTA ABA QUE NAO TROUXE LEAD.
    //
    // Desde 15/09/2026 este bloco conta so campanha de PREV — o gasto de outro
    // negocio virou `investimento.fora_do_escopo`, que e outra conversa e tem
    // outro dono. Misturar os dois era o que fazia o card somar R$ 4.166 e
    // mandar o gestor de trafego procurar roteamento quebrado em campanha de
    // venda de curso, que nunca teve roteamento para o CRM.
    //
    // O que sobra aqui e a lista de conserto de verdade: conjunto do proprio
    // funil que consumiu verba e nao entregou lead ao funil. Nada e escondido —
    // o gasto de fora continua na tela, no seu proprio card.
    const semLeadNoCrm = desempenho_por_conjunto.filter((c) => (c.gasto ?? 0) > 0 && c.leads_crm === 0);
    const gastoSemLead = Number(semLeadNoCrm.reduce((t, c) => t + (c.gasto ?? 0), 0).toFixed(2));
    const gastoComLead = Number((investidoJanela - gastoSemLead).toFixed(2));
    const campanhas_sem_lead = Object.values(
      semLeadNoCrm.reduce((acc: Record<string, any>, c) => {
        const k = c.campanha || '(sem campanha)';
        acc[k] = acc[k] || { campanha: k, gasto: 0, conjuntos: 0, leads_meta: 0 };
        acc[k].gasto += c.gasto ?? 0;
        acc[k].conjuntos += 1;
        acc[k].leads_meta += c.leads_meta ?? 0;
        return acc;
      }, {}),
    )
      .map((c: any) => ({ ...c, gasto: Number(c.gasto.toFixed(2)) }))
      .sort((a: any, b: any) => b.gasto - a.gasto);

    // DATA DE FECHAMENTO CARIMBADA NA IMPORTAÇÃO.
    //
    // Medido em 11/09/2026: 24 dos 28 fechamentos pagos que existem têm
    // `became_client_date` = 09/09, o dia em que o `sheet_status_sync` leu a
    // coluna de status da planilha pela primeira vez — e os 24 foram atualizados
    // nesse mesmo dia. A data guardada é a da IMPORTAÇÃO, não a do fechamento.
    //
    // Isso é uma armadilha de leitura, não um número feio: quem filtrar "últimos
    // 7 dias" na semana que vem vai ver o Israel com ZERO contratos e concluir
    // que ele parou de fechar. E o gráfico mostra um pico de fechamento num dia
    // em que ninguém fechou nada.
    //
    // A tela não esconde nem corrige o valor — ela DETECTA a concentração e diz
    // o que ela significa. O conserto de verdade é a planilha passar a carregar
    // a data do fechamento; enquanto não carrega, o aviso é o que impede a
    // leitura errada.
    const fechPagosPorDia: Record<string, number> = {};
    for (const f of fechadosPagos) {
      const d = diaDaColuna(f.became_client_date);
      if (d) fechPagosPorDia[d] = (fechPagosPorDia[d] || 0) + 1;
    }
    const diaCampeao = Object.entries(fechPagosPorDia).sort((a, b) => b[1] - a[1])[0] || null;
    const concentracao =
      diaCampeao && fechadosPagos.length >= 5 && diaCampeao[1] / fechadosPagos.length >= 0.6
        ? {
            dia: diaCampeao[0],
            qtd: diaCampeao[1],
            fracao: Number(((diaCampeao[1] / fechadosPagos.length) * 100).toFixed(1)),
            aviso:
              `${diaCampeao[1]} dos ${fechadosPagos.length} fechamentos pagos do período estão todos em ` +
              `${diaCampeao[0]} — é a data em que a planilha foi lida, não a do fechamento. ` +
              `Período que não inclua esse dia vai mostrar quase nenhum contrato.`,
          }
        : null;

    const cpl = investidoJanela > 0 && leadsPagos.length ? Number((investidoJanela / leadsPagos.length).toFixed(2)) : null;
    const cpf_ = investidoJanela > 0 && fechadosPagos.length
      ? Number((investidoJanela / fechadosPagos.length).toFixed(2))
      : null;
    // Cobertura: lead pago só existe no CRM desde 28/08/2026. Janela que começa
    // antes divide gasto inteiro por lead incompleto e mente para baixo.
    const diasPagos = leadsPagos.map((l) => diaDoInstante(l.created_at)).filter(Boolean).sort();
    const primeiroDiaPago = diasPagos[0] || null;
    const cobertura_completa = Boolean(primeiroDiaPago && primeiroDiaPago <= de);
    const avisoDeCobertura = `lead pago só existe no CRM desde ${primeiroDiaPago || 'nunca'}; a janela começa antes disso, então o custo por lead divide gasto inteiro por lead incompleto.`;

    // ============================================================
    // DETALHE NOMINAL — atras de login, e so quando pedido
    // ============================================================
    //
    // Tudo acima desta linha e AGREGADO: nenhum nome, telefone ou e-mail de
    // cliente atravessa. Isso nao era estilo, era necessidade — `AUTH_ENFORCE`
    // esta DESLIGADO em producao, entao `/functions/metricas-painel` responde a
    // qualquer um que saiba a URL. Devolver a lista nominal por padrao seria
    // publicar a carteira de clientes do escritorio numa URL aberta.
    //
    // Entao o detalhe (1) so sai quando `detalhar` vem no corpo e (2) exige
    // credencial de verdade: JWT de usuario logado, chave interna ou de API. O
    // front ja injeta o JWT da sessao nas chamadas ao Railway, entao para quem
    // esta logado na aba isso e transparente.
    //
    // Telefone sai MASCARADO (4 ultimos digitos). Quem precisa do numero
    // inteiro abre o lead no funil, onde existe registro de quem olhou; painel
    // de metricas nao e lugar de copiar carteira.
    let detalhe: Record<string, unknown> | null = null;
    if (querDetalhe) {
      // A guarda saiu daqui para a PORTA da funcao: quem chega ate esta linha ja
      // apresentou credencial. Nao ha mais o caso "agregado publico, detalhe
      // fechado" que existia enquanto o resto da funcao respondia a qualquer um.
      {
        const mascara = (v: string | null) => {
          const d = String(v || '').replace(/\D/g, '');
          return d.length >= 4 ? `•••• ${d.slice(-4)}` : null;
        };
        const TETO_DETALHE = 500;
        detalhe = {
          disponivel: true,
          teto: TETO_DETALHE,
          leads: leads.slice(0, TETO_DETALHE).map((l: any) => ({
            nome: l.lead_name || '(sem nome)',
            telefone: mascara(l.lead_phone),
            dia: diaDoInstante(l.created_at),
            acolhedor: acolhedorDoConjunto(l.adset_name),
            conjunto: l.adset_name || null,
            funil: nomeBoard[l.board_id] || null,
            status: l.lead_status || null,
            pago: ehPago(l),
          })),
          leads_total: leads.length,
          // `dias_ate_fechar` fica FORA de proposito: `became_client_date` guarda
          // a data da IMPORTACAO da planilha, nao a do fechamento — 24 dos 28
          // fechamentos pagos caem todos em 09/09. Qualquer duracao calculada
          // aqui seria inventada, e com cara de metrica.
          fechamentos: fechados.slice(0, TETO_DETALHE).map((f: any) => ({
            nome: f.lead_name || '(sem nome)',
            telefone: mascara(f.lead_phone),
            dia: diaDaColuna(f.became_client_date),
            acolhedor: acolhedorDoConjunto(f.adset_name),
            conjunto: f.adset_name || null,
            funil: nomeBoard[f.board_id] || null,
            pago: ehPago(f),
          })),
          fechamentos_total: fechados.length,
        };
      }
    }

    return res.status(200).json({
      gerado_em: new Date().toISOString(),
      janela: { de, ate, dias: serieDias.length, inclui_hoje: janelaInclutHoje },
      filtros: { funil: funilPedido, acolhedor: acolhedorPedido },
      // A tela precisa poder dizer O QUE esta contando. Um painel que soma
      // Trabalhista sem avisar produz numero que ninguem consegue conferir.
      escopo: {
        area: 'PREV',
        // Nomes repetidos existem (ha dois boards "Auxilio Acidente"): o rotulo
        // mostra o conjunto, nao a contagem de ids.
        boards: [...new Set(idsPrev.map((id) => nomePorBoard[id]))].sort(),
        nota: 'Trabalhista tem estrutura e equipe diferentes e fica fora desta aba.',
      },
      opcoes: {
        funis: FUNIS.map((f) => ({ chave: f.chave, rotulo: f.rotulo })),
        acolhedores: ACOLHEDORES.map((a) => ({ chave: a.chave, rotulo: a.rotulo })),
        max_dias: MAX_DIAS_JANELA,
      },
      investimento: {
        disponivel: !gasto.erro,
        erro: gasto.erro,
        // `na_janela` e o gasto DESTA ABA (campanha de PREV) — e o unico que pode
        // dividir o lead desta aba. `nas_contas` e tudo que saiu da carteira no
        // periodo, para a tela poder mostrar a diferenca em vez de fingir que
        // ela nao existe.
        na_janela: investidoJanela,
        hoje: investidoHoje,
        nas_contas: investidoNasContas,
        fora_do_escopo: investidoForaDoEscopo,
        campanhas_fora_do_escopo,
        contas: Object.entries(
          linhasDeGasto.reduce((acc: Record<string, number>, g) => {
            acc[g.conta] = (acc[g.conta] || 0) + g.gasto;
            return acc;
          }, {}),
        ).map(([conta, valor]) => ({ conta, valor: Number(valor.toFixed(2)) })),
      },
      // PAGO vs TOTAL, sempre os dois. Em 09/09/2026 o card dizia 171 leads e o
      // gestor via 80: 99 dos 171 eram `google_alerts` (noticia raspada, que nao
      // custou anuncio nenhum). Total ao lado do investimento convida a leitura
      // errada, e o custo por lead ja usava so os pagos.
      leads: {
        na_janela: leads.length,
        pagos_na_janela: leadsPagos.length,
        hoje: janelaInclutHoje ? (leadsPorDia[hoje] || 0) : null,
        pagos_hoje: janelaInclutHoje ? (pagosPorDia[hoje] || 0) : null,
        entraram_no_funil: entraramNaJanela,
        entraram_no_funil_hoje: entraramHoje,
        por_fonte: contaPor(leads, (l) => l.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(leads, (l) => nomeBoard[l.board_id] || null).slice(0, 15),
      },
      fechamentos: {
        // Detector, não filtro: ver o bloco acima.
        concentracao,
        na_janela: fechados.length,
        pagos_na_janela: fechadosPagos.length,
        hoje: janelaInclutHoje ? (fechPorDia[hoje] || 0) : null,
        por_fonte: contaPor(fechados, (f) => f.source || '(sem origem)').slice(0, 15),
        por_board: contaPor(fechados, (f) => nomeBoard[f.board_id] || null).slice(0, 15),
      },
      serie: serieDias.map((d) => ({
        dia: d,
        leads: leadsPorDia[d] || 0,
        leads_pagos: pagosPorDia[d] || 0,
        fechamentos: fechPorDia[d] || 0,
        investido: Number((gastoPorDia[d] || 0).toFixed(2)),
      })),
      desempenho_por_conjunto,
      detalhe,
      por_acolhedor,
      sem_acolhedor,
      funil_pago,
      capi: {
        ...Object.fromEntries(filaCapi),
        // Evento COM lead_id e o que a Meta consegue casar com o formulario do
        // anuncio. Sem ele sobra pareamento por telefone/e-mail, que aqui falha
        // na maioria dos fechamentos (lead sem contato nenhum).
        com_lead_id: eventos.filter((e: any) => e?.user_data_hash?.lead_id).length,
        aceitos_com_lead_id: eventos.filter((e: any) => e?.status === 'sent' && e?.user_data_hash?.lead_id).length,
        // IGNORADA PAGA vs IGNORADA ORGANICA — sao coisas opostas.
        //
        // Medido em 11/09/2026: as 107 ignoradas vinham de `whatsapp` (97),
        // `manual` (7), `instagram` (2) e `Internet` (1). NENHUMA tinha id da
        // Meta. Sao fechamentos de lead que nunca veio de anuncio: a Meta nao
        // tem o que casar, e ignorar esta certo.
        //
        // A tela chamava as 107 de "lista de conserto", o que e falso e manda
        // alguem procurar defeito onde nao ha. O que DE FATO pede conserto e a
        // ignorada de lead PAGO — essa a Meta casaria se tivesse contato.
        //
        // O `lead_id` no hash e a prova: o normalizador so o grava quando o lead
        // tem `facebook_lead_id`.
        ignorados_de_lead_pago: eventos.filter(
          (e: any) => e?.status === 'skipped' && e?.user_data_hash?.lead_id,
        ).length,
        ignorados_organicos: eventos.filter(
          (e: any) => e?.status === 'skipped' && !e?.user_data_hash?.lead_id,
        ).length,
        motivos_ignorado: eventos
          .filter((e: any) => e?.status === 'skipped' && e?.motivo_skip)
          .reduce((acc: Record<string, number>, e: any) => {
            acc[e.motivo_skip] = (acc[e.motivo_skip] || 0) + 1;
            return acc;
          }, {}),
      },
      // Distribuição dos leads da janela — inclui o que veio da coluna que a
      // equipe preenche na planilha.
      funil_por_status: leads.reduce((acc: Record<string, number>, l: any) => {
        const k = l?.lead_status || '(sem status)';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      integracao,
      // Rotinas: contador zera a cada deploy, entao quem responde e `ultima_em`.
      rotinas: rotinasParaOPainel(),
      custo: {
        leads_pagos: leadsPagos.length,
        // Os dois lados do mesmo investimento, nomeados. Ver o comentário acima.
        gasto_sem_lead_no_crm: gastoSemLead,
        gasto_com_lead_no_crm: gastoComLead,
        por_lead_pago_so_do_que_gerou:
          gastoComLead > 0 && leadsPagos.length ? Number((gastoComLead / leadsPagos.length).toFixed(2)) : null,
        campanhas_sem_lead,
        fechamentos_pagos: fechadosPagos.length,
        por_lead_pago: cpl,
        por_fechamento_pago: cpf_,
        cobertura_pagos_desde: primeiroDiaPago,
        cobertura_completa,
        // A tela precisa poder dizer POR QUE o número está vazio ou torto.
        aviso: cobertura_completa ? null : avisoDeCobertura,
      },
    });
  } catch (err) {
    console.error('[metricas-painel]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

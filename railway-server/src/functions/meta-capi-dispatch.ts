// Drena a fila `meta_capi_events` e manda para a Meta.
//
// Único ponto do sistema que fala com a Graph API de conversões. Roda por cron
// no próprio processo (a cada 5 min) e sob demanda pelo painel.
//
// Modos:
//   { }                     → drena a fila
//   { modo: 'probe' }       → só checa a credencial e carimba meta_capi_status
//   { dry_run: true }       → monta o payload e mostra, sem chamar a Meta
//   { test_event_code }     → manda com código de teste (não entra na otimização)
//
// Por que existe: em 31/07/2026 o envio parou porque o app da Meta foi apagado,
// e ninguém soube por um mês — não havia fila nem log onde olhar. Aqui, token
// morto vira `meta_capi_status.token_valido = false` e uma pilha de `failed`
// com o erro da Meta preservado em `resposta`.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import {
  enviaParaMeta,
  registraStatusCredencial,
  CAPI_TOKEN,
  CAPI_DATASET_ID,
  GRAPH_VERSION,
} from '../lib/metaCapi';

const LOTE_PADRAO = 100;
const MAX_TENTATIVAS = 5;
// A Meta rejeita evento com mais de 7 dias. Fila parada (foi o caso entre
// julho e setembro) traria data velha demais; grudamos no limite em vez de
// perder o evento inteiro.
const LIMITE_DIAS = 7;

function eventTimeSeguro(iso: string | null): number {
  const agora = Math.floor(Date.now() / 1000);
  const piso = agora - (LIMITE_DIAS - 1) * 86400;
  if (!iso) return agora;
  const t = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(t)) return agora;
  return Math.min(Math.max(t, piso), agora);
}

/**
 * "(#100) Missing Permission" no dataset nao diz QUAL e o problema: pode ser
 * escopo que falta no token, ou ativo que ninguem atribuiu ao usuario do
 * sistema. `debug_token` separa os dois -- `scopes` traz as permissoes e
 * `granular_scopes` traz, por permissao, os ids de ativo que o token realmente
 * alcanca. Devolve frase pronta: quem le o painel precisa saber o que clicar,
 * nao receber o erro cru da Meta.
 */
async function diagnosticaAcesso(dataset: string): Promise<{
  diagnostico: string;
  escopos?: string[];
  ativos_alcancados?: string[];
}> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token` +
        `?input_token=${encodeURIComponent(CAPI_TOKEN)}&access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    const j: any = await r.json();
    if (j?.error) return { diagnostico: `debug_token indisponivel: ${j.error.message}` };

    const d = j?.data ?? {};
    const escopos: string[] = Array.isArray(d.scopes) ? d.scopes : [];
    const granular: Array<{ scope?: string; target_ids?: string[] }> = Array.isArray(d.granular_scopes)
      ? d.granular_scopes
      : [];
    const alcancados = Array.from(new Set(granular.flatMap((g) => g.target_ids ?? [])));
    const temEscopoAds = escopos.includes('ads_management') || escopos.includes('ads_read');

    let diagnostico: string;
    if (!temEscopoAds) {
      diagnostico = 'falta ads_management no token: gerar de novo marcando essa permissao';
    } else if (!alcancados.includes(String(dataset))) {
      diagnostico =
        `token tem ads_management mas nao alcanca o dataset ${dataset}: ` +
        'Configuracoes do negocio -> Usuarios do sistema -> Atribuir ativos -> o conjunto de dados, acesso total';
    } else {
      diagnostico = 'debug_token diz que o token alcanca o dataset: a negativa vem de outro campo, nao de ativo';
    }
    return { diagnostico, escopos, ativos_alcancados: alcancados };
  } catch (err) {
    return { diagnostico: `debug_token falhou: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Qual dataset as campanhas REALMENTE usam.
 *
 * O nome do conjunto de dados nao responde isso: "COMPRA ..." pode nao estar em
 * anuncio ativo nenhum. Quem responde e o `promoted_object.pixel_id` dos
 * conjuntos de anuncios ativos. Mandar conversao para dataset que nenhuma
 * campanha usa devolve 200, enche o Gerenciador de Eventos e nao otimiza nada --
 * a mesma classe de silencio do subcode 33 de julho, por outro caminho.
 *
 * Serve tambem de detector: quando trocarem de pixel de novo, isso mostra a
 * troca em vez de deixar a fila alimentando um dataset orfao.
 */
async function inventario() {
  const g = async (path: string) => {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
        `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    return (await r.json()) as any;
  };

  const contas = await g('me/adaccounts?fields=id,name,account_status&limit=50');
  if (contas?.error) return { error: contas.error.message };

  const porPixel: Record<string, { anuncios: number; contas: string[]; eventos: string[] }> = {};
  const resultado: Array<Record<string, unknown>> = [];

  for (const c of contas?.data ?? []) {
    const ads = await g(
      `${c.id}/adsets?fields=name,effective_status,optimization_goal,promoted_object,destination_type&limit=200`,
    );
    if (ads?.error) {
      resultado.push({ conta: c.name, id: c.id, erro: ads.error.message });
      continue;
    }
    const ativos = (ads?.data ?? []).filter((a: any) => a.effective_status === 'ACTIVE');
    const semPixel: string[] = [];
    // Conjunto ativo sem pixel nao e erro: campanha de clique-para-WhatsApp
    // otimiza por conversa, nao por evento de site. Mas precisa aparecer, senao
    // a leitura fica "a CAPI cobre as campanhas" quando cobre uma fracao delas.
    const metasSemPixel: Record<string, number> = {};

    for (const a of ativos) {
      const pid = a?.promoted_object?.pixel_id;
      if (!pid) {
        semPixel.push(a.name);
        // `destination_type` decide se o lead nasce num formulario da Meta
        // (ON_AD) ou cai no WhatsApp/Messenger. Sem isso nao da para saber se
        // existe lead preso na Meta que nunca chegou ao CRM.
        const meta = `${a?.optimization_goal || 'sem_objetivo'} -> ${a?.destination_type || 'sem_destino'}`;
        metasSemPixel[meta] = (metasSemPixel[meta] ?? 0) + 1;
        continue;
      }
      const slot = (porPixel[pid] ??= { anuncios: 0, contas: [], eventos: [] });
      slot.anuncios += 1;
      if (!slot.contas.includes(c.name)) slot.contas.push(c.name);
      const ev = a?.promoted_object?.custom_event_type || a?.optimization_goal;
      if (ev && !slot.eventos.includes(ev)) slot.eventos.push(ev);
    }

    resultado.push({
      conta: c.name,
      id: c.id,
      status_conta: c.account_status,
      conjuntos_total: (ads?.data ?? []).length,
      conjuntos_ativos: ativos.length,
      ativos_sem_pixel: semPixel.length,
      objetivo_dos_sem_pixel: metasSemPixel,
    });
  }

  return { contas: resultado, uso_por_dataset: porPixel, dataset_configurado: CAPI_DATASET_ID };
}

/**
 * Formularios instantaneos das campanhas ativas e quantos leads eles ja
 * coletaram.
 *
 * Existe porque `destination_type: ON_AD` quer dizer que o lead nasce DENTRO da
 * Meta -- e o CRM nao tem nenhuma via de Lead Ads (`leads.facebook_lead_id`: 0
 * preenchidos em 23.426). Ou alguem baixa CSV a mao, ou tem lead parado la que
 * nunca virou atendimento. Isto mede qual das duas.
 */
async function formularios() {
  const g = async (path: string) => {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}` +
        `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    return (await r.json()) as any;
  };

  const contas = await g('me/adaccounts?fields=id,name&limit=50');
  if (contas?.error) return { error: contas.error.message };

  const paginas = new Map<string, string[]>();
  for (const c of contas?.data ?? []) {
    const ads = await g(`${c.id}/adsets?fields=name,effective_status,promoted_object,destination_type&limit=200`);
    for (const a of ads?.data ?? []) {
      if (a?.effective_status !== 'ACTIVE' || a?.destination_type !== 'ON_AD') continue;
      const pid = a?.promoted_object?.page_id;
      if (!pid) continue;
      const lista = paginas.get(pid) ?? [];
      if (!lista.includes(c.name)) lista.push(c.name);
      paginas.set(pid, lista);
    }
  }

  // Gasto e resultado dos ultimos 30 dias: dimensiona o achado. "Pode haver lead
  // parado na Meta" e diferente de "R$ X estao comprando lead que ninguem atende".
  const gasto: Array<Record<string, unknown>> = [];
  for (const c of contas?.data ?? []) {
    const ins = await g(`${c.id}/insights?fields=spend,actions,cost_per_action_type&date_preset=last_30d`);
    if (ins?.error) {
      gasto.push({ conta: c.name, erro: ins.error.message });
      continue;
    }
    const linha = (ins?.data ?? [])[0] || {};
    const acoes = (linha.actions ?? []).filter((a: any) => String(a.action_type).includes('lead'));
    gasto.push({
      conta: c.name,
      gasto_30d: linha.spend ?? '0',
      leads_30d: acoes.map((a: any) => `${a.action_type}=${a.value}`),
    });
  }

  const resultado: Array<Record<string, unknown>> = [];
  for (const [pageId, dono] of paginas) {
    const f = await g(`${pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=100`);
    if (f?.error) {
      resultado.push({ page_id: pageId, contas: dono, erro: f.error.message, codigo: f.error.code });
      continue;
    }
    const forms = (f?.data ?? []).map((x: any) => ({
      id: x.id,
      nome: x.name,
      status: x.status,
      leads: x.leads_count ?? null,
    }));
    resultado.push({
      page_id: pageId,
      contas: dono,
      formularios: forms.length,
      leads_totais: forms.reduce((t: number, x: any) => t + (x.leads || 0), 0),
      detalhe: forms.sort((a: any, b: any) => (b.leads || 0) - (a.leads || 0)).slice(0, 15),
    });
  }
  return { paginas: resultado, gasto_por_conta: gasto };
}

/**
 * Checa a credencial sem gastar evento: /me diz se o token vive.
 *
 * `datasetAlvo` serve para sondar um dataset diferente do configurado, sem
 * mexer em env var -- serve para escolher entre dois candidatos antes de
 * apontar a producao para um deles. Sondagem assim NAO grava em
 * meta_capi_status: o status oficial e do dataset que esta em uso.
 */
async function probe(datasetAlvo?: string) {
  const dataset = datasetAlvo || CAPI_DATASET_ID;
  const persistir = !datasetAlvo;

  if (!CAPI_TOKEN || !dataset) {
    if (persistir) {
      await registraStatusCredencial({
        token_valido: false,
        erro: 'META_CAPI_ACCESS_TOKEN ou META_CAPI_DATASET_ID ausente no ambiente',
      });
    }
    return { token_valido: false, erro: 'credencial nao configurada no Railway' };
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    const j: any = await r.json();
    if (j?.error) {
      if (persistir) {
        await registraStatusCredencial({ token_valido: false, erro: `${j.error.code}: ${j.error.message}` });
      }
      return { token_valido: false, erro: j.error.message, codigo: j.error.code };
    }

    // Token vivo nao basta: precisa enxergar o dataset. Foi exatamente essa a
    // pegadinha de julho (subcode 33 = token valido SEM permissao no pixel).
    //
    // Só `id,name` aqui: pedir `owner_business` no mesmo fields devolve
    // "(#100) Missing Permission" mesmo quando o acesso ao dataset existe, e aí
    // o erro passa a mentir sobre a causa. Custou tempo em 03/09/2026.
    const rd = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${dataset}?fields=id,name&access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    const jd: any = await rd.json();
    if (jd?.error) {
      const diag = await diagnosticaAcesso(dataset);
      if (persistir) {
        await registraStatusCredencial({
          token_valido: true,
          app_id: j?.id ?? null,
          erro: `token vivo mas sem acesso ao dataset ${dataset}: ${jd.error.message} | ${diag.diagnostico}`,
        });
      }
      return { token_valido: true, dataset, dataset_acessivel: false, erro: jd.error.message, ...diag };
    }

    if (persistir) {
      await registraStatusCredencial({ token_valido: true, app_id: j?.id ?? null, erro: null });
    }
    return {
      token_valido: true,
      dataset,
      dataset_acessivel: true,
      dataset_nome: jd?.name,
      identidade: j?.name ?? j?.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (persistir) await registraStatusCredencial({ token_valido: false, erro: msg });
    return { token_valido: false, erro: msg };
  }
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { modo, dry_run, limite, test_event_code, dataset_id } = (req.body || {}) as {
      modo?: 'probe' | 'inventario' | 'religar' | 'formularios';
      dry_run?: boolean;
      limite?: number;
      test_event_code?: string;
      dataset_id?: string;
    };

    if (modo === 'probe') return res.status(200).json({ modo: 'probe', ...(await probe(dataset_id)) });
    if (modo === 'inventario') return res.status(200).json({ modo: 'inventario', ...(await inventario()) });
    if (modo === 'formularios') return res.status(200).json({ modo: 'formularios', ...(await formularios()) });

    // Religa o que foi congelado por erro sem volta, depois que a causa mudou
    // (token novo, valor configurado). Sem isso a linha ficaria fora da fila
    // para sempre e o evento se perderia em silencio -- justamente o que esta
    // fila existe para impedir.
    if (modo === 'religar') {
      const { data, error: erroReligar } = await supabase
        .from('meta_capi_events')
        .update({ tentativas: 0, proxima_tentativa_em: null, motivo_skip: null } as any)
        .eq('status', 'failed')
        .gte('tentativas', MAX_TENTATIVAS)
        .select('id');
      if (erroReligar) return res.status(500).json({ error: erroReligar.message });
      return res.status(200).json({ modo: 'religar', religados: data?.length ?? 0 });
    }

    const tamanho = Math.min(Math.max(Number(limite) || LOTE_PADRAO, 1), 500);
    const agora = new Date().toISOString();

    const { data: fila, error } = await supabase
      .from('meta_capi_events')
      .select('*')
      .in('status', ['pending', 'failed'])
      .lt('tentativas', MAX_TENTATIVAS)
      .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${agora}`)
      .order('enfileirado_em', { ascending: true })
      .limit(tamanho);

    if (error) return res.status(500).json({ error: error.message });
    if (!fila || fila.length === 0) {
      return res.status(200).json({ drenados: 0, mensagem: 'fila vazia' });
    }

    const eventos = (fila as any[]).map((f) => ({
      event_name: f.event_name,
      event_id: f.event_id,
      event_time: eventTimeSeguro(f.event_time),
      action_source: f.action_source || 'system_generated',
      user_data: f.user_data_hash || {},
      ...(f.custom_data && Object.keys(f.custom_data).length ? { custom_data: f.custom_data } : {}),
    }));

    if (dry_run) {
      return res.status(200).json({
        dry_run: true,
        na_fila: fila.length,
        dataset_id: CAPI_DATASET_ID || '(não configurado)',
        versao: GRAPH_VERSION,
        amostra: eventos.slice(0, 3),
      });
    }

    const r = await enviaParaMeta(eventos, test_event_code);
    const ids = (fila as any[]).map((f) => f.id);

    if (r.ok) {
      await supabase
        .from('meta_capi_events')
        .update({
          status: 'sent',
          enviado_em: new Date().toISOString(),
          http_status: r.http_status,
          events_received: r.events_received,
          fbtrace_id: r.fbtrace_id,
          resposta: r.corpo as any,
          proxima_tentativa_em: null,
        } as any)
        .in('id', ids);
      await registraStatusCredencial({ token_valido: true, erro: null, sucesso: true });

      // Mantém o carimbo antigo coerente: `sync-funnel-status-from-sheet` usa
      // `leads.capi_purchase_sent_at` como trava de idempotência dele.
      const leadsPurchase = (fila as any[])
        .filter((f) => f.event_name === 'Purchase' && f.lead_id)
        .map((f) => f.lead_id);
      if (leadsPurchase.length) {
        await supabase
          .from('leads')
          .update({ capi_purchase_sent_at: new Date().toISOString() } as any)
          .in('id', leadsPurchase)
          .is('capi_purchase_sent_at', null);
      }

      console.log(`[capi:dispatch] ${fila.length} enviados, recebidos=${r.events_received}`);
      return res.status(200).json({
        drenados: fila.length,
        events_received: r.events_received,
        fbtrace_id: r.fbtrace_id,
        ...(test_event_code ? { test_event_code } : {}),
      });
    }

    // Falhou: backoff exponencial por linha, erro preservado para o painel.
    //
    // Congelar NAO e `proxima_tentativa_em = null`: o filtro da fila trata null
    // como elegivel (e o estado de quem acabou de entrar), entao null devolvia a
    // linha para a rodada seguinte -- o oposto do que a doc dizia. Congela-se
    // esgotando `tentativas`, que e o que o filtro `.lt(MAX_TENTATIVAS)` exclui.
    // Religar depois de corrigir a causa: { modo: 'religar' }.
    const semVolta = r.credencial_morta || r.erro_definitivo;
    const motivo = r.credencial_morta
      ? 'credencial invalida: renovar token e religar'
      : `recusado pela Meta, corpo precisa mudar: ${
          (r.corpo as any)?.error?.error_user_title || (r.corpo as any)?.error?.message || 'erro 400'
        }`;

    for (const f of fila as any[]) {
      const tentativas = semVolta ? MAX_TENTATIVAS : (f.tentativas || 0) + 1;
      const esperaMin = Math.min(2 ** tentativas * 5, 240);
      await supabase
        .from('meta_capi_events')
        .update({
          status: 'failed',
          tentativas,
          http_status: r.http_status,
          fbtrace_id: r.fbtrace_id,
          resposta: r.corpo as any,
          ...(semVolta ? { motivo_skip: motivo } : {}),
          proxima_tentativa_em: semVolta
            ? null
            : new Date(Date.now() + esperaMin * 60_000).toISOString(),
        } as any)
        .eq('id', f.id);
    }

    if (r.credencial_morta) {
      const erro = (r.corpo as any)?.error?.message || (r.corpo as any)?.erro || 'credencial inválida';
      await registraStatusCredencial({ token_valido: false, erro });
      console.error(`[capi:dispatch] CREDENCIAL MORTA — ${fila.length} eventos congelados: ${erro}`);
    }

    return res.status(200).json({
      drenados: 0,
      falharam: fila.length,
      credencial_morta: r.credencial_morta,
      http_status: r.http_status,
      erro: r.corpo,
    });
  } catch (err) {
    console.error('[meta-capi-dispatch]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

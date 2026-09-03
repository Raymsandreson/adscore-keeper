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
      modo?: 'probe';
      dry_run?: boolean;
      limite?: number;
      test_event_code?: string;
      dataset_id?: string;
    };

    if (modo === 'probe') return res.status(200).json({ modo: 'probe', ...(await probe(dataset_id)) });

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
    for (const f of fila as any[]) {
      const tentativas = (f.tentativas || 0) + 1;
      const esperaMin = Math.min(2 ** tentativas * 5, 240);
      await supabase
        .from('meta_capi_events')
        .update({
          status: 'failed',
          tentativas,
          http_status: r.http_status,
          fbtrace_id: r.fbtrace_id,
          resposta: r.corpo as any,
          // Credencial morta não se resolve com retry: congela até alguém agir.
          proxima_tentativa_em: r.credencial_morta
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

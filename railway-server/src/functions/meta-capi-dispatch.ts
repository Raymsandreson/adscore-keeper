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

/** Checa a credencial sem gastar evento: /me diz se o token vive. */
async function probe() {
  if (!CAPI_TOKEN || !CAPI_DATASET_ID) {
    await registraStatusCredencial({
      token_valido: false,
      erro: 'META_CAPI_ACCESS_TOKEN ou META_CAPI_DATASET_ID ausente no ambiente',
    });
    return { token_valido: false, erro: 'credencial não configurada no Railway' };
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    const j: any = await r.json();
    if (j?.error) {
      await registraStatusCredencial({ token_valido: false, erro: `${j.error.code}: ${j.error.message}` });
      return { token_valido: false, erro: j.error.message, codigo: j.error.code };
    }

    // Token vivo não basta: precisa enxergar o dataset. Foi exatamente essa a
    // pegadinha de julho (subcode 33 = token válido SEM permissão no pixel).
    const rd = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${CAPI_DATASET_ID}?fields=id,name,owner_business&access_token=${encodeURIComponent(CAPI_TOKEN)}`,
    );
    const jd: any = await rd.json();
    if (jd?.error) {
      await registraStatusCredencial({
        token_valido: true,
        app_id: j?.id ?? null,
        erro: `token vivo mas sem acesso ao dataset ${CAPI_DATASET_ID}: ${jd.error.message}`,
      });
      return { token_valido: true, dataset_acessivel: false, erro: jd.error.message };
    }

    await registraStatusCredencial({ token_valido: true, app_id: j?.id ?? null, erro: null });
    return { token_valido: true, dataset_acessivel: true, dataset: jd?.name, identidade: j?.name ?? j?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await registraStatusCredencial({ token_valido: false, erro: msg });
    return { token_valido: false, erro: msg };
  }
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { modo, dry_run, limite, test_event_code } = (req.body || {}) as {
      modo?: 'probe';
      dry_run?: boolean;
      limite?: number;
      test_event_code?: string;
    };

    if (modo === 'probe') return res.status(200).json({ modo: 'probe', ...(await probe()) });

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

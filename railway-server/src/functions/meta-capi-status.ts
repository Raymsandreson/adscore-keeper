// Leitura do painel da Meta CAPI.
//
// `meta_capi_events` tem RLS sem policy: a sessão anônima do app não alcança a
// tabela. Quem lê é aqui, com service role, e devolve só agregado + linhas sem
// dado pessoal (a fila guarda hash, nunca e-mail ou telefone em claro).
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { CAPI_DATASET_ID, GRAPH_VERSION } from '../lib/metaCapi';

const SITUACOES = ['pending', 'sent', 'failed', 'skipped'] as const;

export const handler: RequestHandler = async (req, res) => {
  try {
    const { limite } = (req.body || {}) as { limite?: number };
    const nLinhas = Math.min(Math.max(Number(limite) || 50, 1), 200);

    const [credencial, ...contagens] = await Promise.all([
      supabase.from('meta_capi_status').select('*').eq('id', 1).maybeSingle(),
      ...SITUACOES.map((s) =>
        supabase.from('meta_capi_events').select('id', { count: 'exact', head: true }).eq('status', s),
      ),
    ]);

    const fila: Record<string, number> = {};
    SITUACOES.forEach((s, i) => {
      fila[s] = contagens[i]?.count ?? 0;
    });

    const { data: recentes } = await supabase
      .from('meta_capi_events')
      .select(
        'id, event_id, event_name, lead_id, origem, status, motivo_skip, match_keys, valor, valor_origem, tentativas, http_status, events_received, fbtrace_id, resposta, enfileirado_em, enviado_em',
      )
      .order('enfileirado_em', { ascending: false })
      .limit(nLinhas);

    // Motivos de falha agrupados: mostra se é uma causa só (credencial) ou várias.
    const { data: falhas } = await supabase
      .from('meta_capi_events')
      .select('resposta, motivo_skip')
      .eq('status', 'failed')
      .limit(500);

    // Ordem de preferencia importa: `error.message` da Meta e quase sempre
    // "Invalid parameter", que nao diz o que consertar. A propria Meta manda a
    // explicacao util em `error_user_title`/`error_user_msg` no mesmo corpo, e o
    // despachante ja grava a frase acionavel em `motivo_skip`. Este card e o
    // resumo que a pessoa le primeiro -- mostrar "Invalid parameter" aqui
    // desperdica o unico lugar da tela onde o motivo aparece agrupado.
    const porMotivo: Record<string, number> = {};
    for (const f of (falhas as any[]) || []) {
      const e = f?.resposta?.error;
      const m =
        f?.motivo_skip ||
        e?.error_user_title ||
        e?.error_user_msg ||
        e?.message ||
        f?.resposta?.erro ||
        'sem detalhe';
      porMotivo[String(m).slice(0, 160)] = (porMotivo[String(m).slice(0, 160)] || 0) + 1;
    }

    const c = credencial?.data as any;
    return res.status(200).json({
      credencial: {
        token_valido: c?.token_valido ?? null,
        dataset_id: c?.dataset_id ?? CAPI_DATASET_ID ?? null,
        erro: c?.erro ?? null,
        ultimo_probe_em: c?.ultimo_probe_em ?? null,
        ultimo_sucesso_em: c?.ultimo_sucesso_em ?? null,
        versao_graph: GRAPH_VERSION,
        configurada: Boolean(CAPI_DATASET_ID),
      },
      fila,
      falhas_por_motivo: Object.entries(porMotivo)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([motivo, eventos]) => ({ motivo, eventos })),
      recentes: recentes ?? [],
    });
  } catch (err) {
    console.error('[meta-capi-status]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

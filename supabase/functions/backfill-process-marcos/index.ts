// =============================================================================
// Backfill / re-extração de marcos processuais. Roda no Supabase EXTERNO
// (kmedldlepwiityjsdahz), onde vive ESCAVADOR_API_TOKEN.
//
// modo 'reextract' — usa as movimentações JÁ salvas em lead_processes.movimentacoes.
//                    Custo zero de API. Serve para reaplicar regras novas do parser.
// modo 'backfill'  — busca as movimentações no Escavador (1 chamada por CNJ),
//                    salva no processo e extrai os marcos.
//
// Processa em lotes: cada invocação atende `limit` processos e devolve
// `proximo_offset`. Quem chama é que decide continuar — evita estourar o tempo
// da edge e dá ponto de parada se a cota do Escavador acabar.
//
// Inserção é idempotente: unique (process_id, tipo_movimentacao, conteudo_hash)
// + ON CONFLICT DO NOTHING. Rodar duas vezes não duplica marco.
// NUNCA apaga nada — process_movements é append-only por design.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMarcos } from "../_shared/escavadorMarcos.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';
const LIMITE_MAXIMO = 100;
/** Respiro entre chamadas ao Escavador (rate limit da conta). */
const PAUSA_MS = 250;

interface Corpo {
  mode?: 'reextract' | 'backfill';
  limit?: number;
  offset?: number;
  /** Obrigatório em backfill: gasta cota da API. */
  confirm?: string;
  /** Restringe a um POP (lead_processes.workflow_id). */
  workflow_id?: string;
  dry_run?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const corpo: Corpo = await req.json().catch(() => ({}));
    const mode = corpo.mode ?? 'reextract';
    const limit = Math.min(Math.max(corpo.limit ?? 25, 1), LIMITE_MAXIMO);
    const offset = Math.max(corpo.offset ?? 0, 0);
    const dryRun = corpo.dry_run === true;

    if (mode === 'backfill' && corpo.confirm !== 'BACKFILL') {
      return json({
        success: false,
        error: 'backfill consome cota do Escavador — envie confirm: "BACKFILL"',
      }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = supabase
      .from('lead_processes')
      .select('id, process_number, case_id, lead_id, movimentacoes')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (corpo.workflow_id) query = query.eq('workflow_id', corpo.workflow_id);

    if (mode === 'backfill') {
      // Só quem tem CNJ dá para consultar.
      query = query.not('process_number', 'is', null);
    }

    const { data: processos, error: qErr } = await query;
    if (qErr) throw qErr;

    const token = Deno.env.get('ESCAVADOR_API_TOKEN');
    if (mode === 'backfill' && !token) {
      return json({ success: false, error: 'ESCAVADOR_API_TOKEN ausente' }, 500);
    }

    let comMovimentacoes = 0;
    let marcosExtraidos = 0;
    let marcosInseridos = 0;
    let semMovimentacao = 0;
    const erros: { process_number: string | null; erro: string }[] = [];

    for (const p of processos ?? []) {
      const cnj: string | null = p.process_number;
      let movs: unknown[] = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];

      if (mode === 'backfill') {
        if (!cnj) { semMovimentacao++; continue; }
        try {
          const url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(cnj)}/movimentacoes`;
          const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          });
          if (!resp.ok) {
            erros.push({ process_number: cnj, erro: `Escavador ${resp.status}` });
            await sleep(PAUSA_MS);
            continue;
          }
          const d = await resp.json();
          movs = d.items || d.data || (Array.isArray(d) ? d : []);

          if (!dryRun) {
            await supabase
              .from('lead_processes')
              .update({
                movimentacoes: movs,
                quantidade_movimentacoes: movs.length,
                data_ultima_verificacao: new Date().toISOString(),
              })
              .eq('id', p.id);
          }
          await sleep(PAUSA_MS);
        } catch (e) {
          erros.push({ process_number: cnj, erro: e instanceof Error ? e.message : String(e) });
          continue;
        }
      }

      if (!movs.length) { semMovimentacao++; continue; }
      comMovimentacoes++;

      const marcos = extractMarcos(movs as never[], { numeroCnj: cnj ?? undefined });
      marcosExtraidos += marcos.length;
      if (!marcos.length || dryRun) continue;

      const linhas = marcos.map((m) => ({
        process_id: p.id,
        case_id: p.case_id,
        lead_id: p.lead_id,
        numero_cnj: cnj,
        tipo_movimentacao: m.tipo_movimentacao,
        marco_ordem: m.marco_ordem,
        data_movimentacao: m.data_movimentacao,
        valor_indenizacao_fixado: m.valor_indenizacao_fixado,
        link_decisao: m.link_decisao,
        descricao: m.descricao,
        fonte: 'escavador',
        escavador_movimentacao_id: m.escavador_movimentacao_id,
        conteudo_hash: m.conteudo_hash,
      }));

      const { data: inseridas, error: insErr } = await supabase
        .from('process_movements')
        .upsert(linhas, {
          onConflict: 'process_id,tipo_movimentacao,conteudo_hash',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insErr) {
        erros.push({ process_number: cnj, erro: insErr.message });
        continue;
      }
      marcosInseridos += inseridas?.length ?? 0;
    }

    const lidos = processos?.length ?? 0;
    return json({
      success: true,
      mode,
      dry_run: dryRun,
      processos_lidos: lidos,
      com_movimentacoes: comMovimentacoes,
      sem_movimentacao: semMovimentacao,
      marcos_extraidos: marcosExtraidos,
      marcos_inseridos: marcosInseridos,
      erros,
      proximo_offset: lidos === limit ? offset + limit : null,
    });
  } catch (e) {
    console.error('backfill-process-marcos:', e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

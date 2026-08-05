// =============================================================================
// Backfill / re-extração de marcos processuais. Roda no Supabase EXTERNO
// (kmedldlepwiityjsdahz), onde vive ESCAVADOR_API_TOKEN.
//
// modo 'reextract' — usa as movimentações JÁ salvas em lead_processes.movimentacoes.
//                    Custo zero de API. Serve para reaplicar regras novas do parser.
// modo 'backfill'  — busca as movimentações no Escavador (1 chamada por CNJ),
//                    salva no processo e extrai os marcos.
// modo 'push'      — MESMO que backfill, mas só nos processos que apareceram no
//                    push do e-mail nos últimos `dias` (processual_emails). É o
//                    modo do dia a dia: consulta só quem se mexeu (8 a 40 por dia
//                    em vez de 780) e mantém marcos e movimentações em dia.
//
// Processa em lotes: cada invocação atende `limit` processos e devolve
// `proximo_offset`. Quem chama é que decide continuar — evita estourar o tempo
// da edge e dá ponto de parada se a cota do Escavador acabar.
//
// Desde 05/08/2026 o que o parser de palavra-chave classifica passa por REVISÃO
// POR IA antes de entrar (usar_ia, ligada por padrão). Motivo: auditoria das 603
// linhas classificáveis mostrou 51% erradas — o parser não distingue a decisão
// do ato da parte que a provoca nem do expediente que a publica. E o problema é
// corrente, não histórico: 595 dos 631 marcos nasceram nos últimos 30 dias.
//
// Inserção é idempotente: unique (process_id, tipo_movimentacao, conteudo_hash)
// + ON CONFLICT DO NOTHING. Rodar duas vezes não duplica marco. Movimentação já
// julgada antes (virou marco OU foi descartada) é pulada — senão o sync
// recriaria o que a IA acabou de descartar.
// NUNCA apaga nada — process_movements é append-only por design.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMarcos } from "../_shared/escavadorMarcos.ts";
import { geminiChat } from "../_shared/gemini.ts";
import { revisarMarcosComIA } from "../_shared/marcosIA.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';
const LIMITE_MAXIMO = 100;
/** Respiro entre chamadas ao Escavador (rate limit da conta). */
const PAUSA_MS = 250;

interface Corpo {
  mode?: 'reextract' | 'backfill' | 'push';
  limit?: number;
  offset?: number;
  /** Obrigatório em backfill: gasta cota da API. */
  confirm?: string;
  /** Restringe a um POP (lead_processes.workflow_id). */
  workflow_id?: string;
  /** Só no modo push: janela de e-mails a considerar (padrão 1 = hoje). */
  dias?: number;
  dry_run?: boolean;
  /** Revisão por IA do que o parser de palavra-chave classificou. Padrão: ligada.
   *  Desligar só pra comparar comportamentos — o parser sozinho errava 51% (05/08/2026). */
  usar_ia?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO. O Escavador só entende esse formato —
// processo administrativo guarda número de requerimento em process_number e a
// consulta voltava 422 (206 desperdiçadas no backfill de 30/07/2026).
const CNJ_RE = /^\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const ehCnj = (s: string | null | undefined) => !!s && CNJ_RE.test(s.trim());

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

    // backfill varre a base inteira e gasta cota — exige confirmação explícita.
    // push é dirigido pelo e-mail do dia (dezenas, não centenas), roda no cron.
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

    let cnjsDoPush: string[] | null = null;
    if (mode === 'push') {
      const dias = Math.min(Math.max(corpo.dias ?? 1, 1), 30);
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

      const { data: emails, error: eErr } = await supabase
        .from('processual_emails')
        .select('process_number')
        .is('deleted_at', null)
        .not('process_number', 'is', null)
        .gte('received_at', desde);
      if (eErr) throw eErr;

      cnjsDoPush = [...new Set(
        (emails ?? []).map((e: { process_number: string }) => e.process_number).filter(ehCnj),
      )];

      if (cnjsDoPush.length === 0) {
        return json({
          success: true, mode, dias,
          processos_lidos: 0, com_movimentacoes: 0, sem_movimentacao: 0,
          marcos_extraidos: 0, marcos_inseridos: 0, erros: [], proximo_offset: null,
          detalhe: 'nenhum processo com CNJ no push da janela',
        });
      }
    }

    let query = supabase
      .from('lead_processes')
      .select('id, process_number, case_id, lead_id, movimentacoes')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (corpo.workflow_id) query = query.eq('workflow_id', corpo.workflow_id);
    if (mode !== 'reextract') query = query.not('process_number', 'is', null);
    if (cnjsDoPush) query = query.in('process_number', cnjsDoPush);

    const { data: processos, error: qErr } = await query;
    if (qErr) throw qErr;

    const token = Deno.env.get('ESCAVADOR_API_TOKEN');
    const consultaApi = mode === 'backfill' || mode === 'push';
    if (consultaApi && !token) {
      return json({ success: false, error: 'ESCAVADOR_API_TOKEN ausente' }, 500);
    }

    const usarIa = corpo.usar_ia !== false;
    let comMovimentacoes = 0;
    let marcosExtraidos = 0;
    let marcosInseridos = 0;
    let semMovimentacao = 0;
    let semCnj = 0;
    let iaDescartou = 0;
    let iaCorrigiu = 0;
    let jaJulgados = 0;
    const erros: { process_number: string | null; erro: string }[] = [];

    for (const p of processos ?? []) {
      const cnj: string | null = p.process_number;
      let movs: unknown[] = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];

      if (consultaApi) {
        // Número que não é CNJ (requerimento administrativo) volta 422 — nem tenta.
        if (!ehCnj(cnj)) { semCnj++; continue; }
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

      let marcos = extractMarcos(movs as never[], { numeroCnj: cnj ?? undefined });

      // Movimentação já julgada (virou marco OU foi descartada) não volta pra
      // fila: sem isto, uma linha que a IA descartou seria recriada no próximo
      // sync, e a correção não pararia em pé.
      if (marcos.length) {
        const { data: existentes } = await supabase
          .from('process_movements')
          .select('escavador_movimentacao_id')
          .eq('process_id', p.id)
          .not('escavador_movimentacao_id', 'is', null);
        const vistos = new Set((existentes ?? []).map((e: { escavador_movimentacao_id: string }) => e.escavador_movimentacao_id));
        const antes = marcos.length;
        marcos = marcos.filter((m) => !m.escavador_movimentacao_id || !vistos.has(m.escavador_movimentacao_id));
        jaJulgados += antes - marcos.length;
      }

      if (marcos.length && usarIa) {
        try {
          const rev = await revisarMarcosComIA(marcos, movs as never[], { chat: geminiChat as never });
          marcos = rev.marcos;
          iaDescartou += rev.descartados;
          iaCorrigiu += rev.corrigidos;
        } catch (e) {
          // Falha de IA não pode derrubar o sync: fica o que o parser achou.
          erros.push({ process_number: cnj, erro: `IA: ${e instanceof Error ? e.message : String(e)}` });
        }
      }

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
      processos_no_push: cnjsDoPush?.length ?? null,
      processos_lidos: lidos,
      com_movimentacoes: comMovimentacoes,
      sem_movimentacao: semMovimentacao,
      sem_cnj: semCnj,
      marcos_extraidos: marcosExtraidos,
      marcos_inseridos: marcosInseridos,
      usar_ia: usarIa,
      ia_descartou: iaDescartou,
      ia_corrigiu: iaCorrigiu,
      ja_julgados: jaJulgados,
      erros,
      proximo_offset: lidos === limit ? offset + limit : null,
    });
  } catch (e) {
    console.error('backfill-process-marcos:', e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// =============================================================================
// radar-processos-quietos — fecha o buraco que o caso 1017247-47.2025.4.01.3100
// escancarou em 30/08/2026: a juntada de réplica de 03/08 só chegou ao banco em
// 30/08, porque (a) juntada não sai no Diário → o e-mail push nunca veria,
// (b) o DataJud não tinha o processo, e (c) a cópia do PRÓPRIO Escavador estava
// parada em 08/07 — e ninguém nunca pediu atualização (jm_esc_solicitacoes: 0
// linhas para o CNJ). O prazo automático nasceu 53 dias atrasado por isso.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz). Cron: 2x/dia (09h e 17h UTC)
// — a rodada da manhã pede as atualizações pagas; a da tarde colhe o resultado
// e cria os prazos no mesmo dia.
//
// Até 01/09/2026 esta função só existia deployada — não havia cópia no repo.
// Está versionada agora por isso, junto com o ajuste da etapa 4.
//
// FLUXO POR RODADA
//   1. Follow-up: solicitações pagas SOLICITADO com 45min+ → re-consulta o
//      cache; se a movimentação mais nova avançou, marca ATUALIZADO e chama
//      sync-process-compromissos na hora (prazo nasce hoje, não amanhã).
//   2. Lista quente (rpc radar_processos_quentes), em ordem de urgência:
//        email_recente  — e-mail push nos últimos 2 dias e movimentações salvas
//                         mais velhas que o e-mail (Escavador atrasado — o caso
//                         Sidiney era exatamente este em 10/07)
//        prazo_proximo  — atividade aberta vence em ≤7 dias e movimentação >7d
//        mov_estagnada  — atividade aberta e movimentação parada ≥20 dias
//   3. Re-consulta GRATUITA do cache (backfill-process-marcos, process_ids).
//      Quem andou → sync-process-compromissos imediato. Custo zero de crédito.
//   4. Só quem CONTINUA parado vira solicitação PAGA (esc-autos acao=solicitar,
//      corpo {} = atualização do tribunal sem documentos — a mais barata),
//      respeitando A FILA (ver abaixo), cooldown por motivo (3/7/30 dias) e
//      teto por rodada. Cada solicitação grava linha em radar_atualizacoes com
//      os créditos que o Escavador cobrou (header Creditos-Utilizados).
//
// A FILA TEM PRECEDÊNCIA (01/09/2026): existe um SEGUNDO caminho pedindo as
// mesmas atualizações — o push de e-mail enfileira em jm_esc_solicitacoes e
// jm_esc_rotina dispara a cada 20 min. O radar não olhava para essa tabela, e
// pagava a viagem de novo para quem a fila já tinha atualizado: na rodada das
// 09h de 01/09, 12 dos 15 pedidos voltaram 422 "Esse processo já foi atualizado
// hoje". Agora quem está na mão da fila (A_ENVIAR/ENVIANDO/PENDENTE) ou já foi
// concluído hoje por ela é pulado — sem crédito e sem chamada.
//
// Não mexe em nenhuma função existente: só chama backfill-process-marcos,
// esc-autos e sync-process-compromissos, todas já em produção.
//
// ROLLBACK (<5min): select cron.unschedule('radar-processos-quietos');
// e apagar/ignorar esta função. Nada mais depende dela.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/** Mesmo guard hardcoded da esc-autos (ver supabase/functions/esc-autos). */
const GUARD = "lp-esc-2026-df3";

/** Dias mínimos entre duas solicitações pagas do MESMO CNJ, por motivo.
 *  mov_estagnada longo de propósito: processo quieto de verdade (JEF esperando
 *  sentença) não pode virar cobrança recorrente — 335 estavam assim em 30/08. */
const COOLDOWN_DIAS: Record<string, number> = {
  email_recente: 3,
  prazo_proximo: 7,
  mov_estagnada: 30,
};

/** Status da fila que significam "esse CNJ já está sendo cuidado por lá". */
const FILA_EM_ANDAMENTO = ["A_ENVIAR", "ENVIANDO", "PENDENTE"];

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

/** A fila grava o CNJ com máscara e o radar recebe do rpc; comparar só dígitos
 *  é o que jm_esc_reabrir_por_cnj já faz do lado do banco. */
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

interface Quente {
  process_id: string;
  processo_cnj: string;
  mov_mais_nova: string | null;
  prazo_proximo: string | null;
  motivo: string;
}

Deno.serve(async (req) => {
  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = corpo.dry_run === true;
    /** Re-consultas gratuitas por rodada. 40 × 2 rodadas drena o atraso de
     *  ~400 processos medido em 30/08 em ~5 dias, sem estourar o wall-clock. */
    const maxRefetch = Math.min(Math.max(Number(corpo.max_refetch ?? 40), 1), 100);
    /** Teto de solicitações PAGAS por rodada (2 rodadas/dia). */
    const maxSolicitacoes = Math.min(Math.max(Number(corpo.max_solicitacoes ?? 15), 0), 50);
    const staleDias = Math.max(Number(corpo.stale_dias ?? 20), 5);
    const prazoJanelaDias = Math.max(Number(corpo.prazo_janela_dias ?? 7), 1);

    const url = (Deno.env.get("SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    if (!url || !key) return json({ success: false, error: "SUPABASE_URL/SERVICE_ROLE_KEY ausentes" }, 500);
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const chamaFn = async (nome: string, body: unknown, query = "") => {
      const r = await fetch(`${url}/functions/v1/${nome}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      let parsed: unknown = t.slice(0, 800);
      try { parsed = JSON.parse(t); } catch { /* texto mesmo */ }
      return { ok: r.ok, status: r.status, body: parsed as Record<string, unknown> };
    };

    /** Movimentação mais nova SALVA de cada processo (max sobre o array — não
     *  confia na ordem do jsonb). */
    const movMaisNova = async (ids: string[]) => {
      const mapa = new Map<string, string | null>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await sb.rpc("radar_mov_mais_nova", { p_ids: ids.slice(i, i + 100) });
        if (error) throw error;
        for (const r of (data ?? []) as { process_id: string; mov_mais_nova: string | null }[]) {
          mapa.set(r.process_id, r.mov_mais_nova);
        }
      }
      return mapa;
    };

    /** Re-consulta gratuita: o backfill busca o CACHE do Escavador, salva
     *  movimentações + capa e extrai marcos. Lotes de 20 pelo wall-clock. */
    const refetch = async (ids: string[]) => {
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20);
        const r = await chamaFn("backfill-process-marcos", {
          mode: "backfill", process_ids: lote, limit: lote.length,
        });
        if (!r.ok) console.error("backfill falhou no lote", i / 20, r.status, r.body);
      }
    };

    const criaPrazos = async (ids: string[]) => {
      for (const pid of [...new Set(ids)]) {
        const r = await chamaFn("sync-process-compromissos", { process_id: pid });
        if (!r.ok) console.error("sync-process-compromissos falhou", pid, r.status);
      }
    };

    const resumo: Record<string, unknown> = { success: true, dry_run: dryRun };

    // ── 1. Follow-up das solicitações pagas pendentes ─────────────────────
    const { data: pendentes, error: pErr } = await sb
      .from("radar_atualizacoes")
      .select("id, process_id, processo_cnj, mov_mais_nova_antes, solicitado_em")
      .eq("status", "SOLICITADO")
      .lt("solicitado_em", new Date(Date.now() - 45 * 60_000).toISOString())
      .order("solicitado_em", { ascending: true })
      .limit(60);
    if (pErr) throw pErr;

    let followupAtualizadas = 0;
    if ((pendentes?.length ?? 0) > 0 && !dryRun) {
      const ids = [...new Set(pendentes!.map((p) => p.process_id))];
      await refetch(ids);
      const agora = await movMaisNova(ids);
      const andaram: string[] = [];
      for (const p of pendentes!) {
        const nova = agora.get(p.process_id) ?? null;
        const avancou = !!nova && (!p.mov_mais_nova_antes || nova > p.mov_mais_nova_antes);
        const expirou = Date.now() - new Date(p.solicitado_em).getTime() > 7 * 86_400_000;
        if (avancou) {
          await sb.from("radar_atualizacoes")
            .update({ status: "ATUALIZADO", verificado_em: new Date().toISOString() }).eq("id", p.id);
          andaram.push(p.process_id);
          followupAtualizadas++;
        } else if (expirou) {
          await sb.from("radar_atualizacoes")
            .update({ status: "SEM_MUDANCA", verificado_em: new Date().toISOString() }).eq("id", p.id);
        }
      }
      await criaPrazos(andaram);
    }
    resumo.followup = { pendentes: pendentes?.length ?? 0, atualizadas: followupAtualizadas };

    // ── 2. Lista quente ───────────────────────────────────────────────────
    const { data: quentesRaw, error: qErr } = await sb.rpc("radar_processos_quentes", {
      p_stale_dias: staleDias, p_prazo_dias: prazoJanelaDias, p_max: maxRefetch,
    });
    if (qErr) throw qErr;
    const quentes = (quentesRaw ?? []) as Quente[];
    const porMotivo: Record<string, number> = {};
    for (const q of quentes) porMotivo[q.motivo] = (porMotivo[q.motivo] ?? 0) + 1;
    resumo.quentes = { total: quentes.length, por_motivo: porMotivo };

    if (dryRun || quentes.length === 0) {
      return json({ ...resumo, amostra: quentes.slice(0, 10) });
    }

    // ── 3. Re-consulta gratuita do cache ──────────────────────────────────
    const idsQuentes = quentes.map((q) => q.process_id);
    await refetch(idsQuentes);
    const depois = await movMaisNova(idsQuentes);
    const andaram = quentes.filter((q) => {
      const n = depois.get(q.process_id);
      return !!n && (!q.mov_mais_nova || n > q.mov_mais_nova);
    });
    await criaPrazos(andaram.map((q) => q.process_id));
    resumo.refetch = { consultados: idsQuentes.length, andaram: andaram.length };

    // ── 4. Solicitação paga só para quem continua parado ──────────────────
    const andou = new Set(andaram.map((q) => q.process_id));
    const parados = quentes.filter((q) => !andou.has(q.process_id));

    // 4a. A FILA VEM PRIMEIRO. Ler jm_esc_solicitacoes inteira é barato (544
    // linhas em 01/09/2026) e evita depender do formato exato do CNJ no .in().
    // Só colunas que existem desde 20260811163000 — nada de enviado_em aqui,
    // para esta função não depender da migration da fila estar aplicada.
    //
    // A JANELA DE 24h NÃO É DETALHE: "está na fila" só vale como promessa se a
    // fila andar. Ela ficou travada de 17/08 a 01/09 com as mesmas 15 linhas
    // girando e 30 nunca enviadas — sem a janela, cada uma dessas silenciaria o
    // radar para sempre, e o radar é justamente quem cobre o que o e-mail push
    // não vê. Fila parada há mais de um dia deixa de bloquear.
    const hoje0 = new Date();
    hoje0.setUTCHours(0, 0, 0, 0);
    const limiteFila = new Date(Date.now() - 24 * 3_600_000);
    const naMaoDaFila = new Set<string>();
    {
      const { data: fila, error: fErr } = await sb
        .from("jm_esc_solicitacoes")
        .select("processo_cnj, status, criado_em, concluido_em");
      if (fErr) {
        // Sem a fila não dá para saber o que já foi pedido. Falhar fechado
        // (não pedir nada) seria pior que o problema; falhar aberto repete o
        // 422, que não custa crédito. Fica registrado no log e no resumo.
        console.error("leitura de jm_esc_solicitacoes falhou", fErr.message);
        resumo.fila_indisponivel = fErr.message;
      }
      type LinhaFila = { processo_cnj: string; status: string; criado_em: string; concluido_em: string | null };
      for (const l of (fila ?? []) as LinhaFila[]) {
        const emAndamentoRecente = FILA_EM_ANDAMENTO.includes(l.status)
          && !!l.criado_em && new Date(l.criado_em) >= limiteFila;
        const concluidaHoje = !!l.concluido_em && new Date(l.concluido_em) >= hoje0;
        if (emAndamentoRecente || concluidaHoje) naMaoDaFila.add(soDigitos(l.processo_cnj));
      }
    }
    const livres = parados.filter((q) => !naMaoDaFila.has(soDigitos(q.processo_cnj)));
    const bloqueadosPelaFila = parados.length - livres.length;

    // 4b. Cooldown: última solicitação (qualquer status ≠ ERRO) por CNJ em 30 dias.
    const cnjsParados = livres.map((q) => q.processo_cnj);
    const ultimaPorCnj = new Map<string, string>();
    for (let i = 0; i < cnjsParados.length; i += 100) {
      const { data: prev } = await sb
        .from("radar_atualizacoes")
        .select("processo_cnj, solicitado_em")
        .in("processo_cnj", cnjsParados.slice(i, i + 100))
        .neq("status", "ERRO")
        .gte("solicitado_em", new Date(Date.now() - 30 * 86_400_000).toISOString());
      for (const r of prev ?? []) {
        const atual = ultimaPorCnj.get(r.processo_cnj);
        if (!atual || r.solicitado_em > atual) ultimaPorCnj.set(r.processo_cnj, r.solicitado_em);
      }
    }
    const elegiveis = livres.filter((q) => {
      const ultima = ultimaPorCnj.get(q.processo_cnj);
      if (!ultima) return true;
      const dias = (Date.now() - new Date(ultima).getTime()) / 86_400_000;
      return dias >= (COOLDOWN_DIAS[q.motivo] ?? 30);
    });

    let solicitadas = 0, erros = 0, creditosGastos = 0;
    for (const q of elegiveis.slice(0, maxSolicitacoes)) {
      // Corpo {} = atualização de capa+movimentações no tribunal, sem
      // documentos — o modo mais barato do /solicitar-atualizacao.
      const r = await chamaFn("esc-autos", { acao: "solicitar", cnj: q.processo_cnj, body: {} }, `?k=${GUARD}`);
      const respostaOk = r.ok && (r.body as { ok?: boolean })?.ok !== false;
      const creditos = Number((r.body as { creditos?: unknown })?.creditos) || null;
      if (creditos) creditosGastos += creditos;
      const { error: insErr } = await sb.from("radar_atualizacoes").insert({
        process_id: q.process_id,
        processo_cnj: q.processo_cnj,
        motivo: q.motivo,
        mov_mais_nova_antes: q.mov_mais_nova,
        status: respostaOk ? "SOLICITADO" : "ERRO",
        creditos,
        resposta: (r.body as Record<string, unknown>)?.resposta ?? r.body ?? null,
      });
      if (insErr) console.error("insert radar_atualizacoes falhou", q.processo_cnj, insErr.message);
      respostaOk ? solicitadas++ : erros++;
    }
    resumo.solicitacoes = {
      parados: parados.length,
      bloqueados_pela_fila: bloqueadosPelaFila,
      elegiveis: elegiveis.length,
      solicitadas, erros, creditos_gastos: creditosGastos, teto: maxSolicitacoes,
    };

    return json(resumo);
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

// =============================================================================
// esc-autos — ponte com a API v2 do Escavador. Roda no projeto EXTERNO
// (kmedldlepwiityjsdahz), NÃO no cloud. Deploy: supabase functions deploy
// esc-autos --project-ref kmedldlepwiityjsdahz.
//
// Até 21/08/2026 esta função só existia deployada — não havia cópia no repo, e
// quem lesse o código não tinha como saber que o acervo vinha do endpoint
// PÚBLICO. Está versionada agora por isso.
//
// AÇÕES
//   solicitar  POST /solicitar-atualizacao — dispara a consulta ao tribunal.
//              O corpo vem do chamador: {autos,utilizar_certificado} para autos
//              completos, {documentos_publicos} para o acervo público. Os dois
//              são mutuamente exclusivos no contrato da API.
//   status     GET  /status-atualizacao
//   autos      GET  /autos            — públicos E RESTRITOS (exige certificado)
//   docs       GET  /documentos-publicos — só públicos, fallback
//   arquivar   baixa os PDFs pendentes e sobe no bucket privado jm-autos
//   get        GET livre em /api/... (diagnóstico)
//
// TODA resposta ecoa `cnj`: jm_esc_confirmar casa a solicitação por esse campo.
// Antes casava por resposta.numero_cnj, que só existe no corpo de sucesso — e a
// solicitação que dava erro ficava ENVIANDO para sempre (9 linhas assim).
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GUARD = "lp-esc-2026-df3";
const HOST = "https://api.escavador.com";
const BUCKET = "jm-autos";
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const sbAdmin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// `documentos-publicos` devolve data como objeto {date}; `autos` devolve string.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizaItem(d: any, origem: string) {
  const data = typeof d?.data === "string" ? d.data : d?.data?.date ?? null;
  return {
    id: d?.id ?? null,
    titulo: d?.titulo ?? null,
    tipo: d?.tipo ?? "PUBLICO",
    data,
    paginas: d?.quantidade_paginas ?? null,
    extensao: d?.extensao_arquivo ?? null,
    link: d?.links?.api ?? null,
    origem,
  };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== GUARD) return new Response("forbidden", { status: 403 });
  const token = Deno.env.get("ESCAVADOR_API_TOKEN");
  if (!token) return json({ ok: false, motivo: "SECRET_AUSENTE" });
  const { acao, cnj, path, body: rawBody, limite, orcamento_ms, concorrencia } = await req.json();
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
  };

  // ── arquivar: PDF pendente -> bucket privado ──────────────────────────────
  // Lotes internos com concorrência limitada até esgotar a fila ou estourar o
  // orçamento de tempo. `cnj` opcional restringe a um processo.
  if (acao === "arquivar") {
    const lote = Math.min(Math.max(Number(limite ?? 60), 1), 200);
    const conc = Math.min(Math.max(Number(concorrencia ?? 8), 1), 20);
    const budgetMs = Math.min(Math.max(Number(orcamento_ms ?? 110000), 5000), 130000);
    const inicio = Date.now();
    const sb = sbAdmin();
    let sucesso = 0, falhas = 0, processados = 0;
    const amostra: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processarUm = async (d: any) => {
      processados++;
      try {
        const r = await fetch(d.link_api, { headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" } });
        const ct = r.headers.get("Content-Type") ?? "";
        if (!r.ok) throw new Error(`HTTP_${r.status} ct=${ct}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        const magic = new TextDecoder().decode(buf.slice(0, 5));
        if (!magic.startsWith("%PDF")) throw new Error(`NAO_PDF ct=${ct} magic=${JSON.stringify(magic)} bytes=${buf.length}`);
        const spath = `${d.processo_cnj}/${d.id}.pdf`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(spath, buf, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`UPLOAD:${upErr.message}`);
        const { error: updErr } = await sb.from("jm_documentos")
          .update({ storage_path: spath, stored_at: new Date().toISOString(), storage_error: null }).eq("id", d.id);
        if (updErr) throw new Error(`UPDATE:${updErr.message}`);
        sucesso++;
        if (amostra.length < 3) amostra.push({ id: d.id, bytes: buf.length, ct });
      } catch (e) {
        falhas++;
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        await sb.from("jm_documentos").update({ storage_error: msg }).eq("id", d.id);
        if (amostra.length < 3) amostra.push({ id: d.id, erro: msg });
      }
    };
    while (Date.now() - inicio < budgetMs) {
      let q = sb.from("jm_documentos").select("id, processo_cnj, link_api")
        .is("storage_path", null).is("storage_error", null).not("link_api", "is", null);
      if (cnj) q = q.eq("processo_cnj", cnj);
      const { data: docs, error: selErr } = await q.order("id").limit(lote);
      if (selErr) return json({ ok: false, cnj: cnj ?? null, motivo: "SELECT_FALHOU", erro: selErr.message, processados, sucesso, falhas });
      if (!docs || docs.length === 0) break;
      for (let i = 0; i < docs.length; i += conc) {
        await Promise.all(docs.slice(i, i + conc).map(processarUm));
        if (Date.now() - inicio >= budgetMs) break;
      }
    }
    const { count: restantes } = await sb.from("jm_documentos").select("id", { count: "exact", head: true })
      .is("storage_path", null).is("storage_error", null);
    return json({ ok: true, cnj: cnj ?? null, processados, sucesso, falhas, restantes: restantes ?? null, decorrido_ms: Date.now() - inicio, amostra });
  }

  // ── autos / docs: lista as peças, grava e fecha a solicitação ─────────────
  // A resposta é paginada (links.next). Antes o SQL raspava net._http_response
  // para inserir; com os autos isso não se sustenta — o payload é grande demais
  // e vem em várias páginas. Agora a gravação é aqui, via RPC idempotente.
  if (acao === "autos" || acao === "docs") {
    if (!cnj) return json({ ok: false, motivo: "CNJ_AUSENTE" });
    const endpoint = acao === "autos" ? "autos" : "documentos-publicos";
    const origem = acao === "autos" ? "escavador_autos" : "escavador_publico";
    const sb = sbAdmin();

    // O /autos responde 422 "você não tem permissão" em DOIS casos distintos:
    // credencial recusada pelo tribunal e atualização ainda em andamento. Sem
    // separar os dois, todo processo que a gente consultasse antes da hora
    // seria rebaixado para o modo público — perdendo justamente os restritos.
    // O status-atualizacao não custa crédito (medido: Creditos-Utilizados=0).
    if (acao === "autos") {
      const st = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/status-atualizacao`, { headers: h });
      if (st.ok) {
        const sj = await st.json();
        const ver = sj?.ultima_verificacao;
        if (ver?.status === "PENDENTE") {
          return json({ ok: false, cnj, acao, aguardando: true, motivo: "ATUALIZACAO_EM_ANDAMENTO" });
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itens: any[] = [];
    let proxima: string | null = `${HOST}/api/v2/processos/numero_cnj/${cnj}/${endpoint}?limit=100`;
    let paginas = 0;
    while (proxima && paginas < 30) {
      const r: Response = await fetch(proxima, { headers: h });
      if (!r.ok) {
        const erro = (await r.text()).slice(0, 400);
        // Sem permissão nos autos não é falha permanente: jm_esc_confirmar já
        // rebaixa para PUBLICOS, então aqui só devolvemos o diagnóstico.
        const rebaixa = acao === "autos" && r.status === 422;
        await sb.from("jm_esc_solicitacoes")
          .update(rebaixa
            ? { status: "A_ENVIAR", modo: "PUBLICOS", motivo_erro: erro }
            : { status: "ERRO", motivo_erro: erro })
          .eq("processo_cnj", cnj).eq("status", "PENDENTE");
        return json({ ok: false, cnj, acao, http_status: r.status, erro });
      }
      const j = await r.json();
      for (const d of j.items ?? []) itens.push(normalizaItem(d, origem));
      proxima = j?.links?.next ?? null;
      paginas++;
    }

    const { data: gravado, error: rpcErr } = await sb.rpc("jm_documentos_ingerir", { p_cnj: cnj, p_itens: itens });
    if (rpcErr) return json({ ok: false, cnj, acao, motivo: "INGESTAO_FALHOU", erro: rpcErr.message, total: itens.length });

    await sb.from("jm_esc_solicitacoes")
      .update({ status: "SUCESSO", concluido_em: new Date().toISOString(), motivo_erro: null })
      .eq("processo_cnj", cnj).eq("status", "PENDENTE");

    const restritos = itens.filter((i) => i.tipo && i.tipo !== "PUBLICO").length;
    return json({ ok: true, cnj, acao, paginas, total: itens.length, restritos, gravado });
  }

  let r: Response;
  if (acao === "get" && typeof path === "string" && path.startsWith("/api/")) r = await fetch(`${HOST}${path}`, { headers: h });
  else if (acao === "solicitar") r = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/solicitar-atualizacao`, { method: "POST", headers: h, body: JSON.stringify(rawBody ?? {}) });
  else if (acao === "status") r = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/status-atualizacao`, { headers: h });
  else return json({ ok: false, cnj: cnj ?? null, motivo: "ACAO_INVALIDA" });
  const t = await r.text();
  // `resposta` vai como objeto quando dá para parsear: jm_esc_confirmar lê
  // resposta->>'status' e resposta->>'message' direto, sem cast de string.
  let resposta: unknown = t.slice(0, 2000);
  try { resposta = JSON.parse(t); } catch { /* mantém o texto cru */ }
  return json({ ok: r.ok, cnj: cnj ?? null, http_status: r.status, creditos: r.headers.get("Creditos-Utilizados"), resposta });
});

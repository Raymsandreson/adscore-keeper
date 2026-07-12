import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const GUARD = "lp-esc-2026-df3";
const HOST = "https://api.escavador.com";
const BUCKET = "jm-autos";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== GUARD) return new Response("forbidden", { status: 403 });
  const token = Deno.env.get("ESCAVADOR_API_TOKEN");
  if (!token) return json({ ok: false, motivo: "SECRET_AUSENTE" });
  const { acao, cnj, path, body: rawBody, limite, orcamento_ms, concorrencia } = await req.json();
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" };

  // modo 'arquivar': baixa PDFs pendentes (storage_path NULL) e sobe no bucket privado jm-autos.
  // Lotes internos com concorrencia limitada ate esgotar a fila ou estourar o orcamento de tempo.
  // Idempotente: so pega quem tem storage_path NULL e storage_error NULL. Erro por doc nao trava o lote.
  if (acao === "arquivar") {
    const lote = Math.min(Math.max(Number(limite ?? 60), 1), 200);
    const conc = Math.min(Math.max(Number(concorrencia ?? 8), 1), 20);
    const budgetMs = Math.min(Math.max(Number(orcamento_ms ?? 110000), 5000), 130000);
    const inicio = Date.now();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let sucesso = 0, falhas = 0, processados = 0;
    const amostra: unknown[] = [];
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
        const { error: updErr } = await sb.from("jm_documentos").update({ storage_path: spath, stored_at: new Date().toISOString(), storage_error: null }).eq("id", d.id);
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
      const { data: docs, error: selErr } = await sb
        .from("jm_documentos")
        .select("id, processo_cnj, link_api")
        .is("storage_path", null)
        .is("storage_error", null)
        .not("link_api", "is", null)
        .order("id")
        .limit(lote);
      if (selErr) return json({ ok: false, motivo: "SELECT_FALHOU", erro: selErr.message, processados, sucesso, falhas });
      if (!docs || docs.length === 0) break;
      for (let i = 0; i < docs.length; i += conc) {
        await Promise.all(docs.slice(i, i + conc).map(processarUm));
        if (Date.now() - inicio >= budgetMs) break;
      }
    }
    const { count: restantes } = await sb.from("jm_documentos").select("id", { count: "exact", head: true }).is("storage_path", null).is("storage_error", null);
    return json({ ok: true, processados, sucesso, falhas, restantes: restantes ?? null, decorrido_ms: Date.now() - inicio, amostra });
  }

  // modo 'docs': lista documentos publicos e devolve JSON compacto completo (cnj + itens com link)
  if (acao === "docs") {
    const r = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/documentos-publicos`, { headers: h });
    if (!r.ok) return json({ ok: false, cnj, http_status: r.status });
    const j = await r.json();
    const items = (j.items ?? []).map((d: any) => ({ titulo: d.titulo, tipo: d.tipo, data: d.data?.date, paginas: d.quantidade_paginas, link: d.links?.api }));
    return json({ ok: true, cnj, total: items.length, items });
  }
  let r: Response;
  if (acao === "get" && typeof path === "string" && path.startsWith("/api/")) r = await fetch(`${HOST}${path}`, { headers: h });
  else if (acao === "solicitar") r = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/solicitar-atualizacao`, { method: "POST", headers: h, body: JSON.stringify(rawBody ?? {}) });
  else if (acao === "status") r = await fetch(`${HOST}/api/v2/processos/numero_cnj/${cnj}/status-atualizacao`, { headers: h });
  else return json({ ok: false, motivo: "ACAO_INVALIDA" });
  const t = await r.text();
  return json({ ok: r.ok, http_status: r.status, creditos: r.headers.get("Creditos-Utilizados"), resposta: t.slice(0, 2000) });
});

// Re-sync targeted: descobre gaps Cloud->External e sincroniza só o que falta.
// Modos:
//   { mode: "diff", table } -> retorna ids_missing[] (Cloud tem, External não)
//   { mode: "sync", table, ids: [...] } -> upsert dessas linhas (max 200/call)
//   { mode: "count", table } -> contagem em ambos

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cloud = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const ext = createClient(
  Deno.env.get("EXTERNAL_SUPABASE_URL")!,
  Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED = new Set(["whatsapp_messages", "legal_cases"]);

async function fetchAllIds(client: any, table: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let after: string | null = null;
  const pageSize = 1000;
  while (true) {
    let q = client.from(table).select("id").order("id", { ascending: true }).limit(pageSize);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new Error(`fetchAllIds(${table}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.id);
    after = data[data.length - 1].id;
    if (data.length < pageSize) break;
  }
  return ids;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const table: string = body.table;
    const mode: string = body.mode || "count";

    if (!ALLOWED.has(table)) {
      return new Response(JSON.stringify({ success: false, error: `tabela não permitida: ${table}` }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();

    if (mode === "count") {
      const [{ count: cloudCount }, { count: extCount }] = await Promise.all([
        cloud.from(table).select("*", { count: "exact", head: true }),
        ext.from(table).select("*", { count: "exact", head: true }),
      ]);
      return new Response(JSON.stringify({
        success: true, table, cloud_count: cloudCount, ext_count: extCount,
        elapsed_ms: Date.now() - startedAt,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (mode === "diff") {
      const [cloudIds, extIds] = await Promise.all([
        fetchAllIds(cloud, table),
        fetchAllIds(ext, table),
      ]);
      const missing: string[] = [];
      for (const id of cloudIds) if (!extIds.has(id)) missing.push(id);
      return new Response(JSON.stringify({
        success: true, table,
        cloud_total: cloudIds.size, ext_total: extIds.size,
        missing_count: missing.length,
        missing_sample: missing.slice(0, 20),
        missing_ids: missing, // lista completa (pode ser grande, ~13k = ~500KB)
        elapsed_ms: Date.now() - startedAt,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (mode === "sync") {
      const ids: string[] = body.ids || [];
      if (ids.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "ids vazio" }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      if (ids.length > 200) {
        return new Response(JSON.stringify({ success: false, error: "max 200 ids por chamada" }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await cloud.from(table).select("*").in("id", ids);
      if (error) {
        return new Response(JSON.stringify({ success: false, error: `read cloud: ${error.message}` }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      if (!data || data.length === 0) {
        return new Response(JSON.stringify({ success: true, requested: ids.length, found: 0, upserted: 0 }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { error: upErr } = await ext.from(table).upsert(data, { onConflict: "id", ignoreDuplicates: false });
      if (upErr) {
        // fallback row-by-row
        let ok = 0; const errs: string[] = [];
        for (const r of data) {
          const { error: e2 } = await ext.from(table).upsert(r, { onConflict: "id", ignoreDuplicates: false });
          if (!e2) ok++;
          else if (errs.length < 5) errs.push(`${(r as any).id}: ${e2.message.slice(0, 100)}`);
        }
        return new Response(JSON.stringify({
          success: true, requested: ids.length, found: data.length, upserted: ok,
          bulk_error: upErr.message.slice(0, 200), sample_errors: errs,
          elapsed_ms: Date.now() - startedAt,
        }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        success: true, requested: ids.length, found: data.length, upserted: data.length,
        elapsed_ms: Date.now() - startedAt,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: false, error: `mode inválido: ${mode}` }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

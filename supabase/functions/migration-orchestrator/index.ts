// Orquestrador da migração Cloud -> External.
// Comportamento:
// - Pega a próxima tabela com status pending|running na menor `ordering`.
// - Roda 1 batch grande (default 200 linhas) via reuso da lógica de migrate-cloud-to-external.
// - Atualiza migration_progress com cursor (last_id), totais, status.
// - Se a tabela acabou (done=true): marca done e re-dispara o orquestrador (fire-and-forget).
// - Se ainda há mais batches: re-dispara mantendo o cursor.
// - POST {} -> processa próximo passo
// - POST {reset:true} -> zera tudo pra pending
// - POST {status:true} -> só retorna o estado atual (não processa)
// - POST {start:true} -> dispara fire-and-forget
// - POST {table:"X"} -> força processar essa tabela (override)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

const FK_AUTH_COLUMNS = new Set<string>([
  "created_by", "user_id", "assigned_to", "updated_by", "owner_id",
  "deleted_by", "uploaded_by", "sent_by", "completed_by", "approved_by", "reviewed_by",
]);

let UUID_MAP: Map<string, string> | null = null;
async function loadUuidMap(): Promise<Map<string, string>> {
  if (UUID_MAP) return UUID_MAP;
  const { data } = await cloud.from("auth_uuid_mapping").select("cloud_uuid, ext_uuid");
  UUID_MAP = new Map((data || []).map((r: any) => [r.cloud_uuid, r.ext_uuid]));
  return UUID_MAP;
}

async function getColumns(url: string, key: string, table: string): Promise<Set<string>> {
  const r = await fetch(`${url}/rest/v1/${table}?limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await r.json().catch(() => []);
  if (Array.isArray(rows) && rows.length > 0) return new Set(Object.keys(rows[0]));
  // tabela vazia: openapi
  const r2 = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
  });
  const spec = await r2.json().catch(() => ({}));
  return new Set(Object.keys(spec?.definitions?.[table]?.properties || {}));
}

function remapRow(row: any, fkCols: string[], map: Map<string, string>): any {
  if (fkCols.length === 0) return row;
  const out: any = { ...row };
  for (const c of fkCols) {
    if (c in out && typeof out[c] === "string" && map.has(out[c])) {
      out[c] = map.get(out[c]);
    }
  }
  return out;
}

async function processOneBatch(table: string, afterId: string | null, batchSize: number) {
  const result = {
    table, batch_read: 0, batch_upserted: 0, done: false,
    last_id: afterId as string | null, error: null as string | null,
  };

  const cloudCols = await getColumns(CLOUD_URL, CLOUD_KEY, table);
  const extCols = await getColumns(EXT_URL, EXT_KEY, table);
  if (extCols.size === 0) {
    result.error = "table not in external";
    result.done = true;
    return result;
  }
  const commonCols = [...cloudCols].filter((c) => extCols.has(c));
  if (!commonCols.includes("id")) {
    result.error = "no id column";
    result.done = true;
    return result;
  }
  const fkCols = commonCols.filter((c) => FK_AUTH_COLUMNS.has(c));
  const map = fkCols.length > 0 ? await loadUuidMap() : new Map();

  let q = cloud.from(table).select(commonCols.join(",")).order("id", { ascending: true }).limit(batchSize);
  if (afterId) q = q.gt("id", afterId);
  const { data, error } = await q;
  if (error) {
    result.error = `read: ${error.message.slice(0, 200)}`;
    return result;
  }
  if (!data || data.length === 0) {
    result.done = true;
    return result;
  }
  result.batch_read = data.length;
  result.last_id = (data[data.length - 1] as any).id;

  const remapped = data.map((r: any) => remapRow(r, fkCols, map));
  const { error: upErr } = await ext.from(table).upsert(remapped, { onConflict: "id" });
  if (upErr) {
    // fallback row-by-row
    let ok = 0;
    for (const r of remapped) {
      const { error: e2 } = await ext.from(table).upsert(r, { onConflict: "id" });
      if (!e2) ok++;
    }
    result.batch_upserted = ok;
    result.error = `bulk: ${upErr.message.slice(0, 150)}`;
  } else {
    result.batch_upserted = data.length;
  }

  if (data.length < batchSize) result.done = true;
  return result;
}

async function pickNextTable() {
  const { data } = await cloud
    .from("migration_progress")
    .select("*")
    .in("status", ["pending", "running"])
    .order("ordering", { ascending: true })
    .limit(1);
  return data && data[0] ? data[0] : null;
}

async function fireAndForget() {
  // Não awaitamos: dispara e retorna
  fetch(`${CLOUD_URL}/functions/v1/migration-orchestrator`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({}),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.reset) {
      await cloud.from("migration_progress").update({
        status: "pending", last_id: null, total_read: 0, total_upserted: 0,
        batches: 0, attempts: 0, last_error: null, started_at: null, finished_at: null,
      }).neq("table_name", "");
      return new Response(JSON.stringify({ success: true, reset: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (body.status) {
      const { data } = await cloud
        .from("migration_progress")
        .select("table_name, ordering, status, total_read, total_upserted, batches, last_error")
        .order("ordering", { ascending: true });
      const summary = (data || []).reduce((acc: any, r: any) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      return new Response(JSON.stringify({ success: true, summary, tables: data }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (body.start) {
      fireAndForget();
      return new Response(JSON.stringify({ success: true, started: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Modo padrão: processa um passo
    const batchSize: number = body.batch_size || 200;
    let row: any = null;

    if (body.table) {
      const { data } = await cloud.from("migration_progress").select("*").eq("table_name", body.table).maybeSingle();
      row = data;
    } else {
      row = await pickNextTable();
    }

    if (!row) {
      return new Response(JSON.stringify({ success: true, finished: true, message: "no pending tables" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Marca como running e incrementa attempts
    await cloud.from("migration_progress").update({
      status: "running",
      attempts: (row.attempts || 0) + 1,
      started_at: row.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("table_name", row.table_name);

    const res = await processOneBatch(row.table_name, row.last_id, batchSize);

    const newTotalRead = (row.total_read || 0) + res.batch_read;
    const newTotalUp = (row.total_upserted || 0) + res.batch_upserted;
    const newBatches = (row.batches || 0) + (res.batch_read > 0 ? 1 : 0);

    await cloud.from("migration_progress").update({
      status: res.done ? (res.error && newTotalRead === 0 ? "error" : "done") : "running",
      last_id: res.last_id,
      total_read: newTotalRead,
      total_upserted: newTotalUp,
      batches: newBatches,
      last_error: res.error,
      finished_at: res.done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("table_name", row.table_name);

    // Se ainda há trabalho, re-dispara
    const willContinue = !body.no_chain;
    if (willContinue) fireAndForget();

    return new Response(JSON.stringify({
      success: true,
      processed_table: row.table_name,
      batch_read: res.batch_read,
      batch_upserted: res.batch_upserted,
      table_done: res.done,
      total_read: newTotalRead,
      total_upserted: newTotalUp,
      error: res.error,
      chained: willContinue,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
